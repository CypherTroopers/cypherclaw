#!/usr/bin/env node

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { create as createTar, extract as extractTar } from "tar";
import { booleanFlag, parseFlagArgs, stringFlag } from "./lib/arg-utils.runtime.mjs";
import {
  CYPHERCLAW_NODE_VERSION as NODE_VERSION,
  CYPHERCLAW_REPOSITORY as REPOSITORY,
  CYPHERCLAW_SOURCE_BRANCH as SOURCE_BRANCH,
  CYPHERCLAW_TARGETS,
  hashFile,
  validateCypherClawReleaseManifest,
  verifyAsset,
} from "./lib/cypherclaw-contract.mjs";
import { applyCypherClawNativeArtifacts } from "./lib/cypherclaw-native-overlay.mjs";
import { verifyCypherClawReleaseSource } from "./lib/cypherclaw-release-source.mjs";
import { assertRealOutputRoot } from "./lib/output-root-guard.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST = "cypherclaw-release.json";
const PACKAGE = "cypherclaw.tgz";
const ASSETS = [
  ["install.sh", "scripts/install-cypherclaw.sh"],
  ["install.ps1", "scripts/install-cypherclaw.ps1"],
  ["install-node.sh", "scripts/install-cli.sh"],
  ["install-node.ps1", "scripts/install.ps1"],
  ["install-runtime.mjs", "scripts/install-cypherclaw.mjs"],
  ["cypherclaw-contract.mjs", "scripts/lib/cypherclaw-contract.mjs"],
];
const NATIVE_BINARIES = [
  "cypher-linux-amd64",
  "cypher-darwin-arm64",
  "cypher.exe",
  "libcrypto-3-x64.dll",
  "libgcc_s_seh-1.dll",
  "libgmp-10.dll",
  "libstdc++-6.dll",
  "libwinpthread-1.dll",
];
const NATIVE_MATERIALS = [
  "BUILDINFO.txt",
  "cypher-source-60b8164-with-go-dependencies.tar.gz",
  "licenses/GPL-3.0.txt",
  "licenses/LGPL-3.0.txt",
  "provenance/linux-amd64/manifest.txt",
  "provenance/darwin-arm64/manifest.txt",
  "provenance/windows-amd64/manifest.txt",
  "patches/README.md",
  "patches/build-finality-node.sh",
  "patches/transaction-finality-ipc.patch",
  "patches/transaction-finality-source.json",
];
const NATIVE_TARGETS = ["linux-amd64", "darwin-arm64", "windows-amd64"];

function usage() {
  return [
    "Usage: node scripts/build-cypherclaw-release.mjs --source-sha <40-character SHA> --output-dir <directory> [--native-artifacts-dir <directory>] [--candidate] [--skip-build]",
    "       node scripts/build-cypherclaw-release.mjs --check --output-dir <directory>",
    "",
    "The default build requires a clean checkout and a commit on cypherclaw-stable.",
    "--candidate prepares local worktree proof and records it as unpublishable.",
    "--skip-build is candidate-only and requires existing dist/build-info.json bound to the selected SHA.",
    "--native-artifacts-dir replaces native assets only inside package staging after all three targets are verified.",
    "--native-source-sha, --native-distribution-sha, and --native-source-bundle-dir bind official FHS-D outputs and their source.",
    "--check verifies the sealed assets and package source identity without rebuilding.",
  ].join("\n");
}

async function run(command, args, { capture = false, env = process.env } = {}) {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: ROOT,
      env,
      stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit",
    });
    let output = "";
    child.stdout?.on("data", (chunk) => {
      output += chunk;
    });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (code === 0) {
        resolve(output.trim());
      } else {
        reject(new Error(`${command} ${args.join(" ")} failed (${code ?? signal})`));
      }
    });
  });
}

async function describeFile(directory, file) {
  const filename = path.join(directory, file);
  const stat = await fs.lstat(filename);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`Release asset must be a regular file: ${filename}`);
  }
  return { file, ...(await hashFile(filename)) };
}

