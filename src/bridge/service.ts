import path from "node:path";

import { AccessController } from "./access.js";
import { parseActionBlocks } from "./actions.js";
import { ApprovalBroker, type ApprovalResolution } from "./approval-broker.js";
import { isPriorityCommandText, parseCommand } from "./commands.js";
import { buildPrompt, buildPromptPreview, chunkText, parsePrompt } from "./format.js";
import { PromptBuffer } from "./prompt-buffer.js";
import type { CodexModelOption, CodexRuntimeInfo } from "../codex/app-server-runner.js";
import { HybridCodexRunner } from "../codex/runner.js";
import { isWorkspaceAllowed, type CodexWeixinConfig } from "../state/config.js";
import { RuntimeStateStore, type ManagedSession } from "../state/runtime-state.js";
import { WeixinApiClient, isStaleContextError, type FetchLike } from "../weixin/api.js";
import { downloadInboundAttachments, InboundMediaTooLargeError, sendLocalMediaFile } from "../weixin/media.js";
import type { NormalizedWeixinMessage } from "../weixin/messages.js";
import type { PromptBufferItem } from "./prompt-buffer.js";

export type BridgeServiceOptions = {
  accountId?: string;
  config: CodexWeixinConfig;
  stateStore: RuntimeStateStore;
  weixin: WeixinApiClient;
  runner?: HybridCodexRunner;
  listCodexModels?: () => Promise<CodexModelOption[]>;
  inboundDir?: string;
  mediaFetch?: FetchLike;
  onTurnStatus?: (status: { senderId: string; sessionId: string; active: boolean }) => void;
};

export type ProactiveTaskResult = {
  sessionId: string;
  delivery: "sent" | "queued";
};

export class BridgeService {
  private readonly access: AccessController;
  private readonly approvals = new ApprovalBroker();
  private readonly buffers: PromptBuffer;
  private readonly runner: HybridCodexRunner;
  private readonly senderQueues = new Map<string, Promise<unknown>>();

  constructor(private readonly options: BridgeServiceOptions) {
    this.access = new AccessController({
      allowedSenderIds: options.config.allowedSenderIds,
      pairedSenderIds: options.stateStore.listPairedSenderIds()
    });
    this.buffers = new PromptBuffer({
      maxItems: options.config.maxBufferItems,
      ttlMs: options.config.promptBufferTtlMs
    });
    this.runner = options.runner ?? new HybridCodexRunner({
      backend: options.config.codexBackend,
      codexBin: options.config.codexBin,
      execSandbox: options.config.codexExecSandbox,
      browser: browserOptions(options.config)
    });
  }

  async handleMessage(message: NormalizedWeixinMessage): Promise<void> {
    if (message.contextToken) {
      this.options.stateStore.rememberContextToken(message.senderId, message.contextToken);
    }

    const access = this.access.requireAccess(message.senderId);
    if (!access.allowed) {
      await this.reply(message.senderId, access.message);
      return;
    }
    this.options.stateStore.setPairedSenderIds(this.access.listPairedSenderIds());
    this.options.stateStore.ensureActiveSession(message.senderId, this.options.config.defaultCwd);

    if (isPriorityCommandText(message.text)) {
      await this.handleAuthorizedMessage(message);
      return;
    }
    await this.enqueueSender(message.senderId, () => this.handleAuthorizedMessage(message));
  }

  private async handleAuthorizedMessage(message: NormalizedWeixinMessage): Promise<void> {
    await this.flushPendingDeliveries(message.senderId);

    const command = parseCommand(message.text);
    if (command) {
      await this.handleCommand(message, command);
      return;
    }

    const items = await this.promptItemsFromMessageWithNotice(message);
    if (!items) return;

    if (this.buffers.isActive(message.senderId)) {
      for (const item of items) {
        this.buffers.append(message.senderId, item);
      }
      await this.reply(message.senderId, "Buffered. Send /prompt done when ready.");
      return;
    }

    await this.runCodexTurn(message, "", items);
  }

