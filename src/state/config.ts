import os from "node:os";
import path from "node:path";

import { parseCodexExecSandbox, type CodexExecSandbox } from "../codex/sandbox.js";
import { readJsonFile, writeJsonFile } from "./json-store.js";
import type { StatePaths } from "./paths.js";
import { defaultBrowserProfileDir } from "../browser/controller.js";

export const MAX_INBOUND_BYTES = 100 * 1024 * 1024;
const LEGACY_DEFAULT_INBOUND_BYTES = 50 * 1024 * 1024;

export type CodexWeixinConfig = {
  defaultCwd: string;
  allowedSenderIds: string[];
  allowedWorkspaces: string[];
  codexBin: string;
  codexBackend: "auto" | "app-server" | "exec";
  codexExecSandbox?: CodexExecSandbox;
  model?: string;
  effort?: string;
  streamReplies: boolean;
  maxBufferItems: number;
  promptBufferTtlMs: number;
  maxInboundBytes: number;
  browserEnabled: boolean;
  browserProfileDir: string;
  browserOutputDir: string;
  browserExecutablePath?: string;
  browserHeadless: boolean;
  browserAllowedDomains: string[];
  automationEnabled: boolean;
  automationAccountId?: string;
  automationSenderId?: string;
};

export function defaultConfig(cwd = path.join(os.homedir(), ".codex-weixin")): CodexWeixinConfig {
  return {
    defaultCwd: path.resolve(cwd),
    allowedSenderIds: [],
    allowedWorkspaces: [path.resolve(cwd)],
    codexBin: "codex",
    codexBackend: "auto",
    streamReplies: true,
    maxBufferItems: 50,
    promptBufferTtlMs: 10 * 60_000,
    maxInboundBytes: MAX_INBOUND_BYTES,
    browserEnabled: false,
    browserProfileDir: defaultBrowserProfileDir(),
    browserOutputDir: path.join(os.homedir(), ".codex-weixin", "browser-output"),
    browserHeadless: false,
    browserAllowedDomains: [],
    automationEnabled: false
  };
}

export function loadConfig(paths: StatePaths, cwd?: string): CodexWeixinConfig {
  const base = cwd ? defaultConfig(cwd) : defaultConfig();
  const loaded = readJsonFile<Partial<CodexWeixinConfig>>(paths.configPath, {});
  const codexExecSandbox = parseCodexExecSandbox(loaded.codexExecSandbox);
  return {
    ...base,
    ...loaded,
    codexExecSandbox,
    streamReplies: typeof loaded.streamReplies === "boolean" ? loaded.streamReplies : base.streamReplies,
    maxInboundBytes: normalizeInboundBytes(loaded.maxInboundBytes, base.maxInboundBytes),
    browserEnabled: loaded.browserEnabled === true,
    browserProfileDir: path.resolve(loaded.browserProfileDir ?? base.browserProfileDir),
    browserOutputDir: path.resolve(loaded.browserOutputDir ?? base.browserOutputDir),
    browserExecutablePath: loaded.browserExecutablePath?.trim() ? path.resolve(loaded.browserExecutablePath) : undefined,
    browserHeadless: loaded.browserHeadless === true,
    browserAllowedDomains: normalizeDomains(loaded.browserAllowedDomains),
    automationEnabled: loaded.automationEnabled === true,
    automationAccountId: cleanOptional(loaded.automationAccountId),
    automationSenderId: cleanOptional(loaded.automationSenderId),
    allowedSenderIds: loaded.allowedSenderIds ?? base.allowedSenderIds,
    allowedWorkspaces: (loaded.allowedWorkspaces?.length ? loaded.allowedWorkspaces : base.allowedWorkspaces)
      .map((workspace) => path.resolve(workspace))
  };
}

function cleanOptional(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeDomains(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.flatMap((item) => typeof item === "string" && item.trim()
    ? [item.trim().toLowerCase().replace(/^\.+|\.+$/g, "")]
    : []))].sort();
}

export function saveConfig(paths: StatePaths, config: CodexWeixinConfig): void {
  writeJsonFile(paths.configPath, {
    ...config,
    maxInboundBytes: normalizeInboundBytes(config.maxInboundBytes, MAX_INBOUND_BYTES)
  });
}

function normalizeInboundBytes(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return fallback;
  const bytes = Math.floor(value);
  if (bytes === LEGACY_DEFAULT_INBOUND_BYTES) return MAX_INBOUND_BYTES;
  return Math.min(bytes, MAX_INBOUND_BYTES);
}

export function isWorkspaceAllowed(workspace: string, allowedWorkspaces: string[]): boolean {
  const resolved = path.resolve(workspace);
  return allowedWorkspaces.some((allowed) => {
    const root = path.resolve(allowed);
    const relative = path.relative(root, resolved);
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  });
}
