import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { AutomationManager } from "../src/automation/manager.js";
import { BridgeService } from "../src/bridge/service.js";
import { startLocalHttpServer } from "../src/server/http-server.js";
import { defaultConfig } from "../src/state/config.js";
import { resolveStatePaths } from "../src/state/paths.js";
import { RuntimeStateStore } from "../src/state/runtime-state.js";

test("proactive Codex tasks use a detached session and flush queued replies after a fresh WeChat message", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-weixin-proactive-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = new RuntimeStateStore(resolveStatePaths(root));
  const active = store.createSession("alice@im.wechat", root, "current");
  const sent: string[] = [];
  const service = new BridgeService({
    config: { ...defaultConfig(root), allowedSenderIds: ["alice@im.wechat"], streamReplies: false },
    stateStore: store,
    weixin: {
      async sendTyping() {},
      async sendText(input: { text: string }) {
        sent.push(input.text);
        return { messageId: "message" };
      }
    } as never,
    runner: {
      async run() {
        return { raw: "", text: "主动完成", threadId: "thread-proactive" };
      },
      async stop() {}
    } as never
  });

  const result = await service.runProactiveTask({
    senderId: "alice@im.wechat",
    prompt: "执行主动任务",
    workspace: root,
    title: "计划任务"
  });
  assert.equal(result.delivery, "queued");
  assert.equal(store.getActiveSession("alice@im.wechat")?.id, active.id);
  assert.notEqual(result.sessionId, active.id);
  assert.equal(store.listPendingDeliveries("alice@im.wechat").length, 2);

  await service.handleMessage({
    id: "refresh",
    senderId: "alice@im.wechat",
    contextToken: "fresh-context",
    text: "/help",
    raw: {}
  });
  assert.equal(sent[0], "主动完成");
  assert.equal(sent[1], "本次任务结束");
  assert.equal(store.listPendingDeliveries("alice@im.wechat").length, 0);
});

test("automation manager fails closed to one configured recipient and deduplicates pushes", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-weixin-automation-manager-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const paths = resolveStatePaths(root);
  const calls: string[] = [];
  const config = {
    ...defaultConfig(root),
    automationEnabled: true,
    automationAccountId: "account-one",
    automationSenderId: "alice@im.wechat"
  };
  const manager = new AutomationManager({
    paths,
    configProvider: () => config,
    accountManager: {
      listAccounts: () => [{ accountId: "account-one", status: "running", pairedSenderIds: ["alice@im.wechat"] }],
      async sendAutomationText(_accountId: string, senderId: string, text: string) {
        calls.push(`${senderId}:${text}`);
        return "sent" as const;
      }
    } as never
  });

  const first = await manager.push({ text: "hello", idempotencyKey: "same" });
  const second = await manager.push({ text: "hello", idempotencyKey: "same" });
  assert.equal(first.job.status, "completed");
  assert.equal(second.duplicate, true);
  assert.deepEqual(calls, ["alice@im.wechat:hello"]);
});

test("automation HTTP endpoints require the persistent bearer token and do not require a browser origin", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-weixin-automation-http-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const job = {
    id: "job-one",
    kind: "push" as const,
    status: "completed" as const,
    promptPreview: "hello",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  const server = await startLocalHttpServer({
    paths: resolveStatePaths(root),
    accountManager: {} as never,
    automationToken: "persistent-secret",
    automationManager: {
      async push() { return { job, duplicate: false }; },
      createTask() { return { job: { ...job, kind: "task" as const, status: "queued" as const }, duplicate: false }; },
      get() { return job; }
    } as never,
    port: 0
  });
  t.after(() => server.close());

  const denied = await fetch(`${server.url}/api/automation/push`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: "hello" })
  });
  assert.equal(denied.status, 403);

  const accepted = await fetch(`${server.url}/api/automation/push`, {
    method: "POST",
    headers: { authorization: "Bearer persistent-secret", "content-type": "application/json" },
    body: JSON.stringify({ text: "hello" })
  });
  assert.equal(accepted.status, 201);
  assert.equal((await accepted.json() as { job: { id: string } }).job.id, "job-one");
});
