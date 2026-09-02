import assert from "node:assert/strict";
import test from "node:test";

import { monitorWeixin } from "../src/weixin/monitor.js";
import type { WeixinApiClient } from "../src/weixin/api.js";

test("continues polling after a getUpdates failure", async (t) => {
  t.mock.method(console, "error", () => {});
  const controller = new AbortController();
  let polls = 0;
  const client = {
    async getUpdates() {
      polls += 1;
      if (polls === 1) {
        throw new Error("temporary poll failure");
      }
      controller.abort();
      return { msgs: [] };
    }
  } as WeixinApiClient;

  await monitorWeixin({
    client,
    signal: controller.signal,
    pollIntervalMs: 0,
    async onMessage() {}
  });

  assert.equal(polls, 2);
});

test("continues polling after a malformed getUpdates response", async (t) => {
  t.mock.method(console, "error", () => {});
  const controller = new AbortController();
  let polls = 0;
  const client = {
    async getUpdates() {
      polls += 1;
      if (polls === 1) {
        return { msgs: {} };
      }
      controller.abort();
      return { msgs: [] };
    }
  } as WeixinApiClient;

  await monitorWeixin({
    client,
    signal: controller.signal,
    pollIntervalMs: 0,
    async onMessage() {}
  });

  assert.equal(polls, 2);
});

test("stops immediately when polling aborts before the retry delay", async (t) => {
  t.mock.method(console, "error", () => {});
  const controller = new AbortController();
  const client = {
    async getUpdates() {
      controller.abort();
      throw new Error("poll interrupted");
    }
  } as WeixinApiClient;
  const startedAt = Date.now();

  await monitorWeixin({
    client,
    signal: controller.signal,
    pollIntervalMs: 250,
    async onMessage() {}
  });

  assert.ok(Date.now() - startedAt < 150);
});

test("continues with the remaining batch after one message fails", async (t) => {
  t.mock.method(console, "error", () => {});
  t.mock.method(console, "log", () => {});
  const controller = new AbortController();
  let polls = 0;
  const handled: string[] = [];
  const failures: string[] = [];
  const client = {
    async getUpdates() {
      polls += 1;
      if (polls === 1) {
        return {
          msgs: [
            { message_id: "first", from_user_id: "alice", text: "one" },
            { message_id: "second", from_user_id: "alice", text: "two" }
          ]
        };
      }
      controller.abort();
      return { msgs: [] };
    }
  } as WeixinApiClient;

  await monitorWeixin({
    client,
    signal: controller.signal,
    pollIntervalMs: 0,
    async onMessage(message) {
      handled.push(message.id);
      if (message.id === "first") {
        throw new Error("message failed");
      }
    },
    async onMessageError(error, message) {
      failures.push(`${message.id}:${error instanceof Error ? error.message : String(error)}`);
    }
  });

  assert.deepEqual(handled, ["first", "second"]);
  assert.deepEqual(failures, ["first:message failed"]);
});

test("handles a Chinese stop command while the previous message is still running", async (t) => {
  t.mock.method(console, "log", () => {});
  const controller = new AbortController();
  const events: string[] = [];
  let resolveLongStarted!: () => void;
  let resolveLongTurn!: () => void;
  let resolveStopHandled!: () => void;
  const longStarted = new Promise<void>((resolve) => {
    resolveLongStarted = resolve;
  });
  const longTurn = new Promise<void>((resolve) => {
    resolveLongTurn = resolve;
  });
  const stopHandled = new Promise<void>((resolve) => {
    resolveStopHandled = resolve;
  });
  let polls = 0;
  const client = {
    async getUpdates() {
      polls += 1;
      if (polls === 1) {
        return { msgs: [{ message_id: "long", from_user_id: "alice", text: "执行长任务" }] };
      }
      if (polls === 2) {
        await longStarted;
        return { msgs: [{ message_id: "stop", from_user_id: "alice", text: "停止" }] };
      }
      await stopHandled;
      controller.abort();
      return { msgs: [] };
    }
  } as WeixinApiClient;

  await monitorWeixin({
    client,
    signal: controller.signal,
    pollIntervalMs: 0,
    async onMessage(message) {
      if (message.id === "long") {
        events.push("long:start");
        resolveLongStarted();
        await longTurn;
        events.push("long:end");
        return;
      }
      events.push("stop");
      resolveLongTurn();
      resolveStopHandled();
    }
  });

  assert.deepEqual(events, ["long:start", "stop", "long:end"]);
});

test("handles an approval command while the previous message is waiting", async (t) => {
  t.mock.method(console, "log", () => {});
  const controller = new AbortController();
  const events: string[] = [];
  let releaseTurn!: () => void;
  let turnStarted!: () => void;
  let approvalHandled!: () => void;
  const blocked = new Promise<void>((resolve) => { releaseTurn = resolve; });
  const started = new Promise<void>((resolve) => { turnStarted = resolve; });
  const approved = new Promise<void>((resolve) => { approvalHandled = resolve; });
  let polls = 0;
  const client = {
    async getUpdates() {
      polls += 1;
      if (polls === 1) return { msgs: [{ message_id: "turn", from_user_id: "alice", text: "执行任务" }] };
      if (polls === 2) {
        await started;
        return { msgs: [{ message_id: "approval", from_user_id: "alice", text: "/approve A1" }] };
      }
      await approved;
      controller.abort();
      return { msgs: [] };
    }
  } as WeixinApiClient;

  await monitorWeixin({
    client,
    signal: controller.signal,
    pollIntervalMs: 0,
    async onMessage(message) {
      if (message.id === "turn") {
        events.push("turn:start");
        turnStarted();
        await blocked;
        events.push("turn:end");
        return;
      }
      events.push("approve");
      releaseTurn();
      approvalHandled();
    }
  });

  assert.deepEqual(events, ["turn:start", "approve", "turn:end"]);
});

test("skips duplicate message ids and persists the latest sync key", async (t) => {
  t.mock.method(console, "log", () => {});
  const controller = new AbortController();
  const claimed = new Set<string>();
  const handled: string[] = [];
  const syncKeys: string[] = [];
  let polls = 0;
  const client = {
    async getUpdates(syncKey?: string) {
      polls += 1;
      if (polls === 1) {
        assert.equal(syncKey, "sync-start");
        return {
          get_updates_buf: "sync-next",
          msgs: [
            { message_id: "duplicate", from_user_id: "alice", text: "hello" },
            { message_id: "duplicate", from_user_id: "alice", text: "hello" }
          ]
        };
      }
      controller.abort();
      return { get_updates_buf: "sync-final", msgs: [] };
    }
  } as WeixinApiClient;

  await monitorWeixin({
    client,
    signal: controller.signal,
    pollIntervalMs: 0,
    initialSyncKey: "sync-start",
    claimMessage(message) {
      if (claimed.has(message.id)) return false;
      claimed.add(message.id);
      return true;
    },
    onSyncKey(syncKey) {
      syncKeys.push(syncKey);
    },
    async onMessage(message) {
      handled.push(message.id);
    }
  });

  assert.deepEqual(handled, ["duplicate"]);
  assert.deepEqual(syncKeys, ["sync-next", "sync-final"]);
});
