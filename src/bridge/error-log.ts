import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { bridgeErrorCode, type BridgeErrorCode } from "./errors.js";

export type BridgeErrorRecord = {
  code: BridgeErrorCode;
  reference: string;
  logPath: string;
};

export type RecordBridgeErrorInput = {
  logsDir: string;
  error: unknown;
  event: string;
  accountId?: string;
  senderId?: string;
  messageId?: string;
  inboundDir?: string;
  now?: Date;
  randomBytes?: (size: number) => Buffer;
};

export function recordBridgeError(input: RecordBridgeErrorInput): BridgeErrorRecord {
  const now = input.now ?? new Date();
  const randomBytes = input.randomBytes ?? crypto.randomBytes;
  const code = bridgeErrorCode(input.error);
  const reference = errorReference(now, randomBytes(3).toString("hex").toUpperCase());
  const logPath = path.join(input.logsDir, "service-errors.jsonl");
  const details = errorDetails(input.error, input.inboundDir);
  const entry = {
    timestamp: now.toISOString(),
    reference,
    code,
    event: cleanEvent(input.event),
    account: opaqueReference(input.accountId),
    sender: opaqueReference(input.senderId),
    message: opaqueReference(input.messageId),
    errorName: details.name,
    errorMessage: details.message,
    errorStack: details.stack
  };

  fs.mkdirSync(input.logsDir, { recursive: true });
  fs.appendFileSync(logPath, `${JSON.stringify(entry)}\n`, { encoding: "utf8", mode: 0o600 });
  return { code, reference, logPath };
}

export function safeErrorSummary(error: unknown): string {
  if (!(error instanceof Error)) return typeof error;
  const code = Reflect.get(error, "code");
  const name = error.name || "Error";
  return typeof code === "string" && code ? `${name} (${code})` : name;
}

function errorReference(now: Date, suffix: string): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return `WX-${stamp}-${suffix}`;
}

function errorDetails(error: unknown, inboundDir?: string): { name: string; message: string; stack?: string } {
  if (error instanceof Error) {
    return {
      name: sanitize(error.name || "Error", inboundDir),
      message: sanitize(error.message, inboundDir),
      ...(error.stack ? { stack: sanitize(error.stack, inboundDir) } : {})
    };
  }
  return { name: "NonError", message: sanitize(String(error), inboundDir) };
}

function sanitize(value: string, inboundDir?: string): string {
  let safe = value;
  if (inboundDir) {
    for (const root of new Set([inboundDir, inboundDir.replaceAll("\\", "/")])) {
      const escaped = root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      safe = safe.replace(new RegExp(`${escaped}(?:[\\\\/][^\\s,;]+)?`, "gi"), "<inbound>");
    }
  }
  return safe
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1<redacted>")
    .replace(/((?:authorization|proxy-authorization)\s*[:=]\s*)(?:Bearer\s+)?[^\s,;]+/gi, "$1<redacted>")
    .replace(/((?:set-cookie|cookie)\s*[:=]\s*)[^\r\n,;]+/gi, "$1<redacted>")
    .replace(/((?:token|secret|password|api[_-]?key)[A-Za-z0-9_.-]*\s*[:=]\s*)[^\s,;]+/gi, "$1<redacted>")
    .slice(0, 20_000);
}

function opaqueReference(value?: string): string | undefined {
  if (!value) return undefined;
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 12);
}

function cleanEvent(value: string): string {
  const normalized = value.trim().replace(/[^a-z0-9._-]+/gi, "-").slice(0, 80);
  return normalized || "bridge-error";
}
