export type BridgeErrorCode =
  | "WINDOWS_SANDBOX_START_FAILED"
  | "CODEX_SESSION_RESUME_FAILED"
  | "CODEX_SESSION_RECOVERY_FAILED"
  | "CODEX_TIMEOUT"
  | "MESSAGE_HANDLING_FAILED";

export type UserFacingErrorOptions = {
  code?: BridgeErrorCode;
  reference?: string;
};

export function bridgeErrorCode(error: unknown): BridgeErrorCode {
  const message = error instanceof Error ? error.message : String(error);
  if (/CreateProcessAsUserW failed:\s*1312|codexExecSandbox/i.test(message)) {
    return "WINDOWS_SANDBOX_START_FAILED";
  }
  if (/Codex session recovery failed/i.test(message)) {
    return "CODEX_SESSION_RECOVERY_FAILED";
  }
  if (/app-server\s+thread\/resume\s+failed/i.test(message)) {
    return "CODEX_SESSION_RESUME_FAILED";
  }
  if (/timed out|timeout/i.test(message)) {
    return "CODEX_TIMEOUT";
  }
  return "MESSAGE_HANDLING_FAILED";
}

export function userFacingMessageHandlingError(error: unknown, options: UserFacingErrorOptions = {}): string {
  const code = options.code ?? bridgeErrorCode(error);
  const reference = options.reference ? `；参考号：${options.reference}` : "";
  if (code === "WINDOWS_SANDBOX_START_FAILED") {
    return [
      "[codex-weixin] Windows Codex sandbox 启动失败。",
      "可在 ~/.codex-weixin/config.json 中设置 \"codexExecSandbox\": \"danger-full-access\" 后重启。",
      `该设置会让 Codex 获得本机完整访问权限，请仅在理解并接受安全风险时启用。错误码：${code}${reference}。`
    ].join("\n");
  }
  if (code === "CODEX_SESSION_RECOVERY_FAILED") {
    return `[codex-weixin] Codex 旧会话恢复失败，自动新建会话也未成功；本轮请求未执行。错误码：${code}${reference}。`;
  }
  if (code === "CODEX_SESSION_RESUME_FAILED") {
    return `[codex-weixin] Codex 旧会话恢复失败；本轮请求未执行。错误码：${code}${reference}。`;
  }
  if (code === "CODEX_TIMEOUT") {
    return `[codex-weixin] 本轮任务执行时间过长，已停止处理。请拆成更小的步骤后重试。错误码：${code}${reference}。`;
  }
  return `[codex-weixin] 本轮消息处理失败；本轮请求未确认执行。错误码：${code}${reference}。`;
}
