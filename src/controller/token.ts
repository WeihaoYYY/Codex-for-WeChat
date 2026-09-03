import crypto from "node:crypto";
import fs from "node:fs";

import { ensureDir } from "../state/json-store.js";
import type { StatePaths } from "../state/paths.js";

export function ensureControllerToken(paths: StatePaths): string {
  try {
    const existing = fs.readFileSync(paths.controllerTokenPath, "utf8").trim();
    if (existing) return existing;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  ensureDir(paths.root);
  const token = crypto.randomBytes(32).toString("base64url");
  fs.writeFileSync(paths.controllerTokenPath, `${token}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  try {
    fs.chmodSync(paths.controllerTokenPath, 0o600);
  } catch {
    // Windows ACLs are inherited from the state directory.
  }
  return token;
}

export function controllerTokenMatches(expected: string, provided: string | undefined): boolean {
  if (!provided) return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(provided);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}
