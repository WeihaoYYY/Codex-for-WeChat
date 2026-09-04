import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { recordBridgeError, safeErrorSummary } from "../src/bridge/error-log.js";

test("persists a referenceable, redacted bridge error without sender identifiers", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-weixin-error-log-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const inboundDir = path.join(root, "inbound", "account");
  const error = new Error(
    `app-server thread/resume failed: Authorization: Bearer private-bearer token=private-token file=${path.join(inboundDir, "private.png")}`
  );

  const recorded = recordBridgeError({
    logsDir: path.join(root, "logs"),
    error,
    event: "wechat message handling",
    accountId: "account-secret",
    senderId: "sender-secret",
    messageId: "message-secret",
    inboundDir,
    now: new Date("2026-09-03T09:25:05.000Z"),
    randomBytes: () => Buffer.from("abcdef", "hex")
  });

  assert.equal(recorded.code, "CODEX_SESSION_RESUME_FAILED");
  assert.equal(recorded.reference, "WX-20260903T092505Z-ABCDEF");
  const content = fs.readFileSync(recorded.logPath, "utf8");
  assert.match(content, /CODEX_SESSION_RESUME_FAILED/);
  assert.match(content, /<redacted>/);
  assert.match(content, /<inbound>/);
  assert.doesNotMatch(content, /private-bearer|private-token|private\.png/);
  assert.doesNotMatch(content, /account-secret|sender-secret|message-secret/);
});

test("console-safe error summaries omit messages and sensitive values", () => {
  const error = Object.assign(new Error("Bearer private-token at C:\\private\\file.txt"), { code: "EACCES" });
  assert.equal(safeErrorSummary(error), "Error (EACCES)");
  assert.equal(safeErrorSummary("private-token"), "string");
});
