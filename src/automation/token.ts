import crypto from "node:crypto";
import fs from "node:fs";

import { ensureDir } from "../state/json-store.js";
import type { StatePaths } from "../state/paths.js";

export function ensureAutomationToken(paths: StatePaths): string {
  try {
    const existing = fs.readFileSync(paths.automationTokenPath, "utf8").trim();
    if (existing) return existing;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  ensureDir(paths.root);
  const token = crypto.randomBytes(32).toString("base64url");
  fs.writeFileSync(paths.automationTokenPath, `${token}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  try {
    fs.chmodSync(paths.automationTokenPath, 0o600);
  } catch {
    // Windows ACLs are inherited from the state directory; chmod may be unavailable.
  }
  return token;
}

export function readAutomationToken(paths: StatePaths): string {
  const token = fs.readFileSync(paths.automationTokenPath, "utf8").trim();
  if (!token) throw new Error("Automation token is empty. Start Codex for WeChat once to regenerate it.");
  return token;
}

export function automationTokenMatches(expected: string, provided: string | undefined): boolean {
  if (!provided) return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(provided);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}
