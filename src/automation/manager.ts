import path from "node:path";

import { isWorkspaceAllowed, loadConfig, type CodexWeixinConfig } from "../state/config.js";
import type { StatePaths } from "../state/paths.js";
import type { AccountManager } from "../server/account-manager.js";
import { AutomationJobStore, type AutomationJob } from "./job-store.js";
import { safeErrorSummary } from "../bridge/error-log.js";

export type AutomationRequest = {
  text: string;
  idempotencyKey?: string;
};

export type AutomationTaskRequest = {
  prompt: string;
  workspace?: string;
  title?: string;
  idempotencyKey?: string;
};

export class AutomationManager {
  private readonly jobs: AutomationJobStore;
  private readonly recentOperations: number[] = [];

  constructor(private readonly options: {
    paths: StatePaths;
    accountManager: AccountManager;
    configProvider?: () => CodexWeixinConfig;
  }) {
    this.jobs = new AutomationJobStore(options.paths);
  }

  async push(input: AutomationRequest): Promise<{ job: AutomationJob; duplicate: boolean }> {
    const text = requiredText(input.text, "text");
    const created = this.jobs.create("push", text, input.idempotencyKey);
    if (created.duplicate) return created;
    this.guardCapacityAndRate(created.job.id);
    this.jobs.update(created.job.id, { status: "running" });
    try {
      const target = this.resolveTarget();
      const delivery = await this.options.accountManager.sendAutomationText(
        target.accountId,
        target.senderId,
        text,
        `automation:${created.job.id}`
      );
      return {
        job: this.jobs.update(created.job.id, { status: delivery === "queued" ? "waiting-context" : "completed" }),
        duplicate: false
      };
    } catch (error) {
      this.jobs.update(created.job.id, { status: "failed", error: errorMessage(error) });
      throw error;
    }
  }

  createTask(input: AutomationTaskRequest): { job: AutomationJob; duplicate: boolean } {
    const prompt = requiredText(input.prompt, "prompt");
    const target = this.resolveTarget();
    const created = this.jobs.create("task", prompt, input.idempotencyKey);
    if (created.duplicate) return created;
    this.guardCapacityAndRate(created.job.id);
    const config = this.config();
    const workspace = path.resolve(input.workspace?.trim() || config.defaultCwd);
    if (!isWorkspaceAllowed(workspace, config.allowedWorkspaces)) {
      this.jobs.update(created.job.id, { status: "failed", error: `Workspace is not allowed: ${workspace}` });
      throw new Error(`Workspace is not allowed: ${workspace}`);
    }
    void this.executeTask(created.job.id, target, {
      prompt,
      workspace,
      title: input.title?.trim().slice(0, 80) || undefined
    });
    return created;
  }

  get(jobId: string): AutomationJob | undefined {
    return this.jobs.get(jobId);
  }

  private async executeTask(
    jobId: string,
    target: { accountId: string; senderId: string },
    input: { prompt: string; workspace: string; title?: string }
  ): Promise<void> {
    this.jobs.update(jobId, { status: "running" });
    try {
      const result = await this.options.accountManager.runAutomationTask({
        ...target,
        ...input
      });
      this.jobs.update(jobId, {
        status: result.delivery === "queued" ? "waiting-context" : "completed",
        sessionId: result.sessionId
      });
    } catch (error) {
      const message = errorMessage(error);
      this.jobs.update(jobId, { status: "failed", error: message });
      console.error(`[codex-weixin] automation task failed: ${safeErrorSummary(error)}`);
    }
  }

  private resolveTarget(): { accountId: string; senderId: string } {
    const config = this.config();
    if (!config.automationEnabled) throw new Error("Proactive automation is disabled in Settings");
    if (!config.automationAccountId || !config.automationSenderId) {
      throw new Error("Choose exactly one proactive automation recipient in Settings");
    }
    const account = this.options.accountManager.listAccounts()
      .find((candidate) => candidate.accountId === config.automationAccountId);
    if (!account || account.status !== "running") throw new Error("Configured automation account is not running");
    if (!account.pairedSenderIds.includes(config.automationSenderId)) {
      throw new Error("Configured automation recipient is no longer authorized");
    }
    return { accountId: account.accountId, senderId: config.automationSenderId };
  }

  private guardCapacityAndRate(jobId: string): void {
    if (this.jobs.countActive() > 20) {
      this.jobs.update(jobId, { status: "failed", error: "Automation queue is full" });
      throw new Error("Automation queue is full");
    }
    const cutoff = Date.now() - 60_000;
    while (this.recentOperations.length && this.recentOperations[0] < cutoff) this.recentOperations.shift();
    if (this.recentOperations.length >= 30) {
      this.jobs.update(jobId, { status: "failed", error: "Automation rate limit exceeded" });
      throw new Error("Automation rate limit exceeded (30 operations per minute)");
    }
    this.recentOperations.push(Date.now());
  }

  private config(): CodexWeixinConfig {
    return this.options.configProvider?.() ?? loadConfig(this.options.paths);
  }
}

function requiredText(value: string, name: string): string {
  const text = value?.trim();
  if (!text) throw new Error(`${name} is required`);
  if (Buffer.byteLength(text, "utf8") > 256 * 1024) throw new Error(`${name} is too large`);
  return text;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
