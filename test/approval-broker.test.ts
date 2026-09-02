import assert from "node:assert/strict";
import test from "node:test";

import { ApprovalBroker } from "../src/bridge/approval-broker.js";

test("binds approval codes to one sender and resolves them only once", async () => {
  const broker = new ApprovalBroker(5_000);
  const pending = broker.request("alice", {
    kind: "command",
    threadId: "thread-1",
    turnId: "turn-1",
    itemId: "item-1",
    title: "Run command",
    detail: "npm test",
    allowForSession: true
  });

  assert.equal(pending.code, "A1");
  assert.equal(broker.list("alice").length, 1);
  assert.deepEqual(broker.resolve("mallory", "A1", "accept"), { status: "wrong-sender" });
  assert.equal(broker.resolve("alice", "a1", "acceptForSession").status, "resolved");
  assert.equal(await pending.promise, "acceptForSession");
  assert.deepEqual(broker.resolve("alice", "A1", "accept"), { status: "not-found" });
  assert.deepEqual(broker.list("alice"), []);
});

test("cancels every pending approval for a stopped sender", async () => {
  const broker = new ApprovalBroker(5_000);
  const first = broker.request("alice", {
    kind: "fileChange",
    threadId: "thread-1",
    turnId: "turn-1",
    itemId: "item-1",
    title: "Edit file",
    detail: "report.md"
  });
  const second = broker.request("alice", {
    kind: "browserAction",
    threadId: "thread-1",
    turnId: "turn-1",
    itemId: "item-2",
    title: "Submit form",
    detail: "example.com"
  });

  assert.equal(broker.cancelForSender("alice"), 2);
  assert.deepEqual(await Promise.all([first.promise, second.promise]), ["cancel", "cancel"]);
});

test("does not allow a session-wide decision for one-time approvals", async () => {
  const broker = new ApprovalBroker();
  const pending = broker.request("alice", {
    kind: "browserAction",
    threadId: "thread-1",
    turnId: "turn-1",
    itemId: "item-1",
    title: "Submit",
    detail: "Submit a form",
    allowForSession: false
  });

  assert.deepEqual(broker.resolve("alice", pending.code, "acceptForSession"), {
    status: "session-not-allowed"
  });
  assert.equal(broker.list("alice").length, 1);
  assert.equal(broker.resolve("alice", pending.code, "accept").status, "resolved");
  assert.equal(await pending.promise, "accept");
});