  async sendProactiveText(senderId: string, text: string, deliveryId?: string): Promise<"sent" | "queued"> {
    const access = this.access.requireAccess(senderId);
    if (!access.allowed) throw new Error("Automation recipient is not an authorized WeChat sender");
    return this.enqueueSender(senderId, () => this.reply(senderId, text, deliveryId));
  }

  async runProactiveTask(input: {
    senderId: string;
    prompt: string;
    workspace: string;
    title?: string;
  }): Promise<ProactiveTaskResult> {
    const access = this.access.requireAccess(input.senderId);
    if (!access.allowed) throw new Error("Automation recipient is not an authorized WeChat sender");
    if (!isWorkspaceAllowed(input.workspace, this.options.config.allowedWorkspaces)) {
      throw new Error(`Workspace is not allowed: ${input.workspace}`);
    }
    return this.enqueueSender(input.senderId, async () => {
      const session = this.options.stateStore.createSession(
        input.senderId,
        input.workspace,
        input.title ?? `主动任务 ${new Date().toLocaleString("zh-CN", { hour12: false })}`,
        false
      );
      const delivery = await this.runCodexTurn(
        { id: `automation:${session.id}`, senderId: input.senderId, text: input.prompt, attachments: [], raw: {} },
        input.prompt,
        [],
        session
      );
      return { sessionId: session.id, delivery };
    });
  }

  private async handleCommand(message: NormalizedWeixinMessage, command: { name: string; arg: string }): Promise<void> {
    switch (command.name) {
      case "help":
      case "h":
        await this.reply(message.senderId, helpText());
        return;
      case "status":
      case "where":
        await this.reply(message.senderId, await this.statusText(message.senderId));
        return;
      case "bind":
        await this.bindWorkspace(message.senderId, command.arg);
        return;
      case "new":
        this.options.stateStore.createSession(message.senderId, this.options.stateStore.getWorkspace(message.senderId) ?? this.options.config.defaultCwd);
        await this.reply(message.senderId, "Created a new Codex session for the next message.");
        return;
      case "resume":
        await this.handleResumeCommand(message.senderId, command.arg);
        return;
      case "model":
        await this.handleModelCommand(message.senderId, command.arg);
        return;
      case "effort":
        await this.handleEffortCommand(message.senderId, command.arg);
        return;
      case "stream":
        await this.handleStreamCommand(message.senderId, command.arg);
        return;
      case "prompt":
        await this.handlePromptCommand(message.senderId, command.arg);
        return;
      case "approve":
        await this.handleApprovalCommand(message.senderId, command.arg, "accept");
        return;
      case "approve-session":
        await this.handleApprovalCommand(message.senderId, command.arg, "acceptForSession");
        return;
      case "deny":
        await this.handleApprovalCommand(message.senderId, command.arg, "decline");
        return;
      case "stop":
        this.approvals.cancelForSender(message.senderId);
        await this.runner.stop(this.options.stateStore.getThread(message.senderId));
        await this.reply(message.senderId, "Stop signal sent.");
        return;
      default:
        await this.reply(message.senderId, `Unknown command: /${command.name}. Send /help.`);
    }
  }

  private async handleApprovalCommand(
    senderId: string,
    rawCode: string,
    decision: "accept" | "acceptForSession" | "decline"
  ): Promise<void> {
    if (!rawCode.trim()) {
      const pending = this.approvals.list(senderId);
      if (!pending.length) {
        await this.reply(senderId, "当前没有等待确认的操作。");
        return;
      }
      await this.reply(senderId, pending.map((approval) => formatPendingApproval(approval)).join("\n\n"));
      return;
    }
    const result = this.approvals.resolve(senderId, rawCode, decision);
    await this.reply(senderId, approvalResolutionMessage(rawCode, decision, result));
  }

