#!/usr/bin/env node

import assert from "node:assert/strict";
import { createWriteStream } from "node:fs";
import { appendFile, lstat, mkdir, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { pathToFileURL } from "node:url";
import {
  CYPHERCLAW_REPOSITORY,
  CYPHERCLAW_TARGETS,
  hashFile,
  parseChecksumFile,
  validateCypherClawReleaseManifest,
  verifyAsset,
} from "./lib/cypherclaw-contract.mjs";
import { assertRealOutputRoot } from "./lib/output-root-guard.mjs";

const MANIFEST = "cypherclaw-release.json";
const REQUIRED_CHECKS = [
  "freshInstall",
  "managedGateway",
  "installedUpdater",
  "servingIdentity",
  "configPreserved",
  "authentication",
  "sessionPreserved",
  "databaseIntegrity",
  "controlUi",
  "cleanup",
];

async function regularFile(directory, filename) {
  const file = path.join(directory, filename);
  const stat = await lstat(file);
  assert(stat.isFile() && !stat.isSymbolicLink(), `Release file is not regular: ${filename}`);
  return file;
}

/** The shared release contract owns metadata; this gate checks the complete asset seal. */
export async function verifyReleaseDirectory(directory) {
  const manifestFile = await regularFile(directory, MANIFEST);
  const raw = JSON.parse(await readFile(manifestFile, "utf8"));
  const manifest = validateCypherClawReleaseManifest(raw);
  const manifestHash = await hashFile(manifestFile);
  const checksums = parseChecksumFile(
    await readFile(await regularFile(directory, "SHA256SUMS"), "utf8"),
  );
  assert.equal(checksums.get(MANIFEST), manifestHash.sha256, "Manifest checksum mismatch");
  const assets = [manifest.package, ...manifest.assets];
  assert.equal(checksums.size, assets.length + 1, "Unexpected release checksum inventory");
  for (const asset of assets) {
    assert.equal(checksums.get(asset.file), asset.sha256, `Unsealed asset: ${asset.file}`);
    await verifyAsset(await regularFile(directory, asset.file), asset);
  }
  for (const field of ["reviewedSourceCommit", "nativeSourceCommit", "nativeDistributionCommit"]) {
    if (raw[field] !== undefined) {
      assert.match(raw[field], /^[a-f0-9]{40}$/, `Invalid ${field}`);
      manifest[field] = raw[field];
    }
  }
  return { ...manifest, manifestSha256: manifestHash.sha256 };
}

export function assertExpectedIdentities(candidate, baseline, env = process.env) {
  const bindings = {
    EXPECTED_CANDIDATE_SOURCE_SHA: candidate.sourceCommit,
    EXPECTED_REVIEWED_SOURCE_SHA: candidate.reviewedSourceCommit,
    EXPECTED_NATIVE_SOURCE_SHA: candidate.nativeSourceCommit,
    EXPECTED_NATIVE_DISTRIBUTION_SHA: candidate.nativeDistributionCommit,
    EXPECTED_BASELINE_RELEASE_TAG: baseline.releaseTag,
    EXPECTED_BASELINE_SOURCE_SHA: baseline.sourceCommit,
    EXPECTED_BASELINE_PACKAGE_SHA256: baseline.package.sha256,
    EXPECTED_BASELINE_MANIFEST_SHA256: baseline.manifestSha256,
  };
  for (const [name, actual] of Object.entries(bindings)) {
    assert(env[name], `Missing expected identity: ${name}`);
    assert.equal(actual, env[name], `Release identity changed: ${name}`);
  }
  assert(candidate.publication.ready, "Candidate has publication blockers");
  assert(baseline.publication.ready, "Baseline is not a publishable release");
  assert.notEqual(
    baseline.package.sha256,
    candidate.package.sha256,
    "Upgrade acceptance requires a candidate different from the published baseline",
  );
}

export function assertAcceptance(receipts, candidate, baseline) {
  assert.equal(receipts.length, CYPHERCLAW_TARGETS.length, "Missing OS acceptance receipts");
  const targets = new Set();
  for (const receipt of receipts) {
    assert.equal(receipt.schemaVersion, 1, "Unsupported acceptance receipt");
    assert.equal(receipt.status, "passed", "OS acceptance did not pass");
    assert(CYPHERCLAW_TARGETS.includes(receipt.target), "Unexpected acceptance target");
    assert(!targets.has(receipt.target), "Duplicate acceptance target");
    targets.add(receipt.target);
    for (const [name, manifest] of [
      ["candidate", candidate],
      ["baseline", baseline],
    ]) {
      assert.deepEqual(
        receipt[name],
        {
          releaseTag: manifest.releaseTag,
          sourceCommit: manifest.sourceCommit,
          packageSha256: manifest.package.sha256,
          manifestSha256: manifest.manifestSha256,
        },
        `Receipt ${name} does not identify the tested release`,
      );
    }
    assert.equal(typeof receipt.updateRunId, "string", "Missing completed update run ID");
    assert(receipt.updateRunId.length > 0, "Missing completed update run ID");
    for (const check of REQUIRED_CHECKS) {
      assert.equal(receipt.checks?.[check], true, `Acceptance check did not pass: ${check}`);
    }
  }
}

async function githubJson(endpoint) {
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "CypherClaw-release-validation",
  };
  if (process.env.GH_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GH_TOKEN}`;
  }
  const response = await fetch(
    `https://api.github.com/repos/${CYPHERCLAW_REPOSITORY}/${endpoint}`,
    {
      headers,
      signal: AbortSignal.timeout(60_000),
    },
  );
  assert(response.ok, `GitHub baseline lookup failed (${response.status})`);
  return response.json();
}