async function verifyNativeProvenance(root = ROOT, { requireFinality = false } = {}) {
  const source = path.join(root, "cypher");
  const ledger = new Map();
  for (const line of (await fs.readFile(path.join(source, "SHA256SUMS"), "utf8"))
    .trim()
    .split(/\r?\n/u)) {
    const match = /^([a-f0-9]{64}) {2}(.+)$/u.exec(line);
    if (!match) {
      throw new Error("Cypher provenance SHA256SUMS is malformed");
    }
    const relative = match[2];
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._+-]*(?:\/[a-zA-Z0-9][a-zA-Z0-9._+-]*)*$/u.test(relative)) {
      throw new Error(`Unsafe Cypher provenance path: ${relative}`);
    }
    if (ledger.has(relative)) {
      throw new Error(`Duplicate Cypher provenance path: cypher/${relative}`);
    }
    ledger.set(relative, match[1]);
  }
  for (const relative of [
    ...NATIVE_BINARIES.map((filename) => `build/bin/${filename}`),
    ...NATIVE_MATERIALS,
  ]) {
    if (!ledger.has(relative)) {
      throw new Error(`Cypher provenance SHA256SUMS is missing cypher/${relative}`);
    }
  }
  for (const [relative, expected] of ledger) {
    if ((await hashFile(path.join(source, relative))).sha256 !== expected) {
      throw new Error(`Cypher file differs from its retained provenance: cypher/${relative}`);
    }
  }
  const finality = JSON.parse(
    await fs.readFile(path.join(source, "patches/transaction-finality-source.json"), "utf8"),
  );
  if (
    !/^[a-f0-9]{40}$/u.test(finality.baseCommit) ||
    finality.patch !== "transaction-finality-ipc.patch" ||
    finality.patchSha256 !== ledger.get(`patches/${finality.patch}`) ||
    finality.method !== "eth_getTransactionFinality" ||
    finality.transport !== "ipc" ||
    finality.result !== "boolean" ||
    !(
      finality.baseSourceArchive?.file === "cypher-source-60b8164-with-go-dependencies.tar.gz" ||
      (finality.baseSourceArchive?.file === `cypher-source-${finality.baseCommit}.tar.gz` &&
        finality.baseSourceArchive.commit === finality.baseCommit)
    ) ||
    finality.baseSourceArchive.sha256 !== ledger.get(finality.baseSourceArchive.file) ||
    !Array.isArray(finality.targets) ||
    finality.targets.length !== NATIVE_TARGETS.length ||
    !NATIVE_TARGETS.every((target) => finality.targets.includes(target))
  ) {
    throw new Error(
      "Cypher transaction finality metadata does not bind the retained source and patch",
    );
  }
  const limitations = [];
  const officialSource = finality.sourceIntegration === "FHS-D";
  if (officialSource && !/^[a-f0-9]{40}$/u.test(finality.distributionCommit)) {
    throw new Error("Official FHS-D provenance is missing its distribution commit");
  }
  for (const target of NATIVE_TARGETS) {
    const entries = (
      await fs.readFile(path.join(source, "provenance", target, "manifest.txt"), "utf8")
    )
      .trim()
      .split(/\r?\n/u)
      .map((line) => {
        const separator = line.indexOf("=");
        return [line.slice(0, separator), line.slice(separator + 1)];
      });
    const manifest = new Map(entries);
    const binary = target === "windows-amd64" ? "cypher.exe" : `cypher-${target}`;
    if (
      manifest.size !== entries.length ||
      manifest.get("source_sha") !== finality.baseCommit ||
      (!officialSource && manifest.get("source_patch_sha256") !== finality.patchSha256) ||
      (officialSource && manifest.get("ipc_transaction_finality_transport") !== "ipc") ||
      manifest.get("ipc_transaction_finality_method") !== finality.method ||
      manifest.get("binary") !== binary ||
      manifest.get("binary_sha256") !== ledger.get(`build/bin/${binary}`)
    ) {
      limitations.push(
        `Bundled ${target} node provenance does not bind the transaction finality API.`,
      );
    }
  }
  if (requireFinality && limitations.length) {
    throw new Error(
      `Cypher publication requires transaction finality support on all native targets: ${limitations.join(" ")}`,
    );
  }
  return limitations;
}

async function readStagedPackage(directory, tarball, options) {
  extractTar({ file: tarball, cwd: directory, strict: true, sync: true });
  const packageRoot = path.join(directory, "package");
  const packageJson = JSON.parse(await fs.readFile(path.join(packageRoot, "package.json"), "utf8"));
  const buildInfo = JSON.parse(
    await fs.readFile(path.join(packageRoot, "dist/build-info.json"), "utf8"),
  );
  await fs.access(path.join(packageRoot, "dist/control-ui/index.html"));
  await fs.access(path.join(packageRoot, "cypher/config/browser-relay/common-mine.json"));
  await verifyNativeProvenance(packageRoot, options);
  return { packageRoot, packageJson, buildInfo };
}