  private async requestApproval(
    senderId: string,
    request: Parameters<ApprovalBroker["request"]>[1]
  ): Promise<Awaited<ReturnType<ApprovalBroker["request"]>["promise"]>> {
    const pending = this.approvals.request(senderId, request);
    try {
      await this.reply(senderId, formatPendingApproval(pending));
    } catch (error) {
      this.approvals.resolve(senderId, pending.code, "cancel");
      throw error;
    }
    return pending.promise;
  }

  private async bindWorkspace(senderId: string, rawPath: string): Promise<void> {
    if (!rawPath.trim()) {
      await this.reply(senderId, "Usage: /bind <absolute-workspace-path>");
      return;
    }
    const workspace = path.resolve(rawPath.trim());
    if (!isWorkspaceAllowed(workspace, this.options.config.allowedWorkspaces)) {
      await this.reply(senderId, `Workspace is not allowed: ${workspace}`);
      return;
    }
    this.options.stateStore.setWorkspace(senderId, workspace);
    await this.reply(senderId, `Bound to workspace:\n${workspace}`);
  }

  private async handleResumeCommand(senderId: string, arg: string): Promise<void> {
    const sessions = this.options.stateStore.listSessions().filter((session) => session.senderId === senderId);
    const input = arg.trim();
    if (!input) {
      const activeId = this.options.stateStore.getActiveSession(senderId)?.id;
      const previews = await Promise.all(sessions.map((session) => this.sessionPromptPreview(session)));
      const lines = ["历史会话（最近更新优先）："];
      for (const [index, session] of sessions.entries()) {
        lines.push(
          `[R${index + 1}] ${session.id === activeId ? "【当前】" : ""}${session.title}`,
          `   最近内容：${previews[index]}（${formatSessionTime(session.updatedAt)}）`
        );
      }
      lines.push("", "发送 /resume R1 这类切换编号继续会话；R1 是切换编号，“会话 6”等是会话名称。");
      for (const chunk of chunkText(lines.join("\n"))) {
        await this.reply(senderId, chunk);
      }
      return;
    }
    if (/^\d+$/.test(input)) {
      await this.reply(senderId, "请使用列表中 R 开头的切换编号，例如 /resume R1；不要使用会话名称里的数字。");
      return;
    }
    const match = /^r([1-9]\d*)$/i.exec(input);
    if (!match) {
      await this.reply(senderId, "用法：/resume 或 /resume R<编号>，例如 /resume R1。");
      return;
    }
    const selected = sessions[Number(match[1]) - 1];
    if (!selected) {
      await this.reply(senderId, "没有这个切换编号。发送 /resume 查看可用的 R 编号。");
      return;
    }
    const preview = await this.sessionPromptPreview(selected);
    this.options.stateStore.activateSession(selected.id);
    await this.reply(senderId, [
      `已通过 ${input.toUpperCase()} 切换到：${selected.title}`,
      `最近内容：${preview}`,
      selected.threadId ? "下一条消息将继续该历史会话。" : "该会话尚无历史内容，下一条消息将创建新上下文。"
    ].join("\n"));
  }

  private async sessionPromptPreview(session: ManagedSession): Promise<string> {
    if (session.lastPromptPreview) return session.lastPromptPreview;
    if (!session.threadId) return "尚未开始对话";
    try {
      const history = await this.runner.getHistory(session.threadId);
      const lastUserMessage = [...history].reverse().find((message) => message.role === "user");
      if (!lastUserMessage) return "暂无内容摘要";
      const parsed = parsePrompt(lastUserMessage.text);
      const preview = buildPromptPreview(parsed.text, parsed.attachments);
      if (!preview) return "暂无内容摘要";
      this.options.stateStore.setSessionPromptPreview(session.id, preview);
      return preview;
    } catch (error) {
      console.warn(`Unable to read Codex history for session ${session.id}: ${error instanceof Error ? error.message : String(error)}`);
      return "历史摘要暂不可用";
    }
  }

