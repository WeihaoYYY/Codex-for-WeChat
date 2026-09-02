#!/usr/bin/env node

import readline from "node:readline";

const rl = readline.createInterface({ input: process.stdin });
let initialized = false;
let nextTurn = 1;
const activeTurns = new Map();
const pendingServerRequests = new Map();
let nextServerRequest = 10_000;

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function respond(id, result) {
  send({ id, result });
}

function fail(id, message) {
  send({ id, error: { code: -32602, message } });
}

function completedTurn(id, status, error = null) {
  return {
    id,
    items: [],
    itemsView: "full",
    status,
    error,
    startedAt: 1,
    completedAt: 2,
    durationMs: 1
  };
}

function finishPrompt(threadId, turnId, prompt) {
  const progressItemId = `progress-${turnId}`;
  send({
    method: "item/started",
    params: {
      threadId,
      turnId,
      item: { type: "agentMessage", id: progressItemId, text: "", phase: "commentary", memoryCitation: null }
    }
  });
  send({
    method: "item/agentMessage/delta",
    params: { threadId, turnId, itemId: progressItemId, delta: `working:${prompt}` }
  });
  send({
    method: "item/completed",
    params: {
      threadId,
      turnId,
      completedAtMs: Date.now(),
      item: { type: "agentMessage", id: progressItemId, text: `working:${prompt}`, phase: "commentary", memoryCitation: null }
    }
  });
  const itemId = `item-${turnId}`;
  send({
    method: "item/started",
    params: {
      threadId,
      turnId,
      item: { type: "agentMessage", id: itemId, text: "", phase: "final_answer", memoryCitation: null }
    }
  });
  for (const delta of ["reply:", prompt]) {
    send({
      method: "item/agentMessage/delta",
      params: { threadId, turnId, itemId, delta }
    });
  }
  send({
    method: "item/completed",
    params: {
      threadId,
      turnId,
      completedAtMs: Date.now(),
      item: { type: "agentMessage", id: itemId, text: `reply:${prompt}`, phase: "final_answer", memoryCitation: null }
    }
  });
  send({
    method: "turn/completed",
    params: { threadId, turn: completedTurn(turnId, "completed") }
  });
  activeTurns.delete(threadId);
}

