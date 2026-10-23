import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { pathExists } from "@openclaw/fs-safe/advanced";
import { stableHomebrewNodePathCandidates } from "@openclaw/normalization-core/stable-node-path";

const PRIVATE_NODE_VERSION_DIR = String.raw`node-v\d+\.\d+\.\d+`;

/**
 * Rootless installers publish `tools/node-vX.Y.Z` and a `tools/node` alias.
 * Service definitions that store the versioned realpath break on the next
 * runtime upgrade. Windows CypherClaw already publishes `tools/node/node.exe`
 * directly; the `node.exe` candidate covers a versioned directory of that shape.
 */
function stablePrivateNodePathCandidates(nodePath: string): string[] {
  const normalized = nodePath.replaceAll("\\", "/");
  const pathModule = nodePath.includes("\\") ? path.win32 : path.posix;
  const unix = normalized.match(new RegExp(`^(.*)/tools/${PRIVATE_NODE_VERSION_DIR}/bin/node$`));
  if (unix?.[1] !== undefined) {
    return [pathModule.join(nodePath.slice(0, unix[1].length), "tools", "node", "bin", "node")];
  }
  const windows = normalized.match(
    new RegExp(`^(.*)/tools/${PRIVATE_NODE_VERSION_DIR}/node\\.exe$`, "i"),
  );
  if (windows?.[1] !== undefined) {
    return [path.win32.join(nodePath.slice(0, windows[1].length), "tools", "node", "node.exe")];
  }
  return [];
}

async function sameExecutable(left: string, right: string): Promise<boolean> {
  try {
    const [leftReal, rightReal] = await Promise.all([fs.realpath(left), fs.realpath(right)]);
    return typeof leftReal === "string" && leftReal.length > 0 && leftReal === rightReal;
  } catch {
    return false;
  }
}

/**
 * Homebrew Cellar paths (e.g. /opt/homebrew/Cellar/node/25.7.0/bin/node)
 * break when Homebrew upgrades Node and removes the old version directory.
 * Resolve these to a stable Homebrew-managed path that survives upgrades:
 *   - Default formula "node":  <prefix>/opt/node/bin/node  or  <prefix>/bin/node
 *   - Versioned formula "node@22":  <prefix>/opt/node@22/bin/node  (keg-only)
 * Private Node installs likewise prefer `tools/node` when that alias is the
 * same executable as the versioned directory.
 */
export async function resolveStableNodePath(nodePath: string): Promise<string> {
  for (const candidate of stableHomebrewNodePathCandidates(nodePath)) {
    if (await pathExists(candidate)) {
      return candidate;
    }
  }
  for (const candidate of stablePrivateNodePathCandidates(nodePath)) {
    if ((await pathExists(candidate)) && (await sameExecutable(candidate, nodePath))) {
      return candidate;
    }
  }
  return nodePath;
}

// Keep the running Node version until its versioned directory is removed.
export function resolveLaunchableNodePath(nodePath = process.execPath): string {
  if (existsSync(nodePath)) {
    return nodePath;
  }
  return (
    [
      ...stableHomebrewNodePathCandidates(nodePath),
      ...stablePrivateNodePathCandidates(nodePath),
    ].find((candidate) => existsSync(candidate)) ?? nodePath
  );
}
