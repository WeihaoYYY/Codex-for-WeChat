export type ServerCommand = "start" | "help";

export type CliCommand =
  | { name: "start" }
  | { name: "help" }
  | { name: "push"; text: string; idempotencyKey?: string }
  | { name: "task"; prompt: string; workspace?: string; title?: string; idempotencyKey?: string; wait: boolean }
  | { name: "notify"; payload: string };

export function parseServerCommand(args: string[]): ServerCommand {
  if (args.length === 0) {
    return "start";
  }
  if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) {
    return "help";
  }
  throw new Error(`Unknown argument: ${args.join(" ")}. Run codex-weixin --help.`);
}

export function parseCliCommand(args: string[]): CliCommand {
  if (!args.length) return { name: "start" };
  if (args.length === 1 && (args[0] === "--help" || args[0] === "-h" || args[0] === "help")) return { name: "help" };
  const [name, ...rest] = args;
  if (name === "notify") {
    if (!rest.length) throw new Error("notify requires the Codex JSON payload");
    return { name, payload: rest.join(" ") };
  }
  if (name === "push") {
    const parsed = parseFlags(rest, new Set(["text", "idempotency-key"]));
    return {
      name,
      text: parsed.values.get("text") ?? parsed.positionals.join(" "),
      idempotencyKey: parsed.values.get("idempotency-key")
    };
  }
  if (name === "task") {
    const parsed = parseFlags(rest, new Set(["prompt", "cwd", "title", "idempotency-key"]), new Set(["wait"]));
    return {
      name,
      prompt: parsed.values.get("prompt") ?? parsed.positionals.join(" "),
      workspace: parsed.values.get("cwd"),
      title: parsed.values.get("title"),
      idempotencyKey: parsed.values.get("idempotency-key"),
      wait: parsed.switches.has("wait")
    };
  }
  throw new Error(`Unknown argument: ${args.join(" ")}. Run codex-weixin --help.`);
}

export function serverHelpText(): string {
  return [
    "Usage:",
    "  codex-weixin",
    "  codex-weixin push --text \"message\" [--idempotency-key KEY]",
    "  codex-weixin task --prompt \"instruction\" [--cwd PATH] [--title TITLE] [--wait]",
    "  codex-weixin notify '<Codex notify JSON>'",
    "",
    "Starts the local codex-weixin Web service.",
    "",
    "Options:",
    "  -h, --help  Show this help without starting the service",
    "  push        Proactively send text to the configured WeChat recipient",
    "  task        Run a dedicated Codex task and deliver progress/results to WeChat",
    "  notify      Forward a Codex agent-turn-complete notification to WeChat",
    "",
    "Environment:",
    "  CODEX_WEIXIN_PORT       Local Web port (default: 8787)",
    "  CODEX_WEIXIN_STATE_DIR  State directory (default: ~/.codex-weixin)",
    "  CODEX_WEIXIN_OPEN=0     Do not open the browser automatically"
  ].join("\n");
}

function parseFlags(args: string[], valueFlags: Set<string>, switchFlags = new Set<string>()): {
  values: Map<string, string>;
  switches: Set<string>;
  positionals: string[];
} {
  const values = new Map<string, string>();
  const switches = new Set<string>();
  const positionals: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }
    const key = arg.slice(2);
    if (switchFlags.has(key)) {
      switches.add(key);
      continue;
    }
    if (!valueFlags.has(key)) throw new Error(`Unknown option: ${arg}`);
    const value = args[index + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`${arg} requires a value`);
    values.set(key, value);
    index += 1;
  }
  return { values, switches, positionals };
}