  private async handlePromptCommand(senderId: string, arg: string): Promise<void> {
    const sub = arg.trim().toLowerCase();
    if (sub === "start") {
      const result = this.buffers.start(senderId);
      await this.reply(senderId, result.status === "started" ? "Prompt buffer started." : "Prompt buffer is already active.");
      return;
    }
    if (sub === "done") {
      const flushed = this.buffers.done(senderId);
      if (flushed.status === "empty") {
        await this.reply(senderId, "Prompt buffer is empty.");
        return;
      }
      await this.runCodexTurn({ id: "buffer", senderId, text: "", attachments: [], raw: {} }, "", flushed.items);
      return;
    }
    await this.reply(senderId, "Usage: /prompt start or /prompt done");
  }

  private async handleModelCommand(senderId: string, arg: string): Promise<void> {
    const models = await this.listCodexModels();
    const input = arg.trim();
    if (!input) {
      const runtime = await this.effectiveRuntime(senderId);
      const session = this.options.stateStore.getActiveSession(senderId);
      const lines = [
        `当前模型：${runtime.model ?? "Codex 默认"}${session?.model ? "（本会话）" : "（继承 Web/Codex 设置）"}`
      ];
      if (models.length) {
        lines.push("", "可用模型：", ...models.map((model, index) => `${index + 1}. ${model.displayName}（${model.model}）`));
        lines.push("", "发送 /model <序号或模型 ID> 切换；/model default 恢复继承设置。");
      } else {
        lines.push("", "暂时无法读取模型列表。仍可发送 /model <完整模型 ID> 切换。", "/model default 恢复继承设置。");
      }
      await this.reply(senderId, lines.join("\n"));
      return;
    }
    if (input.toLowerCase() === "default") {
      this.options.stateStore.setModelOverride(senderId);
      const runtime = await this.effectiveRuntime(senderId);
      await this.reply(senderId, `已恢复继承 Web/Codex 模型设置。\n当前模型：${runtime.model ?? "Codex 默认"}`);
      return;
    }

    const selected = selectModel(models, input);
    if (!selected && (models.length || !isPlausibleModelId(input))) {
      await this.reply(senderId, "模型不存在。发送 /model 查看可用模型，或使用 /model default 恢复继承设置。");
      return;
    }
    const currentRuntime = await this.effectiveRuntime(senderId);
    const model = selected?.model ?? input;
    this.options.stateStore.setModelOverride(senderId, model);
    let adjustedEffort: string | undefined;
    if (currentRuntime.effort && selected?.supportedEfforts.length && !selected.supportedEfforts.some((option) => option.effort === currentRuntime.effort)) {
      adjustedEffort = selected.supportedEfforts.some((option) => option.effort === selected.defaultEffort)
        ? selected.defaultEffort
        : selected.supportedEfforts[0]?.effort;
      this.options.stateStore.setEffortOverride(senderId, adjustedEffort);
    }
    await this.reply(senderId, [
      `本会话模型已切换为：${selected?.displayName ?? model}（${model}）`,
      ...(adjustedEffort ? [`原来的推理强度不受该模型支持，已自动调整为：${formatEffort(adjustedEffort)}`] : []),
      "下一条消息开始生效。"
    ].join("\n"));
  }

  private async handleEffortCommand(senderId: string, arg: string): Promise<void> {
    const models = await this.listCodexModels();
    const runtime = await this.effectiveRuntime(senderId);
    const model = models.find((option) => option.model === runtime.model);
    const efforts = availableEfforts(model, models);
    const input = arg.trim();
    if (!input) {
      const session = this.options.stateStore.getActiveSession(senderId);
      await this.reply(senderId, [
        `当前推理强度：${formatEffort(runtime.effort)}${session?.effort ? "（本会话）" : "（继承 Web/Codex 设置）"}`,
        `当前模型：${runtime.model ?? "Codex 默认"}`,
        "",
        "可用推理强度：",
        ...efforts.map((effort, index) => `${index + 1}. ${formatEffort(effort)}`),
        "",
        "发送 /effort <序号或英文值> 切换；/effort default 恢复继承设置。"
      ].join("\n"));
      return;
    }
    if (input.toLowerCase() === "default") {
      this.options.stateStore.setEffortOverride(senderId);
      const nextRuntime = await this.effectiveRuntime(senderId);
      await this.reply(senderId, `已恢复继承 Web/Codex 推理强度设置。\n当前推理强度：${formatEffort(nextRuntime.effort)}`);
      return;
    }
    const effort = selectEffort(efforts, input);
    if (!effort) {
      await this.reply(senderId, "该模型不支持这个推理强度。发送 /effort 查看可用选项。");
      return;
    }
    this.options.stateStore.setEffortOverride(senderId, effort);
    await this.reply(senderId, `本会话推理强度已切换为：${formatEffort(effort)}\n下一条消息开始生效。`);
  }