async function downloadAsset(tag, name, outputDir) {
  const response = await fetch(
    `https://github.com/${CYPHERCLAW_REPOSITORY}/releases/download/${tag}/${name}`,
    { signal: AbortSignal.timeout(10 * 60_000) },
  );
  assert(
    response.ok && response.body,
    `Baseline asset download failed: ${name} (${response.status})`,
  );
  await pipeline(
    Readable.fromWeb(response.body),
    createWriteStream(path.join(outputDir, name), { flags: "wx" }),
  );
}

async function downloadBaseline(outputDir) {
  assertRealOutputRoot(outputDir);
  await mkdir(outputDir, { recursive: true });
  assert.equal((await readdir(outputDir)).length, 0, "Baseline directory must be empty");
  const release = await githubJson("releases/latest");
  assert.equal(release.draft, false, "Baseline release is a draft");
  assert.equal(release.prerelease, false, "Baseline release is a prerelease");
  assert(release.published_at, "Baseline release is not published");
  assert.match(release.tag_name, /^cypherclaw-v[0-9]+\.[0-9]+\.[0-9]+-[a-f0-9]{12}$/);
  let tagObject = (await githubJson(`git/ref/tags/${release.tag_name}`)).object;
  for (let depth = 0; tagObject.type === "tag" && depth < 5; depth++) {
    assert.match(tagObject.sha, /^[a-f0-9]{40}$/);
    tagObject = (await githubJson(`git/tags/${tagObject.sha}`)).object;
  }
  assert.equal(tagObject.type, "commit", "Baseline tag does not resolve to a commit");
  await downloadAsset(release.tag_name, MANIFEST, outputDir);
  await downloadAsset(release.tag_name, "SHA256SUMS", outputDir);
  const manifest = validateCypherClawReleaseManifest(
    JSON.parse(await readFile(path.join(outputDir, MANIFEST), "utf8")),
  );
  assert.equal(manifest.releaseTag, release.tag_name, "Baseline tag and manifest differ");
  assert.equal(manifest.sourceCommit, tagObject.sha, "Baseline tag and source differ");
  for (const asset of [manifest.package, ...manifest.assets]) {
    await downloadAsset(release.tag_name, asset.file, outputDir);
  }
  const verified = await verifyReleaseDirectory(outputDir);
  assert(verified.publication.ready, "Published baseline records publication blockers");
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(
      process.env.GITHUB_OUTPUT,
      [
        `tag=${verified.releaseTag}`,
        `source_sha=${verified.sourceCommit}`,
        `package_sha256=${verified.package.sha256}`,
        `manifest_sha256=${verified.manifestSha256}`,
        "",
      ].join("\n"),
    );
  }
  console.log(`Captured published baseline ${verified.releaseTag}`);
}

async function readReceipts(directory) {
  const receipts = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    assert(entry.isDirectory() && !entry.isSymbolicLink(), "Unexpected receipt artifact");
    receipts.push(
      JSON.parse(
        await readFile(await regularFile(path.join(directory, entry.name), "receipt.json"), "utf8"),
      ),
    );
  }
  return receipts;
}

async function main(argv) {
  const [action, ...args] = argv;
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    assert(
      ["--output-dir", "--candidate-dir", "--baseline-dir", "--receipts-dir"].includes(args[index]),
      "Unknown validation option",
    );
    assert(args[index + 1] && !args[index + 1].startsWith("--"), "Missing validation option value");
    assert(!options[args[index]], "Duplicate validation option");
    options[args[index]] = path.resolve(args[index + 1]);
  }
  if (action === "baseline") {
    assert(options["--output-dir"], "baseline requires --output-dir");
    await downloadBaseline(options["--output-dir"]);
  } else if (action === "accept") {
    for (const name of ["--candidate-dir", "--baseline-dir", "--receipts-dir"]) {
      assert(options[name], `accept requires ${name}`);
    }
    const candidate = await verifyReleaseDirectory(options["--candidate-dir"]);
    const baseline = await verifyReleaseDirectory(options["--baseline-dir"]);
    assertExpectedIdentities(candidate, baseline);
    assertAcceptance(await readReceipts(options["--receipts-dir"]), candidate, baseline);
    console.log(`All three OS acceptance checks passed for ${candidate.releaseTag}`);
  } else {
    throw new Error("Usage: cypherclaw-release-validation.mjs baseline|accept [directory options]");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((/** @type {unknown} */ error) => {
    console.error(error instanceof Error ? error.message : "Release validation failed");
    process.exitCode = 1;
  });
}
