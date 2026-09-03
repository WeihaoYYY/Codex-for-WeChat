import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { ControllerApprovalBroker } from "../src/controller/broker.js";
import { resolveStatePaths } from "../src/state/paths.js";

const input = {
  conversationPath: "/g/g-p-investment/c/conversation-one",
  taskFingerprint: "a".repeat(64),
  reason: "USER_AUTHORITY_REQUIRED",
  marker: "NEXT_TASK_READY",
  summary: "Controller paused before the next Codex round."
};

test("binds a one-time Controller decision to sender, pause id, and fingerprint", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-weixin-controller-"));
  try {
    const broker = new ControllerApprovalBroker(resolveStatePaths(root));
    const first = broker.register("alice", input);
    const duplicate = broker.register("alice", input);
    assert.equal(first.duplicate, false);
    assert.match(first.pause.approvalId, /^C-[A-F0-9]{12}$/);
    assert.equal(duplicate.duplicate, true);
    assert.equal(duplicate.pause.approvalId, first.pause.approvalId);
    assert.equal(broker.decide("mallory", first.pause.approvalId, "continue").status, "wrong-sender");
    const decision = broker.decide("alice", first.pause.approvalId, "continue");
    assert.equal(decision.status, "resolved");
    if (decision.status !== "resolved") throw new Error("expected resolved decision");
    assert.ok(decision.pause.decisionToken);
    assert.equal(broker.consume(first.pause.approvalId, "b".repeat(64), decision.pause.decisionToken!).status, "fingerprint-mismatch");
    assert.equal(broker.consume(first.pause.approvalId, input.taskFingerprint, "wrong").status, "token-mismatch");
    assert.equal(broker.consume(first.pause.approvalId, input.taskFingerprint, decision.pause.decisionToken!).status, "consumed");
    assert.equal(broker.consume(first.pause.approvalId, input.taskFingerprint, decision.pause.decisionToken!).status, "not-continued");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("rejects once and expires unresolved Controller pauses", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-weixin-controller-expiry-"));
  let now = new Date("2026-09-03T00:00:00.000Z");
  try {
    const broker = new ControllerApprovalBroker(resolveStatePaths(root), 1_000, () => now);
    const rejected = broker.register("alice", input);
    assert.equal(broker.decide("alice", rejected.pause.approvalId, "reject").status, "resolved");
    assert.equal(broker.decide("alice", rejected.pause.approvalId, "continue").status, "already-decided");
    const expiring = broker.register("alice", { ...input, taskFingerprint: "c".repeat(64) });
    now = new Date("2026-09-03T00:00:02.000Z");
    assert.equal(broker.get(expiring.pause.approvalId)?.state, "expired");
    const reissued = broker.register("alice", { ...input, taskFingerprint: "c".repeat(64) });
    assert.equal(reissued.duplicate, false);
    assert.notEqual(reissued.pause.approvalId, expiring.pause.approvalId);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("keeps at most one active Controller pause per sender and conversation", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-weixin-controller-supersede-"));
  try {
    const broker = new ControllerApprovalBroker(resolveStatePaths(root));
    const first = broker.register("alice", input);
    const second = broker.register("alice", { ...input, taskFingerprint: "d".repeat(64), reason: "NO_PENDING_MARKER" });
    assert.equal(second.duplicate, false);
    assert.equal(broker.get(first.pause.approvalId)?.state, "expired");
    assert.equal(broker.get(second.pause.approvalId)?.state, "pending");
    assert.equal(
      broker.list("alice").filter((pause) => pause.state === "pending" || pause.state === "continued").length,
      1
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