async function checkRelease(outputDir) {
  const recordedManifest = JSON.parse(await fs.readFile(path.join(outputDir, MANIFEST), "utf8"));
  const manifest = validateCypherClawReleaseManifest(recordedManifest);
  const entries = [manifest.package, ...manifest.assets];
  for (const entry of entries) {
    await verifyAsset(path.join(outputDir, entry.file), entry);
  }
  const expectedChecksums = [...entries, await describeFile(outputDir, MANIFEST)]
    .toSorted((a, b) => a.file.localeCompare(b.file))
    .map(({ file, sha256 }) => `${sha256}  ${file}\n`)
    .join("");
  if ((await fs.readFile(path.join(outputDir, "SHA256SUMS"), "utf8")) !== expectedChecksums) {
    throw new Error("SHA256SUMS does not bind exactly the manifest and all release assets");
  }
  const stage = await fs.mkdtemp(path.join(outputDir, ".check-package-"));
  try {
    const { packageJson, buildInfo } = await readStagedPackage(
      stage,
      path.join(outputDir, PACKAGE),
      { requireFinality: manifest.publication.ready },
    );
    const distribution = packageJson.openclaw?.distribution;
    const finality = JSON.parse(
      await fs.readFile(
        path.join(stage, "package/cypher/patches/transaction-finality-source.json"),
        "utf8",
      ),
    );
    if (
      recordedManifest.reviewedSourceCommit ||
      recordedManifest.nativeSourceCommit ||
      recordedManifest.nativeDistributionCommit ||
      finality.releaseInputs
    ) {
      if (
        !/^[a-f0-9]{40}$/u.test(recordedManifest.reviewedSourceCommit) ||
        !/^[a-f0-9]{40}$/u.test(recordedManifest.nativeSourceCommit) ||
        !/^[a-f0-9]{40}$/u.test(recordedManifest.nativeDistributionCommit) ||
        distribution?.reviewedSourceCommit !== recordedManifest.reviewedSourceCommit ||
        distribution?.nativeSourceCommit !== recordedManifest.nativeSourceCommit ||
        distribution?.nativeDistributionCommit !== recordedManifest.nativeDistributionCommit ||
        finality.releaseInputs?.reviewedSourceCommit !== recordedManifest.reviewedSourceCommit ||
        finality.releaseInputs?.nativeSourceCommit !== recordedManifest.nativeSourceCommit ||
        finality.releaseInputs?.nativeDistributionCommit !==
          recordedManifest.nativeDistributionCommit ||
        finality.baseCommit !== recordedManifest.nativeSourceCommit ||
        finality.distributionCommit !== recordedManifest.nativeDistributionCommit ||
        finality.baseSourceArchive?.commit !== recordedManifest.nativeSourceCommit
      ) {
        throw new Error(
          "Release source selection, packaged native source, and distribution provenance disagree",
        );
      }
    }
    if (
      packageJson.name !== manifest.package.name ||
      packageJson.version !== manifest.version ||
      packageJson.engines?.node !== manifest.package.nodeEngine ||
      packageJson.openclaw?.schemaVersions?.state !== manifest.package.schemaVersions.state ||
      packageJson.openclaw?.schemaVersions?.agent !== manifest.package.schemaVersions.agent ||
      buildInfo.commit !== manifest.sourceCommit ||
      buildInfo.version !== manifest.version ||
      distribution?.id !== "cypherclaw" ||
      distribution.repository !== manifest.repository ||
      distribution.channel !== manifest.channel ||
      distribution.sourceBranch !== manifest.sourceBranch ||
      distribution.sourceCommit !== manifest.sourceCommit ||
      distribution.releaseTag !== manifest.releaseTag
    ) {
      throw new Error("Packed package, build identity, and release manifest disagree");
    }
  } finally {
    await fs.rm(stage, { recursive: true, force: true });
  }
  console.log(`Verified ${manifest.releaseTag}: ${manifest.sourceCommit}`);
  return manifest;
}

