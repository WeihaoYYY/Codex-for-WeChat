import type { CodexApprovalDecision, CodexApprovalRequest } from "../codex/app-server-runner.js";

export type PendingApproval = {
  code: string;
  senderId: string;
  request: CodexApprovalRequest;
  createdAt: string;
  expiresAt: string;
  promise: Promise<CodexApprovalDecision>;
};

export type ApprovalResolution =
  | { status: "resolved"; approval: Omit<PendingApproval, "promise"> }
  | { status: "not-found" }
  | { status: "wrong-sender" }
  | { status: "session-not-allowed" };

type ApprovalEntry = PendingApproval & {
  resolve: (decision: CodexApprovalDecision) => void;
  timer: NodeJS.Timeout;
};

export class ApprovalBroker {
  private readonly pending = new Map<string, ApprovalEntry>();
  private nextCode = 1;

  constructor(private readonly ttlMs = 10 * 60_000) {}

  request(senderId: string, request: CodexApprovalRequest): PendingApproval {
    const code = `A${this.nextCode++}`;
    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + this.ttlMs);
    let resolvePromise!: (decision: CodexApprovalDecision) => void;
    const promise = new Promise<CodexApprovalDecision>((resolve) => {
      resolvePromise = resolve;
    });
    const timer = setTimeout(() => {
      const entry = this.pending.get(code);
      if (!entry) return;
      this.pending.delete(code);
      entry.resolve("cancel");
    }, this.ttlMs);
    timer.unref?.();
    const entry: ApprovalEntry = {
      code,
      senderId,
      request,
      createdAt: createdAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      promise,
      resolve: resolvePromise,
      timer
    };
    this.pending.set(code, entry);
    return publicApproval(entry);
  }

  resolve(senderId: string, rawCode: string, decision: CodexApprovalDecision): ApprovalResolution {
    const code = normalizeCode(rawCode);
    if (!code) return { status: "not-found" };
    const entry = this.pending.get(code);
    if (!entry) return { status: "not-found" };
    if (entry.senderId !== senderId) return { status: "wrong-sender" };
    if (decision === "acceptForSession" && !entry.request.allowForSession) {
      return { status: "session-not-allowed" };
    }
    this.pending.delete(code);
    clearTimeout(entry.timer);
    entry.resolve(decision);
    return { status: "resolved", approval: publicApprovalWithoutPromise(entry) };
  }

  list(senderId: string): Array<Omit<PendingApproval, "promise">> {
    return Array.from(this.pending.values())
      .filter((entry) => entry.senderId === senderId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map(publicApprovalWithoutPromise);
  }

  cancelForSender(senderId: string): number {
    let count = 0;
    for (const entry of this.pending.values()) {
      if (entry.senderId !== senderId) continue;
      this.pending.delete(entry.code);
      clearTimeout(entry.timer);
      entry.resolve("cancel");
      count += 1;
    }
    return count;
  }
}

function normalizeCode(value: string): string | undefined {
  const code = value.trim().toUpperCase();
  return /^A[1-9]\d*$/.test(code) ? code : undefined;
}

function publicApproval(entry: ApprovalEntry): PendingApproval {
  return {
    code: entry.code,
    senderId: entry.senderId,
    request: structuredClone(entry.request),
    createdAt: entry.createdAt,
    expiresAt: entry.expiresAt,
    promise: entry.promise
  };
}

function publicApprovalWithoutPromise(entry: ApprovalEntry): Omit<PendingApproval, "promise"> {
  const { promise: _promise, ...approval } = publicApproval(entry);
  return approval;
}