  private async handleStreamCommand(senderId: string, arg: string): Promise<void> {
    const input = arg.trim().toLowerCase();
    const session = this.options.stateStore.getActiveSession(senderId);
    const inherited = this.options.config.streamReplies;
    if (!input) {
      const effective = session?.streamReplies ?? inherited;
      const source = typeof session?.streamReplies === "boolean" ? "本会话设置" : "继承全局";
      await this.reply(senderId, `当前过程进度：${effective ? "开启" : "关闭"}（${source}）\n发送 /stream on、/stream off 或 /stream default 切换。`);
      return;
    }
    if (input === "default") {
      this.options.stateStore.setStreamRepliesOverride(senderId);
      await this.reply(senderId, `已恢复继承全局设置。当前过程进度：${inherited ? "开启" : "关闭"}。`);
      return;
    }
    if (input !== "on" && input !== "off") {
      await this.reply(senderId, "用法：/stream on、/stream off 或 /stream default");
      return;
    }
    const enabled = input === "on";
    this.options.stateStore.setStreamRepliesOverride(senderId, enabled);
    await this.reply(senderId, `本会话过程进度已${enabled ? "开启" : "关闭"}。`);
  }

  private async promptItemsFromMessage(message: NormalizedWeixinMessage): Promise<PromptBufferItem[]> {
    const items: PromptBufferItem[] = [];
    if (message.text.trim()) {
      items.push({ kind: "text", text: message.text });
    }
    const attachments = message.attachments ?? [];
    if (!attachments.length) {
      return items;
    }
    try {
      const downloaded = await downloadInboundAttachments({
        rootDir: this.options.inboundDir ?? path.join(this.options.config.defaultCwd, ".codex-weixin-inbound"),
        senderId: message.senderId,
        messageId: message.id,
        attachments,
        maxBytes: this.options.config.maxInboundBytes,
        fetch: this.options.mediaFetch
      });
      for (const attachment of downloaded) {
        items.push({
          kind: attachment.kind,
          path: attachment.path,
          label: attachment.label
        });
      }
    } catch (error) {
      if (error instanceof InboundMediaTooLargeError) throw error;
      items.push({
        kind: "text",
        text: `[WeChat attachment download failed: ${error instanceof Error ? error.message : String(error)}]`
      });
    }
    return items;
  }

  private async promptItemsFromMessageWithNotice(message: NormalizedWeixinMessage): Promise<PromptBufferItem[] | undefined> {
    try {
      return await this.promptItemsFromMessage(message);
    } catch (error) {
      if (!(error instanceof InboundMediaTooLargeError)) throw error;
      const maxMiB = Math.floor(error.maxBytes / (1024 * 1024));
      await this.reply(message.senderId, `附件超过 ${maxMiB} MiB 上限，请压缩或裁剪后重新发送。`);
      return undefined;
    }
  }

