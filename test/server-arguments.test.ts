import assert from "node:assert/strict";
import test from "node:test";

import { parseCliCommand, parseServerCommand, serverHelpText } from "../src/server/arguments.js";

test("server arguments do not start the service for help", () => {
  assert.equal(parseServerCommand([]), "start");
  assert.equal(parseServerCommand(["--help"]), "help");
  assert.equal(parseServerCommand(["-h"]), "help");
  assert.match(serverHelpText(), /without starting the service/);
});

test("server arguments reject unknown values", () => {
  assert.throws(() => parseServerCommand(["--unknown"]), /Unknown argument/);
});

test("automation CLI parses proactive tasks and Codex notify payloads", () => {
  assert.deepEqual(parseCliCommand(["task", "--prompt", "run checks", "--cwd", "E:\\work", "--wait"]), {
    name: "task",
    prompt: "run checks",
    workspace: "E:\\work",
    title: undefined,
    idempotencyKey: undefined,
    wait: true
  });
  assert.deepEqual(parseCliCommand(["notify", '{"type":"agent-turn-complete"}']), {
    name: "notify",
    payload: '{"type":"agent-turn-complete"}'
  });
});
