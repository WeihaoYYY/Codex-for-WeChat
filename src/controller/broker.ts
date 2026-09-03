import crypto from "node:crypto";

import { readJsonFile, writeJsonFile } from "../state/json-store.js";
import type { StatePaths } from "../state/paths.js";

export type ControllerDecision = "continue" | "reject";
export type ControllerPauseState = "pending" | "continued" | "rejected" | "consumed" | "expired";

export type ControllerPauseInput = {
  conversationPath: string;
  taskFingerprint: string;
  reason: string;
  marker?: string;
  summary: string;
};

export type ControllerPause = ControllerPauseInput & {
  approvalId: string;
  senderId: string;
  idempotencyKey: string;
  state: ControllerPauseState;
  createdAt: string;
  expiresAt: string;
  notifiedAt?: string;
  decidedAt?: string;
  consumedAt?: string;
  decisionToken?: string;
};

type ControllerPauseFile = {
  version: 1;
  pauses: ControllerPause[];
};

export type ControllerResolution =
  | { status: "resolved"; pause: ControllerPause }
  | { status: "not-found" }
  | { status: "wrong-sender" }
  | { status: "already-decided"; pause: ControllerPause };

export type ControllerConsumption =
  | { status: "consumed"; pause: ControllerPause }
  | { status: "not-found" | "not-continued" | "fingerprint-mismatch" | "token-mismatch" };

const DEFAULT_TTL_MS = 24 * 60 * 60_000;
const MAX_RETAINED = 200;

export class ControllerApprovalBroker {
  constructor(
    private readonly paths: StatePaths,
    private readonly ttlMs = DEFAULT_TTL_MS,
    private readonly now: () => Date = () => new Date()
  ) {}

  register(senderId: string, input: ControllerPauseInput): { pause: ControllerPause; duplicate: boolean } {
    const normalized = normalizeInput(input);
    const idempotencyKey = hash(`${senderId}\n${normalized.conversationPath}\n${normalized.taskFingerprint}\n${normalized.reason}`);
    const file = this.read();
    const existing = file.pauses.find((pause) => pause.idempotencyKey === idempotencyKey
      && (pause.state === "pending" || pause.state === "continued"));
    if (existing) return { pause: clone(existing), duplicate: true };
    const createdAt = this.now();
    const pause: ControllerPause = {
      ...normalized,
      approvalId: this.newApprovalId(file.pauses),
      senderId,
      idempotencyKey,
      state: "pending",
      createdAt: createdAt.toISOString(),
      expiresAt: new Date(createdAt.getTime() + this.ttlMs).toISOString()
    };
    file.pauses.push(pause);
    this.write(file);
    return { pause: clone(pause), duplicate: false };
  }

  markNotified(approvalId: string): ControllerPause | undefined {
    const file = this.read();
    const pause = file.pauses.find((candidate) => candidate.approvalId === normalizeApprovalId(approvalId));
    if (!pause) return undefined;
    pause.notifiedAt = this.now().toISOString();
    this.write(file);
    return clone(pause);
  }

  get(approvalId: string): ControllerPause | undefined {
    const file = this.read();
    const pause = file.pauses.find((candidate) => candidate.approvalId === normalizeApprovalId(approvalId));
    return pause ? clone(pause) : undefined;
  }

  list(senderId: string): ControllerPause[] {
    return this.read().pauses
      .filter((pause) => pause.senderId === senderId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(clone);
  }

  decide(senderId: string, approvalId: string, decision: ControllerDecision): ControllerResolution {
    const file = this.read();
    const pause = file.pauses.find((candidate) => candidate.approvalId === normalizeApprovalId(approvalId));
    if (!pause) return { status: "not-found" };
    if (pause.senderId !== senderId) return { status: "wrong-sender" };
    if (pause.state !== "pending") return { status: "already-decided", pause: clone(pause) };
    pause.state = decision === "continue" ? "continued" : "rejected";
    pause.decidedAt = this.now().toISOString();
    if (decision === "continue") pause.decisionToken = crypto.randomBytes(24).toString("base64url");
    this.write(file);
    return { status: "resolved", pause: clone(pause) };
  }

  consume(approvalId: string, taskFingerprint: string, decisionToken: string): ControllerConsumption {
    const file = this.read();
    const pause = file.pauses.find((candidate) => candidate.approvalId === normalizeApprovalId(approvalId));
    if (!pause) return { status: "not-found" };
    if (pause.state !== "continued") return { status: "not-continued" };
    if (pause.taskFingerprint !== taskFingerprint.trim().toLowerCase()) return { status: "fingerprint-mismatch" };
    if (!safeEqual(pause.decisionToken, decisionToken)) return { status: "token-mismatch" };
    pause.state = "consumed";
    pause.consumedAt = this.now().toISOString();
    delete pause.decisionToken;
    this.write(file);
    return { status: "consumed", pause: clone(pause) };
  }

  private read(): ControllerPauseFile {
    const file = readJsonFile<ControllerPauseFile>(this.paths.controllerApprovalsPath, { version: 1, pauses: [] });
    const now = this.now().getTime();
    let changed = false;
    for (const pause of file.pauses) {
      if ((pause.state === "pending" || pause.state === "continued") && Date.parse(pause.expiresAt) <= now) {
        pause.state = "expired";
        delete pause.decisionToken;
        changed = true;
      }
    }
    if (file.pauses.length > MAX_RETAINED) {
      file.pauses = file.pauses.slice(-MAX_RETAINED);
      changed = true;
    }
    if (changed) this.write(file);
    return file;
  }

  private write(file: ControllerPauseFile): void {
    writeJsonFile(this.paths.controllerApprovalsPath, file);
  }

  private newApprovalId(existing: ControllerPause[]): string {
    const used = new Set(existing.map((pause) => pause.approvalId));
    for (;;) {
      const id = `C-${crypto.randomBytes(6).toString("hex").toUpperCase()}`;
      if (!used.has(id)) return id;
    }
  }
}

function normalizeInput(input: ControllerPauseInput): ControllerPauseInput {
  const conversationPath = input.conversationPath.trim();
  const taskFingerprint = input.taskFingerprint.trim().toLowerCase();
  const reason = input.reason.trim().toUpperCase();
  const marker = input.marker?.trim().toUpperCase();
  const summary = input.summary.trim().slice(0, 500);
  if (!/^\/g\/[^\s]+\/c\/[^/\s]+\/?$/.test(conversationPath)) throw new Error("Invalid Controller conversation path");
  if (!/^[0-9a-f]{64}$/.test(taskFingerprint)) throw new Error("Invalid Controller task fingerprint");
  if (!/^[A-Z][A-Z0-9_]{1,79}$/.test(reason)) throw new Error("Invalid Controller pause reason");
  if (marker && !/^[A-Z][A-Z0-9_]{1,79}$/.test(marker)) throw new Error("Invalid Controller marker");
  if (!summary) throw new Error("Controller pause summary is required");
  return { conversationPath, taskFingerprint, reason, ...(marker ? { marker } : {}), summary };
}

function normalizeApprovalId(value: string): string {
  return value.trim().toUpperCase();
}

function hash(value: string): string {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function safeEqual(expected: string | undefined, provided: string): boolean {
  if (!expected || !provided) return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(provided);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