async function main() {
  const options = parseFlagArgs(
    process.argv.slice(2),
    {
      candidate: false,
      check: false,
      help: false,
      nativeArtifactsDir: "",
      nativeSourceSha: "",
      nativeDistributionSha: "",
      nativeSourceBundleDir: "",
      outputDir: "",
      skipBuild: false,
      sourceSha: "",
    },
    [
      booleanFlag("--candidate", "candidate"),
      booleanFlag("--check", "check"),
      booleanFlag("--help", "help"),
      booleanFlag("--skip-build", "skipBuild"),
      stringFlag("--output-dir", "outputDir"),
      stringFlag("--source-sha", "sourceSha"),
      stringFlag("--native-artifacts-dir", "nativeArtifactsDir"),
      stringFlag("--native-source-sha", "nativeSourceSha"),
      stringFlag("--native-distribution-sha", "nativeDistributionSha"),
      stringFlag("--native-source-bundle-dir", "nativeSourceBundleDir"),
    ],
  );
  if (options.help) {
    console.log(usage());
    return;
  }
  if (!options.outputDir) {
    throw new Error(usage());
  }
  const outputDir = path.resolve(options.outputDir);
  assertRealOutputRoot(outputDir);
  if (options.check) {
    if (
      options.candidate ||
      options.skipBuild ||
      options.sourceSha ||
      options.nativeArtifactsDir ||
      options.nativeSourceSha ||
      options.nativeDistributionSha ||
      options.nativeSourceBundleDir
    ) {
      throw new Error("--check accepts only --output-dir");
    }
    await checkRelease(outputDir);
    return;
  }
  if (options.skipBuild && !options.candidate) {
    throw new Error(
      "--skip-build requires --candidate; production release bytes must be rebuilt from the clean selected SHA",
    );
  }
  if (!/^[a-f0-9]{40}$/u.test(options.sourceSha)) {
    throw new Error("--source-sha must be a full lowercase 40-character Git commit SHA");
  }
  if (
    Boolean(options.nativeSourceSha) !== Boolean(options.nativeSourceBundleDir) ||
    Boolean(options.nativeSourceSha) !== Boolean(options.nativeDistributionSha) ||
    (options.nativeSourceSha &&
      (!/^[a-f0-9]{40}$/u.test(options.nativeSourceSha) ||
        !/^[a-f0-9]{40}$/u.test(options.nativeDistributionSha) ||
        !options.nativeArtifactsDir))
  ) {
    throw new Error(
      "Official native source requires --native-source-sha, --native-distribution-sha, --native-source-bundle-dir, and --native-artifacts-dir together",
    );
  }
  const sourceCommit = await run("git", ["rev-parse", "HEAD"], { capture: true });
  if (sourceCommit !== options.sourceSha) {
    throw new Error("The selected source SHA is not the current checkout HEAD");
  }
  const sourceDirty = Boolean(
    await run("git", ["status", "--porcelain", "--untracked-files=normal"], { capture: true }),
  );
  let releaseSource = null;
  if (!options.candidate) {
    if (sourceDirty) {
      throw new Error(
        "Release preparation requires a clean checkout; use --candidate for local proof",
      );
    }
    releaseSource = await verifyCypherClawReleaseSource({ root: ROOT, sourceCommit });
    if (
      releaseSource &&
      (releaseSource.nativeSourceCommit !== options.nativeSourceSha ||
        releaseSource.nativeDistributionCommit !== options.nativeDistributionSha)
    ) {
      throw new Error("Native source selection must match the verified release snapshot");
    }
    if (options.nativeSourceSha && !releaseSource) {
      throw new Error("Current native source requires a verified release snapshot");
    }
  }
  let nativeLimitations = await verifyNativeProvenance(ROOT, {
    requireFinality: !options.candidate && !options.nativeArtifactsDir,
  });
  await fs.mkdir(outputDir, { recursive: true });
  if ((await fs.readdir(outputDir)).length) {
    throw new Error("Use an empty output directory; existing release artifacts are preserved");
  }
  const sourcePackage = JSON.parse(await fs.readFile(path.join(ROOT, "package.json"), "utf8"));
  const version = sourcePackage.version;
  const releaseTag = `cypherclaw-v${version}-${sourceCommit.slice(0, 12)}`;
  const commitTimestamp = await run("git", ["show", "-s", "--format=%cI", sourceCommit], {
    capture: true,
  });
  const env = {
    ...process.env,
    GIT_COMMIT: sourceCommit,
    OPENCLAW_BUILD_TIMESTAMP: new Date(commitTimestamp).toISOString(),
    OPENCLAW_CONTROL_UI_RELEASE_BUILD: "1",
    // Packing this native-asset bundle exceeded the upstream five-minute budget
    // while npm was still computing. Keep the canonical packer's override.
    OPENCLAW_DOCKER_PACKAGE_PACK_TIMEOUT_MS:
      process.env.OPENCLAW_DOCKER_PACKAGE_PACK_TIMEOUT_MS ?? String(30 * 60 * 1000),
  };
  if (options.skipBuild) {
    const previousBuild = JSON.parse(
      await fs.readFile(path.join(ROOT, "dist/build-info.json"), "utf8"),
    );
    if (previousBuild.commit !== sourceCommit || previousBuild.version !== version) {
      throw new Error("Existing build is not bound to the selected source SHA and version");
    }
  }
  await run(
    process.execPath,
    [
      "scripts/package-openclaw-for-docker.mjs",
      "--output-dir",
      outputDir,
      "--output-name",
      PACKAGE,
      ...(options.skipBuild ? ["--skip-build"] : []),
    ],
    { env },
  );
  const stage = await fs.mkdtemp(path.join(outputDir, ".stage-package-"));
  try {
    const { packageRoot, packageJson, buildInfo } = await readStagedPackage(
      stage,
      path.join(outputDir, PACKAGE),
      { requireFinality: !options.candidate && !options.nativeArtifactsDir },
    );
    if (options.nativeArtifactsDir) {
      const { sourceArchive } = await applyCypherClawNativeArtifacts({
        packageRoot,
        artifactsDir: path.resolve(options.nativeArtifactsDir),
        ...(options.nativeSourceSha
          ? {
              nativeSourceSha: options.nativeSourceSha,
              nativeDistributionSha: options.nativeDistributionSha,
              sourceBundleDir: path.resolve(options.nativeSourceBundleDir),
            }
          : {}),
      });
      if (sourceArchive && !packageJson.files.includes(sourceArchive)) {
        packageJson.files.push(sourceArchive);
      }
      nativeLimitations = await verifyNativeProvenance(packageRoot, { requireFinality: true });
    }
    if (buildInfo.commit !== sourceCommit || buildInfo.version !== version) {
      throw new Error("Package build metadata does not match the selected source SHA and version");
    }
    packageJson.openclaw.distribution = {
      id: "cypherclaw",
      repository: REPOSITORY,
      channel: "stable",
      sourceBranch: SOURCE_BRANCH,
      sourceCommit,
      releaseTag,
      ...(releaseSource
        ? {
            reviewedSourceCommit: releaseSource.reviewedSourceCommit,
            nativeSourceCommit: releaseSource.nativeSourceCommit,
            nativeDistributionCommit: releaseSource.nativeDistributionCommit,
          }
        : {}),
    };
    await fs.writeFile(
      path.join(packageRoot, "package.json"),
      `${JSON.stringify(packageJson, null, 2)}\n`,
    );
    createTar(
      { cwd: stage, file: path.join(outputDir, PACKAGE), gzip: true, portable: true, sync: true },
      ["package"],
    );
  } finally {
    await fs.rm(stage, { recursive: true, force: true });
  }
  await run(process.execPath, [
    "scripts/check-openclaw-package-tarball.mjs",
    "--require-bundled-workspace-deps",
    path.join(outputDir, PACKAGE),
  ]);
  const assets = [];
  for (const [destination, source] of ASSETS) {
    await fs.copyFile(path.join(ROOT, source), path.join(outputDir, destination));
    assets.push(await describeFile(outputDir, destination));
  }
  if (!options.candidate) {
    if (
      (await run("git", ["rev-parse", "HEAD"], { capture: true })) !== sourceCommit ||
      (await run("git", ["status", "--porcelain", "--untracked-files=normal"], { capture: true }))
    ) {
      throw new Error(
        "The source checkout changed during release preparation; retain the candidate and rebuild from a clean selected SHA",
      );
    }
  }
  const manifest = {
    schemaVersion: 1,
    repository: REPOSITORY,
    channel: "stable",
    sourceBranch: SOURCE_BRANCH,
    sourceCommit,
    ...(releaseSource
      ? {
          reviewedSourceCommit: releaseSource.reviewedSourceCommit,
          nativeSourceCommit: releaseSource.nativeSourceCommit,
          nativeDistributionCommit: releaseSource.nativeDistributionCommit,
        }
      : {}),
    version,
    releaseTag,
    nodeVersion: NODE_VERSION,
    package: {
      ...(await describeFile(outputDir, PACKAGE)),
      name: "openclaw",
      nodeEngine: sourcePackage.engines.node,
      schemaVersions: sourcePackage.openclaw.schemaVersions,
    },
    assets,
    supportedTargets: [...CYPHERCLAW_TARGETS],
    publication: {
      ready: !options.candidate,
      limitations: options.candidate
        ? [
            "Local candidate proof; worktree bytes are not an immutable reviewed release commit.",
            ...nativeLimitations,
          ]
        : [],
    },
  };
  await fs.writeFile(path.join(outputDir, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);
  const checksums = [manifest.package, ...assets, await describeFile(outputDir, MANIFEST)]
    .toSorted((a, b) => a.file.localeCompare(b.file))
    .map(({ file, sha256 }) => `${sha256}  ${file}\n`)
    .join("");
  await fs.writeFile(path.join(outputDir, "SHA256SUMS"), checksums);
  await checkRelease(outputDir);
  console.log(
    `Prepared ${outputDir}; ${
      manifest.publication.ready
        ? "ready for publication."
        : "local candidate remains unpublishable."
    }`,
  );
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
