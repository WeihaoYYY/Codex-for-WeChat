export type BridgeCommand = {
  name: string;
  arg: string;
};

const STOP_COMMAND_ALIASES = new Set([
  "停止",
  "停止思考",
  "停止任务"
]);

export function parseCommand(text: string): BridgeCommand | undefined {
  const trimmed = text.trim();
  if (STOP_COMMAND_ALIASES.has(trimmed)) {
    return { name: "stop", arg: "" };
  }
  if (!trimmed.startsWith("/")) {
    return undefined;
  }
  const [name, ...rest] = trimmed.slice(1).split(/\s+/);
  return { name: name.toLowerCase(), arg: rest.join(" ") };
}

export function parseNaturalControllerCommand(text: string): BridgeCommand | undefined {
  const trimmed = text.trim();
  if (new Set(["状况", "状态", "报告"]).has(trimmed)) {
    return { name: "controller", arg: "status" };
  }
  const decision = trimmed.match(/^(允许|继续|拒绝)(?:\s+(C-[A-Fa-f0-9]{12}))?$/);
  if (!decision) return undefined;
  return {
    name: "controller",
    arg: `${decision[1] === "拒绝" ? "reject" : "continue"}${decision[2] ? ` ${decision[2]}` : ""}`
  };
}

export function isStopCommandText(text: string): boolean {
  return parseCommand(text)?.name === "stop";
}

export function isPriorityCommandText(text: string): boolean {
  const name = parseCommand(text)?.name;
  return name === "stop" || name === "approve" || name === "approve-session" || name === "deny" || name === "controller";
}
