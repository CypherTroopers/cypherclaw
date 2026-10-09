import { constants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { asNullableRecord } from "@openclaw/normalization-core/record-coerce";
import {
  CYPHERCLAW_REPOSITORY,
  parseCypherClawDistribution,
  validateCypherClawReleaseManifest,
  type CypherClawDistribution,
  type CypherClawReleaseManifest,
} from "../../scripts/lib/cypherclaw-contract.mjs";
import { applyCliProfileEnv } from "../cli/profile.js";
import { resolveStateDir } from "../config/paths.js";
import { parsePackageOpenClawSchemaVersions } from "../state/openclaw-schema-versions.js";
import { buildTimeoutAbortSignal } from "../utils/fetch-timeout.js";
import { hasErrnoCode } from "./errno.js";
import { cancelUnreadResponseBody } from "./http-body.js";
import { tryReadJson } from "./json-files.js";
import { UPDATE_NETWORK_TIMEOUT_MS } from "./update-network-budget.js";
import type { PackageUpdateArtifact } from "./update-package-artifact.js";

const distributionReads = new Map<string, Promise<CypherClawDistribution | null>>();

/** The running package's identity stays fixed through its update and recovery lifecycle. */
export function readCypherClawDistribution(root: string): Promise<CypherClawDistribution | null> {
  const packageRoot = path.resolve(root);
  let read = distributionReads.get(packageRoot);
  if (!read) {
    read = (async () => {
      const manifest = asNullableRecord(
        await tryReadJson<unknown>(path.join(packageRoot, "package.json")),
      );
      return parseCypherClawDistribution(asNullableRecord(manifest?.openclaw)?.distribution);
    })();
    distributionReads.set(packageRoot, read);
  }
  return read;
}

export async function applyCypherClawDistributionEnvironment(
  root: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  if (!(await readCypherClawDistribution(root))) {
    return;
  }
  applyCliProfileEnv({ profile: env.OPENCLAW_PROFILE?.trim() || "cypherclaw", env });
  // Official npm notifications cannot identify a fork release. Explicit updates
  // use the package updater with the fork manifest and its verified artifact.
  env.OPENCLAW_NO_AUTO_UPDATE = "1";
  if (env.CYPHER_ROOT?.trim()) {
    return;
  }
  const stateDir = resolveStateDir(env);
  env.CYPHER_DATADIR ||= path.join(stateDir, "cypher", "chaindbname");
  if (env.CYPHER_BROWSER_RELAY_CONFIG?.trim()) {
    return;
  }
  const relayConfig = path.join(stateDir, "cypher", "browser-relay", "common-mine.json");
  env.CYPHER_BROWSER_RELAY_CONFIG = relayConfig;
}

/** Starting the node owns its relay artifact; CLI diagnostics only project defaults. */
export async function provisionCypherClawRelayConfiguration(
  root: string,
  env: NodeJS.ProcessEnv,
  assertCurrent: () => void,
): Promise<void> {
  const relayConfig = path.join(
    resolveStateDir(env),
    "cypher",
    "browser-relay",
    "common-mine.json",
  );
  if (
    env.CYPHER_BROWSER_RELAY_CONFIG !== relayConfig ||
    !(await readCypherClawDistribution(root))
  ) {
    return;
  }
  assertCurrent();
  await fs.mkdir(path.dirname(relayConfig), { recursive: true, mode: 0o700 });
  assertCurrent();
  try {
    await fs.copyFile(
      path.join(root, "cypher", "config", "browser-relay", "common-mine.json"),
      relayConfig,
      constants.COPYFILE_EXCL,
    );
  } catch (error) {
    if (!hasErrnoCode(error, "EEXIST")) {
      throw error;
    }
  }
}

async function readReleaseJson(url: string, timeoutMs: number): Promise<unknown> {
  const { signal, cleanup } = buildTimeoutAbortSignal({
    timeoutMs,
    operation: "cypherclaw-release-resolution",
    url,
  });
  let response: Response | undefined;
  try {
    response = await fetch(url, {
      signal,
      headers: { "User-Agent": "CypherClaw updater", Accept: "application/json" },
    });
    if (!response.ok || !response.body) {
      throw new Error(`CypherClaw release lookup failed: HTTP ${response.status}.`);
    }
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    const reader = response.body.getReader();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) {
          break;
        }
        bytes += value.byteLength;
        if (bytes > 1024 * 1024) {
          throw new Error("CypherClaw release metadata exceeds its size limit.");
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } finally {
    await cancelUnreadResponseBody(response);
    cleanup();
  }
}

async function resolveReleaseTag(selector: string, timeoutMs: number): Promise<string> {
  const api = `https://api.github.com/repos/${CYPHERCLAW_REPOSITORY}/releases`;
  if (/^cypherclaw-v\d+\.\d+\.\d+-[a-f0-9]{12}$/.test(selector)) {
    return selector;
  }
  if (selector === "latest") {
    const release = asNullableRecord(await readReleaseJson(`${api}/latest`, timeoutMs));
    if (typeof release?.tag_name === "string") {
      return release.tag_name;
    }
  } else if (/^v?\d+\.\d+\.\d+$/.test(selector)) {
    const version = selector.replace(/^v/, "");
    const releases = await readReleaseJson(`${api}?per_page=100`, timeoutMs);
    if (Array.isArray(releases)) {
      for (const entry of releases) {
        const release = asNullableRecord(entry);
        if (
          release?.draft !== true &&
          release?.prerelease !== true &&
          typeof release?.tag_name === "string" &&
          release.tag_name.startsWith(`cypherclaw-v${version}-`)
        ) {
          return release.tag_name;
        }
      }
    }
  }
  throw new Error(
    "No matching CypherClaw stable release. Use latest or an exact cypherclaw-v<version>-<commit> release tag.",
  );
}

export async function resolveCypherClawRelease(
  selector = "latest",
  timeoutMs = UPDATE_NETWORK_TIMEOUT_MS,
): Promise<{
  manifest: CypherClawReleaseManifest;
  artifact: PackageUpdateArtifact;
  schemaVersions: NonNullable<ReturnType<typeof parsePackageOpenClawSchemaVersions>>;
}> {
  const releaseTag = await resolveReleaseTag(selector, timeoutMs);
  if (!/^cypherclaw-v\d+\.\d+\.\d+-[a-f0-9]{12}$/.test(releaseTag)) {
    throw new Error("The latest GitHub release is not a CypherClaw stable distribution.");
  }
  const base = `https://github.com/${CYPHERCLAW_REPOSITORY}/releases/download/${releaseTag}`;
  const manifest = validateCypherClawReleaseManifest(
    await readReleaseJson(`${base}/cypherclaw-release.json`, timeoutMs),
  );
  if (manifest.releaseTag !== releaseTag || !manifest.publication.ready) {
    throw new Error("The selected CypherClaw release is not admitted for public distribution.");
  }
  const schemaVersions = parsePackageOpenClawSchemaVersions({
    name: manifest.package.name,
    version: manifest.version,
    openclaw: { schemaVersions: manifest.package.schemaVersions },
  });
  if (!schemaVersions) {
    throw new Error("The CypherClaw release does not declare supported database schemas.");
  }
  return {
    manifest,
    schemaVersions,
    artifact: {
      url: `${base}/${manifest.package.file}`,
      sha256: manifest.package.sha256,
      bytes: manifest.package.bytes,
    },
  };
}