  private async runCodexTurn(
    message: NormalizedWeixinMessage,
    text: string,
    attachments: PromptBufferItem[] = [],
    targetSession?: ManagedSession
  ): Promise<"sent" | "queued"> {
    const session = targetSession ?? this.options.stateStore.ensureActiveSession(message.senderId, this.options.config.defaultCwd);
    const promptPreview = buildPromptPreview(text, attachments);
    if (promptPreview) {
      this.options.stateStore.setSessionPromptPreview(session.id, promptPreview);
    }
    const workspace = session.workspace;
    const threadId = session.threadId || undefined;
    const progressEnabled = session.streamReplies ?? this.options.config.streamReplies;
    const sentProgress = new Set<string>();
    let delivery: "sent" | "queued" = "sent";
    this.options.onTurnStatus?.({ senderId: message.senderId, sessionId: session.id, active: true });
    try {
      await this.withTyping(message.senderId, async () => {
        console.log(`[codex-weixin] starting Codex turn for ${message.senderId} in ${workspace}`);
        const result = await this.runner.run({
          prompt: buildPrompt(text, attachments),
          cwd: workspace,
          threadId,
          model: session.model ?? this.options.config.model,
          effort: session.effort ?? this.options.config.effort,
          sessionKey: `${this.options.accountId ?? "default"}:${message.senderId}:${session.id}`,
          onApproval: (request) => this.requestApproval(message.senderId, request),
          ...(progressEnabled ? {
            onProgress: async (progress: string) => {
              const progressText = progress.trim();
              if (!progressText || sentProgress.has(progressText)) return;
              sentProgress.add(progressText);
              if (await this.reply(message.senderId, `【进度】${progressText}`) === "queued") delivery = "queued";
            }
          } : {})
        });
        console.log(`[codex-weixin] Codex turn completed for ${message.senderId}; text=${result.text.length} chars`);
        if (result.threadId) {
          this.options.stateStore.setSessionThread(session.id, result.threadId);
        }
        const parsed = parseActionBlocks(result.text);
        const remaining = chunkText(parsed.visibleText);
        if (remaining.length) {
          for (const chunk of remaining) {
            if (await this.reply(message.senderId, chunk) === "queued") delivery = "queued";
          }
        }
        for (const action of parsed.actions.send) {
          await this.sendLocalMedia(message.senderId, action);
        }
      });
    } finally {
      this.options.onTurnStatus?.({ senderId: message.senderId, sessionId: session.id, active: false });
    }
    return delivery;
  }

