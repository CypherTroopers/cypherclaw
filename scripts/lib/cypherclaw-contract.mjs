import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";

export const CYPHERCLAW_REPOSITORY = "CypherTroopers/cypherclaw";
export const CYPHERCLAW_SOURCE_BRANCH = "cypherclaw-stable";
export const CYPHERCLAW_NODE_VERSION = "24.21.0";
export const CYPHERCLAW_INSTALL_ASSETS = [
  "install.sh",
  "install.ps1",
  "install-node.sh",
  "install-node.ps1",
  "install-runtime.mjs",
  "cypherclaw-contract.mjs",
];
export const CYPHERCLAW_TARGETS = ["linux-x64", "darwin-arm64", "win32-x64"];

function record(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid CypherClaw ${label}.`);
  }
  return value;
}

function string(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Invalid CypherClaw ${label}.`);
  }
  return value;
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`Invalid CypherClaw ${label}.`);
  }
  return value;
}

function sourceIdentity(value) {
  const sourceCommit = string(value.sourceCommit, "source commit");
  const releaseTag = string(value.releaseTag, "release tag");
  if (
    value.repository !== CYPHERCLAW_REPOSITORY ||
    value.channel !== "stable" ||
    value.sourceBranch !== CYPHERCLAW_SOURCE_BRANCH ||
    !/^[a-f0-9]{40}$/.test(sourceCommit) ||
    !/^cypherclaw-v[0-9]+\.[0-9]+\.[0-9]+-[a-f0-9]{12}$/.test(releaseTag) ||
    !releaseTag.endsWith(`-${sourceCommit.slice(0, 12)}`)
  ) {
    throw new Error("CypherClaw distribution does not identify this fork's stable release.");
  }
  return {
    repository: CYPHERCLAW_REPOSITORY,
    channel: "stable",
    sourceBranch: CYPHERCLAW_SOURCE_BRANCH,
    sourceCommit,
    releaseTag,
  };
}

/** Package-local build metadata; absent in an ordinary upstream/source install. */
export function parseCypherClawDistribution(value) {
  if (value == null) {
    return null;
  }
  const distribution = record(value, "distribution metadata");
  if (distribution.id !== "cypherclaw") {
    return null;
  }
  return { id: "cypherclaw", ...sourceIdentity(distribution) };
}

function artifact(value) {
  const item = record(value, "artifact");
  const file = string(item.file, "artifact filename");
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(file)) {
    throw new Error("Invalid CypherClaw artifact filename.");
  }
  if (typeof item.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(item.sha256)) {
    throw new Error("Invalid CypherClaw artifact checksum.");
  }
  return {
    file,
    sha256: item.sha256,
    bytes: positiveInteger(item.bytes, "artifact size"),
  };
}

/** The installer, packer, and updater share one immutable release contract. */
export function validateCypherClawReleaseManifest(value) {
  const manifest = record(value, "release manifest");
  if (manifest.schemaVersion !== 1 || manifest.nodeVersion !== CYPHERCLAW_NODE_VERSION) {
    throw new Error("Unsupported CypherClaw release manifest or Node runtime.");
  }
  const identity = sourceIdentity(manifest);
  const version = string(manifest.version, "version");
  if (identity.releaseTag !== `cypherclaw-v${version}-${identity.sourceCommit.slice(0, 12)}`) {
    throw new Error("CypherClaw release version and source identity do not match.");
  }
  const packageValue = record(manifest.package, "package");
  const packageArtifact = artifact(packageValue);
  if (packageValue.name !== "openclaw" || packageArtifact.file !== "cypherclaw.tgz") {
    throw new Error("CypherClaw release must contain the compatible prebuilt openclaw package.");
  }
  const schema = record(packageValue.schemaVersions, "package schema versions");
  if (!Array.isArray(manifest.assets)) {
    throw new Error("CypherClaw release has no installer assets.");
  }
  const assets = manifest.assets.map(artifact);
  const names = new Set(assets.map((item) => item.file));
  if (
    names.size !== assets.length ||
    CYPHERCLAW_INSTALL_ASSETS.some((name) => !names.has(name)) ||
    names.has(packageArtifact.file) ||
    names.has("cypherclaw-release.json") ||
    names.has("SHA256SUMS")
  ) {
    throw new Error("CypherClaw release installer inventory is incomplete or ambiguous.");
  }
  if (
    !Array.isArray(manifest.supportedTargets) ||
    manifest.supportedTargets.length !== CYPHERCLAW_TARGETS.length ||
    CYPHERCLAW_TARGETS.some((target) => !manifest.supportedTargets.includes(target))
  ) {
    throw new Error("Unsupported CypherClaw native target inventory.");
  }
  const publication = record(manifest.publication, "publication status");
  if (
    typeof publication.ready !== "boolean" ||
    !Array.isArray(publication.limitations) ||
    publication.limitations.some((item) => typeof item !== "string" || !item.trim()) ||
    (publication.ready && publication.limitations.length !== 0)
  ) {
    throw new Error("Invalid CypherClaw publication status.");
  }
  return {
    schemaVersion: 1,
    ...identity,
    version,
    nodeVersion: CYPHERCLAW_NODE_VERSION,
    package: {
      ...packageArtifact,
      name: "openclaw",
      nodeEngine: string(packageValue.nodeEngine, "package Node engine"),
      schemaVersions: {
        state: positiveInteger(schema.state, "state schema"),
        agent: positiveInteger(schema.agent, "agent schema"),
      },
    },
    assets,
    supportedTargets: [...CYPHERCLAW_TARGETS],
    publication: { ready: publication.ready, limitations: [...publication.limitations] },
  };
}

export function parseChecksumFile(content) {
  const entries = new Map();
  for (const line of content.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }
    const match = /^([a-f0-9]{64}) [ *]([a-zA-Z0-9][a-zA-Z0-9._-]*)$/.exec(line);
    if (!match || entries.has(match[2])) {
      throw new Error("Invalid or duplicate CypherClaw SHA256SUMS entry.");
    }
    entries.set(match[2], match[1]);
  }
  if (entries.size === 0) {
    throw new Error("CypherClaw SHA256SUMS is empty.");
  }
  return entries;
}

export async function hashFile(file) {
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of createReadStream(file)) {
    bytes += chunk.length;
    hash.update(chunk);
  }
  return { sha256: hash.digest("hex"), bytes };
}

export async function verifyAsset(file, expected) {
  const actual = await hashFile(file);
  if (actual.sha256 !== expected.sha256 || actual.bytes !== expected.bytes) {
    throw new Error(`CypherClaw checksum or size mismatch for ${expected.file}.`);
  }
}