rl.on("line", (line) => {
  const message = JSON.parse(line);

  if (!message.method && pendingServerRequests.has(message.id)) {
    const pending = pendingServerRequests.get(message.id);
    pendingServerRequests.delete(message.id);
    if (pending.kind === "approval") {
      finishPrompt(pending.threadId, pending.turnId, `approval:${message.result?.decision ?? "missing"}`);
    } else {
      const text = message.result?.contentItems?.find((item) => item.type === "inputText")?.text ?? "missing";
      finishPrompt(pending.threadId, pending.turnId, `dynamic:${text}`);
    }
    return;
  }

  if (message.method === "initialize") {
    if (message.jsonrpc) {
      fail(message.id, "jsonrpc header must be omitted");
      return;
    }
    if (message.params?.clientInfo?.name !== "codex-weixin") {
      fail(message.id, "missing codex-weixin clientInfo");
      return;
    }
    respond(message.id, {
      userAgent: "fake-codex",
      codexHome: "/tmp/fake-codex-home",
      platformFamily: "unix",
      platformOs: "test"
    });
    return;
  }

  if (message.method === "initialized") {
    initialized = true;
    return;
  }

  if (!initialized) {
    fail(message.id, "Not initialized");
    return;
  }

  if (message.method === "thread/start") {
    if (!["never", "on-request"].includes(message.params?.approvalPolicy)) {
      fail(message.id, "unsupported approvalPolicy");
      return;
    }
    respond(message.id, {
      thread: { id: "thread-new" },
      model: message.params.model ?? "configured-model",
      reasoningEffort: "high"
    });
    return;
  }

  if (message.method === "thread/resume") {
    respond(message.id, {
      thread: { id: message.params.threadId },
      model: "resumed-model",
      reasoningEffort: "medium"
    });
    return;
  }

  if (message.method === "config/read") {
    respond(message.id, {
      config: {
        model: "configured-model",
        model_provider: "FixtureProvider",
        model_reasoning_effort: "high"
      },
      origins: {}
    });
    return;
  }

  if (message.method === "model/list") {
    respond(message.id, {
      data: [{
        id: "configured-model",
        model: "configured-model",
        displayName: "Configured Model",
        description: "Model used by the test fixture.",
        hidden: false,
        supportedReasoningEfforts: [
          { reasoningEffort: "medium", description: "Balanced" },
          { reasoningEffort: "high", description: "Deeper reasoning" }
        ],
        defaultReasoningEffort: "medium",
        isDefault: true
      }],
      nextCursor: null
    });
    return;
  }

  if (message.method === "thread/list") {
    respond(message.id, { data: [{ id: "thread-new" }], nextCursor: null, backwardsCursor: null });
    return;
  }

  if (message.method === "thread/read") {
    respond(message.id, {
      thread: {
        id: message.params.threadId,
        turns: [
          {
            id: "history-turn-1",
            status: "completed",
            startedAt: 1_700_000_000,
            completedAt: 1_700_000_002,
            items: [
              {
                type: "userMessage",
                id: "history-user-1",
                clientId: null,
                content: [{ type: "text", text: "hello history", text_elements: [] }]
              },
              {
                type: "agentMessage",
                id: "history-commentary-1",
                text: "working",
                phase: "commentary",
                memoryCitation: null
              },
              {
                type: "agentMessage",
                id: "history-assistant-1",
                text: "history reply",
                phase: "final_answer",
                memoryCitation: null
              },
              { type: "reasoning", id: "history-reasoning-1", summary: [], content: ["hidden"] }
            ]
          }
        ]
      }
    });
    return;
  }

  if (message.method === "turn/start") {
    const turnId = `turn-${nextTurn++}`;
    const prompt = message.params?.input?.[0]?.text;
    if (message.params?.input?.[0]?.type !== "text" || typeof prompt !== "string") {
      fail(message.id, "turn/start requires text input");
      return;
    }
    activeTurns.set(message.params.threadId, turnId);
    respond(message.id, { turn: completedTurn(turnId, "inProgress") });
    if (prompt === "hold") {
      return;
    }
    if (prompt === "approval") {
      const itemId = `command-${turnId}`;
      send({
        method: "item/started",
        params: {
          threadId: message.params.threadId,
          turnId,
          item: { type: "commandExecution", id: itemId, command: "npm test", cwd: "/tmp/project", status: "inProgress", commandActions: [] }
        }
      });
      const requestId = nextServerRequest++;
      pendingServerRequests.set(requestId, { kind: "approval", threadId: message.params.threadId, turnId });
      send({
        id: requestId,
        method: "item/commandExecution/requestApproval",
        params: {
          kind: "command",
          threadId: message.params.threadId,
          turnId,
          itemId,
          startedAtMs: Date.now(),
          command: "npm test",
          cwd: "/tmp/project",
          availableDecisions: ["accept", "acceptForSession", "decline", "cancel"]
        }
      });
      return;
    }
    if (prompt === "dynamic") {
      const callId = `dynamic-${turnId}`;
      send({
        method: "item/started",
        params: {
          threadId: message.params.threadId,
          turnId,
          item: { type: "dynamicToolCall", id: callId, tool: "snapshot", arguments: {}, status: "inProgress" }
        }
      });
      const requestId = nextServerRequest++;
      pendingServerRequests.set(requestId, { kind: "dynamic", threadId: message.params.threadId, turnId });
      send({
        id: requestId,
        method: "item/tool/call",
        params: {
          threadId: message.params.threadId,
          turnId,
          callId,
          namespace: "weixin_browser",
          tool: "snapshot",
          arguments: {}
        }
      });
      return;
    }
    setTimeout(() => {
      finishPrompt(message.params.threadId, turnId, prompt);
    }, 5);
    return;
  }

  if (message.method === "turn/interrupt") {
    const activeTurnId = activeTurns.get(message.params.threadId);
    if (activeTurnId !== message.params.turnId) {
      fail(message.id, "turn/interrupt used the wrong turnId");
      return;
    }
    respond(message.id, {});
    send({
      method: "turn/completed",
      params: { threadId: message.params.threadId, turn: completedTurn(activeTurnId, "interrupted") }
    });
    activeTurns.delete(message.params.threadId);
    return;
  }

  fail(message.id, `unsupported method: ${message.method}`);
});