  private async sendLocalMedia(senderId: string, action: { type: "image" | "file" | "video"; path: string }): Promise<void> {
    try {
      await sendLocalMediaFile({
        client: this.options.weixin,
        toUserId: senderId,
        contextToken: this.options.stateStore.getContextToken(senderId),
        filePath: action.path,
        kind: action.type
      });
    } catch (error) {
      await this.reply(senderId, `[codex-weixin] Failed to send ${action.type}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async withTyping(senderId: string, run: () => Promise<void>): Promise<void> {
    const sendTyping = async (typing: boolean) => {
      try {
        await this.options.weixin.sendTyping({
          toUserId: senderId,
          contextToken: this.options.stateStore.getContextToken(senderId),
          typing
        });
      } catch (error) {
        console.warn(`WeChat typing indicator failed for ${senderId}: ${error instanceof Error ? error.message : String(error)}`);
      }
    };

    await sendTyping(true);
    const timer = setInterval(() => {
      void sendTyping(true);
    }, 5_000);
    try {
      await run();
    } finally {
      clearInterval(timer);
      await sendTyping(false);
    }
  }

  private async statusText(senderId: string): Promise<string> {
    const session = this.options.stateStore.getActiveSession(senderId);
    const workspace = session?.workspace ?? this.options.config.defaultCwd;
    const runtime = await this.effectiveRuntime(senderId);
    return [
      "codex-weixin status",
      `sender: ${senderId}`,
      `session: ${session?.title ?? "(new)"}`,
      `workspace: ${workspace}`,
      `thread: ${session?.threadId || "(new)"}`,
      `backend: ${this.options.config.codexBackend}`,
      `exec sandbox: ${this.options.config.codexExecSandbox ?? "(Codex default)"}`,
      `model: ${runtime.model ?? "(Codex default)"}`,
      `effort: ${runtime.effort ?? "(Codex default)"}`,
      `stream replies: ${(session?.streamReplies ?? this.options.config.streamReplies) ? "on" : "off"}${typeof session?.streamReplies === "boolean" ? " (session)" : " (global)"}`,
      `browser control: ${this.options.config.browserEnabled ? "on" : "off"}`
    ].join("\n");
  }

  private async listCodexModels(): Promise<CodexModelOption[]> {
    try {
      return await (this.options.listCodexModels?.() ?? this.runner.listModels());
    } catch (error) {
      console.warn(`Codex model list unavailable: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  }

  private async effectiveRuntime(senderId: string): Promise<CodexRuntimeInfo> {
    const session = this.options.stateStore.getActiveSession(senderId);
    const workspace = session?.workspace ?? this.options.config.defaultCwd;
    let runtime: CodexRuntimeInfo = {};
    try {
      runtime = await this.runner.getRuntimeInfo(workspace, session?.threadId);
    } catch (error) {
      console.warn(`Codex runtime info unavailable: ${error instanceof Error ? error.message : String(error)}`);
    }
    return {
      model: session?.model ?? this.options.config.model ?? runtime.model,
      effort: session?.effort ?? this.options.config.effort ?? runtime.effort,
      provider: runtime.provider
    };
  }

  private async reply(senderId: string, text: string, deliveryId?: string): Promise<"sent" | "queued"> {
    const contextToken = this.options.stateStore.getContextToken(senderId);
    if (!contextToken) {
      this.options.stateStore.enqueueDelivery(senderId, text, deliveryId);
      console.warn(`WeChat context token is unavailable for ${senderId}; reply queued.`);
      return "queued";
    }
    try {
      console.log(`[codex-weixin] sending reply to ${senderId}; text=${text.length} chars`);
      await this.options.weixin.sendText({ toUserId: senderId, text, contextToken });
      console.log(`[codex-weixin] sent reply to ${senderId}`);
      return "sent";
    } catch (error) {
      if (isStaleContextError(error)) {
        this.options.stateStore.enqueueDelivery(senderId, text, deliveryId);
        console.warn(`WeChat context token is stale for ${senderId}; reply queued until the user sends a fresh message.`);
        return "queued";
      }
      throw error;
    }
  }

  private async flushPendingDeliveries(senderId: string): Promise<void> {
    const contextToken = this.options.stateStore.getContextToken(senderId);
    if (!contextToken) return;
    for (const delivery of this.options.stateStore.listPendingDeliveries(senderId)) {
      try {
        await this.options.weixin.sendText({ toUserId: senderId, text: delivery.text, contextToken });
        this.options.stateStore.removePendingDelivery(delivery.id);
      } catch (error) {
        if (isStaleContextError(error)) return;
        throw error;
      }
    }
  }

  private enqueueSender<T>(senderId: string, run: () => Promise<T>): Promise<T> {
    const previous = this.senderQueues.get(senderId) ?? Promise.resolve();
    const task = previous.catch(() => undefined).then(run);
    this.senderQueues.set(senderId, task);
    void task.finally(() => {
      if (this.senderQueues.get(senderId) === task) this.senderQueues.delete(senderId);
    }).catch(() => undefined);
    return task;
  }

  allowSender(senderId: string): void {
    this.access.allow(senderId);
    this.options.stateStore.setPairedSenderIds(this.access.listPairedSenderIds());
  }

  removeSender(senderId: string): void {
    this.access.remove(senderId);
    this.options.stateStore.setPairedSenderIds(this.access.listPairedSenderIds());
  }

  listAllowedSenders(): string[] {
    return this.access.listPairedSenderIds();
  }
}

function helpText(): string {
  return [
    "codex-weixin commands:",
    "/help - show commands",
    "/status - show current binding",
    "/bind <absolute-path> - bind this chat to a workspace",
    "/new - create a new managed Codex session",
    "/resume [R-number] - list or switch historical sessions",
    "/model [number|model-id|default] - view or switch this session's model",
    "/effort [number|level|default] - view or switch reasoning effort",
    "/stream [on|off|default] - view or switch streaming replies",
    "/prompt start - buffer multiple WeChat messages",
    "/prompt done - submit buffered prompt",
    "/approve A1 - approve one pending operation",
    "/approve-session A1 - approve and allow similar operations for this Codex session",
    "/deny A1 - deny one pending operation",
    "/stop - interrupt the current Codex task (or send: 停止)"
  ].join("\n");
}

function browserOptions(config: CodexWeixinConfig) {
  return {
    enabled: config.browserEnabled,
    userDataDir: config.browserProfileDir,
    outputDir: config.browserOutputDir,
    executablePath: config.browserExecutablePath,
    headless: config.browserHeadless,
    allowedDomains: config.browserAllowedDomains,
    allowedWorkspaces: config.allowedWorkspaces
  };
}

function formatPendingApproval(approval: {
  code: string;
  request: { title: string; detail: string; allowForSession?: boolean };
  expiresAt: string;
}): string {
  const expiresAt = new Date(approval.expiresAt);
  const expiry = Number.isNaN(expiresAt.getTime())
    ? "10 分钟内"
    : `${String(expiresAt.getHours()).padStart(2, "0")}:${String(expiresAt.getMinutes()).padStart(2, "0")}`;
  return [
    `【需要确认 ${approval.code}】${approval.request.title}`,
    approval.request.detail,
    "",
    `批准一次：/approve ${approval.code}`,
    ...(approval.request.allowForSession ? [`本会话批准：/approve-session ${approval.code}`] : []),
    `拒绝：/deny ${approval.code}`,
    `有效期至 ${expiry}；编号只能使用一次。`
  ].join("\n");
}

function approvalResolutionMessage(
  rawCode: string,
  decision: "accept" | "acceptForSession" | "decline",
  result: ApprovalResolution
): string {
  const code = rawCode.trim().toUpperCase() || rawCode;
  if (result.status === "not-found") return `没有找到等待确认的操作 ${code}，它可能已过期或已处理。`;
  if (result.status === "wrong-sender") return `操作 ${code} 不属于当前微信联系人，已拒绝处理。`;
  if (result.status === "session-not-allowed") return `操作 ${code} 只允许批准一次。请发送 /approve ${code}，或发送 /deny ${code}。`;
  if (decision === "decline") return `已拒绝 ${result.approval.code}，原任务将继续处理拒绝结果。`;
  if (decision === "acceptForSession") return `已批准 ${result.approval.code}，并允许 Codex 在本会话中沿用该授权（如上游支持）。`;
  return `已批准 ${result.approval.code}，原任务继续执行。`;
}

function formatSessionTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间未知";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const fallbackEfforts = ["minimal", "low", "medium", "high", "xhigh", "max", "ultra"];

function selectModel(models: CodexModelOption[], input: string): CodexModelOption | undefined {
  if (/^\d+$/.test(input)) {
    return models[Number(input) - 1];
  }
  const normalized = input.toLowerCase();
  return models.find((model) => model.model.toLowerCase() === normalized);
}

function isPlausibleModelId(input: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/.test(input);
}

function availableEfforts(model: CodexModelOption | undefined, models: CodexModelOption[]): string[] {
  const advertised = model?.supportedEfforts.length
    ? model.supportedEfforts.map((option) => option.effort)
    : models.flatMap((option) => option.supportedEfforts.map((effort) => effort.effort));
  return advertised.length ? [...new Set(advertised)] : fallbackEfforts;
}

function selectEffort(efforts: string[], input: string): string | undefined {
  if (/^\d+$/.test(input)) {
    return efforts[Number(input) - 1];
  }
  const normalized = input.toLowerCase();
  return efforts.find((effort) => effort.toLowerCase() === normalized);
}

function formatEffort(effort?: string): string {
  if (!effort) return "Codex 默认";
  const labels: Record<string, string> = {
    minimal: "最小",
    low: "低",
    medium: "中",
    high: "高",
    xhigh: "超高",
    max: "最大",
    ultra: "极高"
  };
  return labels[effort] ? `${labels[effort]}（${effort}）` : effort;
}
