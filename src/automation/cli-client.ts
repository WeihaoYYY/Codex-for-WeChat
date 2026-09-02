import crypto from "node:crypto";

import type { CliCommand } from "../server/arguments.js";
import { readAutomationToken } from "./token.js";
import type { StatePaths } from "../state/paths.js";
import type { AutomationJob } from "./job-store.js";

export async function runAutomationCli(command: Exclude<CliCommand, { name: "start" | "help" }>, paths: StatePaths, port: number): Promise<void> {
  if (command.name === "notify") {
    const notification = parseNotifyPayload(command.payload);
    if (!notification.text) return;
    const result = await request(paths, port, "/api/automation/push", "POST", {
      text: notification.text,
      idempotencyKey: notification.idempotencyKey
    });
    printJob(result.job as AutomationJob, Boolean(result.duplicate));
    return;
  }
  if (command.name === "push") {
    if (!command.text.trim()) throw new Error("push requires --text or positional text");
    const result = await request(paths, port, "/api/automation/push", "POST", {
      text: command.text,
      idempotencyKey: command.idempotencyKey
    });
    printJob(result.job as AutomationJob, Boolean(result.duplicate));
    return;
  }
  if (!command.prompt.trim()) throw new Error("task requires --prompt or positional text");
  const result = await request(paths, port, "/api/automation/tasks", "POST", {
    prompt: command.prompt,
    workspace: command.workspace,
    title: command.title,
    idempotencyKey: command.idempotencyKey
  });
  let job = result.job as AutomationJob;
  printJob(job, Boolean(result.duplicate));
  if (!command.wait || isTerminal(job.status)) return;
  while (!isTerminal(job.status)) {
    await delay(1_000);
    const next = await request(paths, port, `/api/automation/tasks/${encodeURIComponent(job.id)}`, "GET");
    job = next.job as AutomationJob;
  }
  printJob(job, false);
  if (job.status === "failed") throw new Error(job.error ?? "Automation task failed");
}

function parseNotifyPayload(raw: string): { text?: string; idempotencyKey: string } {
  const value = JSON.parse(raw) as Record<string, unknown>;
  if (value.type !== "agent-turn-complete") return { idempotencyKey: "ignored" };
  const assistant = typeof value["last-assistant-message"] === "string" ? value["last-assistant-message"].trim() : "";
  const cwd = typeof value.cwd === "string" ? value.cwd.trim() : "";
  const threadId = typeof value["thread-id"] === "string" ? value["thread-id"] : "unknown-thread";
  const turnId = typeof value["turn-id"] === "string" ? value["turn-id"] : crypto.createHash("sha256").update(raw).digest("hex").slice(0, 16);
  return {
    text: assistant ? [`【Codex 主动通知】`, ...(cwd ? [`工作目录：${cwd}`] : []), assistant].join("\n") : undefined,
    idempotencyKey: `codex-notify:${threadId}:${turnId}`
  };
}

async function request(paths: StatePaths, port: number, pathname: string, method: "GET" | "POST", body?: unknown): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(`http://127.0.0.1:${port}${pathname}`, {
      method,
      headers: {
        authorization: `Bearer ${readAutomationToken(paths)}`,
        ...(body === undefined ? {} : { "content-type": "application/json" })
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
  } catch (error) {
    throw new Error(`Unable to reach Codex for WeChat at 127.0.0.1:${port}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const value = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof value.error === "string" ? value.error : `Automation request failed (${response.status})`);
  return value;
}

function isTerminal(status: AutomationJob["status"]): boolean {
  return status === "completed" || status === "waiting-context" || status === "failed";
}

function printJob(job: AutomationJob, duplicate: boolean): void {
  console.log(`${job.kind} ${job.id}: ${job.status}${duplicate ? " (duplicate)" : ""}`);
  if (job.sessionId) console.log(`session: ${job.sessionId}`);
  if (job.error) console.log(`error: ${job.error}`);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
