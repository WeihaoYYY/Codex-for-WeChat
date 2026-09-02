import crypto from "node:crypto";

import { readJsonFile, writeJsonFile } from "../state/json-store.js";
import type { StatePaths } from "../state/paths.js";

export type AutomationJobStatus = "queued" | "running" | "completed" | "waiting-context" | "failed";
export type AutomationJob = {
  id: string;
  kind: "push" | "task";
  status: AutomationJobStatus;
  idempotencyKey?: string;
  promptPreview: string;
  sessionId?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
};

type AutomationJobFile = { jobs: AutomationJob[] };

export class AutomationJobStore {
  private jobs: AutomationJob[];

  constructor(private readonly paths: StatePaths) {
    const loaded = readJsonFile<Partial<AutomationJobFile>>(paths.automationJobsPath, {});
    this.jobs = Array.isArray(loaded.jobs) ? loaded.jobs.slice(-200) : [];
    let changed = false;
    for (const job of this.jobs) {
      if (job.status === "queued" || job.status === "running") {
        job.status = "failed";
        job.error = "Service restarted before the automation job completed";
        job.updatedAt = new Date().toISOString();
        changed = true;
      }
    }
    if (changed) this.save();
  }

  create(kind: AutomationJob["kind"], prompt: string, idempotencyKey?: string): { job: AutomationJob; duplicate: boolean } {
    const normalizedKey = cleanKey(idempotencyKey);
    if (normalizedKey) {
      const existing = [...this.jobs].reverse().find((job) => job.idempotencyKey === normalizedKey && job.kind === kind);
      if (existing) return { job: structuredClone(existing), duplicate: true };
    }
    const now = new Date().toISOString();
    const job: AutomationJob = {
      id: crypto.randomUUID(),
      kind,
      status: "queued",
      ...(normalizedKey ? { idempotencyKey: normalizedKey } : {}),
      promptPreview: prompt.trim().replace(/\s+/g, " ").slice(0, 160),
      createdAt: now,
      updatedAt: now
    };
    this.jobs.push(job);
    this.jobs = this.jobs.slice(-200);
    this.save();
    return { job: structuredClone(job), duplicate: false };
  }

  get(jobId: string): AutomationJob | undefined {
    const job = this.jobs.find((candidate) => candidate.id === jobId);
    return job ? structuredClone(job) : undefined;
  }

  update(jobId: string, patch: Partial<Pick<AutomationJob, "status" | "sessionId" | "error">>): AutomationJob {
    const job = this.jobs.find((candidate) => candidate.id === jobId);
    if (!job) throw new Error(`Automation job not found: ${jobId}`);
    Object.assign(job, patch, { updatedAt: new Date().toISOString() });
    this.save();
    return structuredClone(job);
  }

  countActive(): number {
    return this.jobs.filter((job) => job.status === "queued" || job.status === "running").length;
  }

  private save(): void {
    writeJsonFile(this.paths.automationJobsPath, { jobs: this.jobs });
  }
}

function cleanKey(value: string | undefined): string | undefined {
  const key = value?.trim().slice(0, 200);
  return key || undefined;
}
