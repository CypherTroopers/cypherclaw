import fs from "node:fs/promises";
import path from "node:path";
import { hashFile } from "./cypherclaw-contract.mjs";

const TARGETS = ["linux-amd64", "darwin-arm64", "windows-amd64"];
const DLLS = [
  "libcrypto-3-x64.dll",
  "libgcc_s_seh-1.dll",
  "libgmp-10.dll",
  "libstdc++-6.dll",
  "libwinpthread-1.dll",
];
const PINS = [
  "herumi_ref",
  "leveldb_module",
  "leveldb_version",
  "leveldb_module_sum",
  "leveldb_patch_sha256",
];
const DIGEST = /^[a-f0-9]{64}$/u;

function checksumLedger(text, label) {
  const entries = new Map();
  for (const line of text.trim().split(/\r?\n/u)) {
    const match = /^([a-f0-9]{64}) {2}([a-zA-Z0-9._+-]+(?:\/[a-zA-Z0-9._+-]+)*)$/u.exec(line);
    if (!match || match[2].split("/").some((part) => part === "." || part === "..")) {
      throw new Error(`Malformed or unsafe native checksum ledger: ${label}`);
    }
    if (entries.has(match[2])) {
      throw new Error(`Duplicate native checksum path: ${label}/${match[2]}`);
    }
    entries.set(match[2], match[1]);
  }
  return entries;
}

function manifestEntries(text, label) {
  const entries = new Map();
  for (const line of text.trim().split(/\r?\n/u)) {
    const match = /^([a-zA-Z0-9._+-]+)=(.+)$/u.exec(line);
    if (!match || entries.has(match[1])) {
      throw new Error(`Malformed or duplicate native manifest entry: ${label}`);
    }
    entries.set(match[1], match[2]);
  }
  return entries;
}

async function realDirectory(directory) {
  const resolved = path.resolve(directory);
  if ((await fs.realpath(resolved)) !== resolved || !(await fs.lstat(resolved)).isDirectory()) {
    throw new Error(`Native package input must be a real directory: ${directory}`);
  }
  return resolved;
}

async function regularFile(root, relative) {
  const parts = relative.split("/");
  let filename = root;
  for (let index = 0; index < parts.length; index += 1) {
    filename = path.join(filename, parts[index]);
    const stat = await fs.lstat(filename);
    if (
      stat.isSymbolicLink() ||
      (index < parts.length - 1 ? !stat.isDirectory() : !stat.isFile())
    ) {
      throw new Error(`Native package path must be regular and contain no symlinks: ${filename}`);
    }
  }
  return filename;
}

async function readText(root, relative) {
  return await fs.readFile(await regularFile(root, relative), "utf8");
}

/** Overlay validated native builds only in the canonical packer's extracted package. */
export async function applyCypherClawNativeArtifacts({
  packageRoot,
  artifactsDir,
  nativeSourceSha,
  sourceBundleDir,
  nativeDistributionSha,
}) {
  const official = Boolean(nativeDistributionSha || nativeSourceSha || sourceBundleDir);
  if (official && (!nativeDistributionSha || !nativeSourceSha || !sourceBundleDir)) {
    throw new Error(
      "Official native distribution SHA, source SHA, and source bundle directory must be supplied together",
    );
  }
  if (
    nativeSourceSha &&
    (typeof nativeSourceSha !== "string" || !/^[a-f0-9]{40}$/u.test(nativeSourceSha))
  ) {
    throw new Error("Native source SHA must be a full lowercase 40-character commit SHA");
  }
  if (
    official &&
    (typeof nativeDistributionSha !== "string" || !/^[a-f0-9]{40}$/u.test(nativeDistributionSha))
  ) {
    throw new Error("Native distribution SHA must be a full lowercase 40-character commit SHA");
  }
  const source = await realDirectory(path.join(await realDirectory(packageRoot), "cypher"));
  const artifacts = await realDirectory(artifactsDir);
  const directories = await fs.readdir(artifacts);
  if (
    directories.length !== TARGETS.length ||
    !TARGETS.every((target) => directories.includes(target))
  ) {
    throw new Error(
      "Native artifacts must contain exactly linux-amd64, darwin-arm64, windows-amd64",
    );
  }
  const originalLedger = await readText(source, "SHA256SUMS");
  const ledger = checksumLedger(originalLedger, "cypher");
  for (const [relative, expected] of ledger) {
    if ((await hashFile(await regularFile(source, relative))).sha256 !== expected) {
      throw new Error(`Package native provenance mismatch before overlay: cypher/${relative}`);
    }
  }
  let finality = JSON.parse(await readText(source, "patches/transaction-finality-source.json"));
  if (
    !/^[a-f0-9]{40}$/u.test(finality.baseCommit) ||
    (finality.reviewedBaseCommit != null && !/^[a-f0-9]{40}$/u.test(finality.reviewedBaseCommit)) ||
    !ledger.has("patches/transaction-finality-source.json") ||
    finality.patch !== "transaction-finality-ipc.patch" ||
    finality.patchSha256 !== ledger.get(`patches/${finality.patch}`) ||
    finality.method !== "eth_getTransactionFinality" ||
    finality.transport !== "ipc"
  ) {
    throw new Error("Native overlay requires package-bound transaction finality source metadata");
  }
  let sourceBundle;
  if (nativeSourceSha) {
    const directory = await realDirectory(sourceBundleDir);
    const file = `cypher-source-${nativeSourceSha}.tar.gz`;
    const files = await fs.readdir(directory);
    if (files.length !== 2 || !files.includes(file) || !files.includes("SHA256SUMS")) {
      throw new Error(
        "Native source bundle must contain exactly the selected source archive and SHA256SUMS",
      );
    }
    const checksums = checksumLedger(await readText(directory, "SHA256SUMS"), "native source");
    const sha256 = (await hashFile(await regularFile(directory, file))).sha256;
    if (checksums.size !== 1 || checksums.get(file) !== sha256) {
      throw new Error("Native source archive checksum does not bind the selected source bundle");
    }
    if (ledger.has(file)) {
      await regularFile(source, file);
    } else {
      try {
        await fs.lstat(path.join(source, file));
        throw new Error("Untracked selected native source archive already exists in the package");
      } catch (error) {
        if (error.code !== "ENOENT") {
          throw error;
        }
      }
    }
    sourceBundle = { directory, file, sha256 };
    finality = {
      ...finality,
      reviewedBaseCommit: finality.reviewedBaseCommit ?? finality.baseCommit,
      sourceIntegration: "FHS-D",
      distributionCommit: nativeDistributionSha,
      baseCommit: nativeSourceSha,
      baseSourceArchive: {
        file,
        commit: nativeSourceSha,
        sha256,
        relationship:
          "Selected official FHS-D repository source with integrated transaction finality IPC. The historical finality patch is retained separately. This archive does not establish Go module or native dependency source completeness.",
      },
    };
  }
  const replacements = [];
  let nativePins;
  let goVersion = "go1.26.2";
  for (const target of TARGETS) {
    const directory = await realDirectory(path.join(artifacts, target));
    const [goos, goarch] = target.split("-");
    const binary = goos === "windows" ? "cypher.exe" : `cypher-${target}`;
    const files = await fs.readdir(directory);
    const allowed = new Set([binary, "manifest.txt", "SHA256SUMS", "go-build-info.txt"]);
    if (goos === "windows") {
      DLLS.forEach((dll) => allowed.add(dll));
    } else if (goos === "linux" && files.includes("cypher")) {
      allowed.add("cypher");
    }
    if (files.length !== allowed.size || files.some((file) => !allowed.has(file))) {
      throw new Error(`Native artifact files are incomplete or unexpected: ${target}`);
    }
    const checksums = checksumLedger(await readText(directory, "SHA256SUMS"), target);
    if (
      checksums.size !== files.length - 1 ||
      files.some((file) => file !== "SHA256SUMS" && !checksums.has(file))
    ) {
      throw new Error(`Native artifact checksums must cover every staged file: ${target}`);
    }
    for (const [file, expected] of checksums) {
      if ((await hashFile(await regularFile(directory, file))).sha256 !== expected) {
        throw new Error(`Native artifact checksum mismatch: ${target}/${file}`);
      }
    }
    const manifest = manifestEntries(await readText(directory, "manifest.txt"), target);
    const previous = manifestEntries(
      await readText(source, `provenance/${target}/manifest.txt`),
      target,
    );
    const required = {
      source_sha: finality.baseCommit,
      ...(official
        ? { ipc_transaction_finality_transport: "ipc" }
        : { source_patch_sha256: finality.patchSha256 }),
      ipc_transaction_finality_method: finality.method,
      goos,
      goarch,
      go_version: official ? manifest.get("go_version") : "go1.26.2",
      build_tags: "cypher_bounded_storage",
      binary,
      binary_sha256: checksums.get(binary),
    };
    if (
      Object.entries(required).some(([key, value]) => manifest.get(key) !== value) ||
      (official && !manifest.get("compiler_identity")) ||
      PINS.some(
        (key) => !manifest.get(key) || (!official && manifest.get(key) !== previous.get(key)),
      ) ||
      !["bls_sha256", "mcl_sha256"].every((key) => DIGEST.test(manifest.get(key) ?? ""))
    ) {
      throw new Error(
        `Native source, target, toolchain, or dependency binding mismatch: ${target}`,
      );
    }
    if (official) {
      const pins = [manifest.get("go_version"), ...PINS.map((key) => manifest.get(key))];
      if (
        !/^go[0-9]+\.[0-9]+(?:\.[0-9]+)?$/u.test(pins[0]) ||
        (nativePins && pins.some((value, index) => value !== nativePins[index]))
      ) {
        throw new Error(
          "Official native targets must share one Go toolchain and native dependency selection",
        );
      }
      nativePins = pins;
      goVersion = pins[0];
    }
    const buildInfo = await readText(directory, "go-build-info.txt");
    if (
      !buildInfo.split(/\r?\n/u)[0].endsWith(`: ${goVersion}`) ||
      ![
        `GOOS=${goos}`,
        `GOARCH=${goarch}`,
        "CGO_ENABLED=1",
        "-tags=cypher_bounded_storage",
        ...(official ? ["-compiler=gc"] : []),
      ].every((field) => buildInfo.split(/\r?\n/u).includes(`\tbuild\t${field}`))
    ) {
      throw new Error(`Native embedded Go metadata mismatch: ${target}`);
    }
    if (checksums.has("cypher") && checksums.get("cypher") !== checksums.get(binary)) {
      throw new Error("Native Linux duplicate cypher differs from the canonical binary");
    }
    if (goos === "windows" && !official) {
      for (const dll of DLLS) {
        const expected = ledger.get(`build/bin/${dll}`);
        if (!expected || checksums.get(dll) !== expected) {
          throw new Error(`Windows runtime DLL differs from its pinned package provenance: ${dll}`);
        }
      }
    }
    replacements.push({
      directory,
      from: binary,
      to: `build/bin/${binary}`,
      sha256: checksums.get(binary),
      executable: true,
    });
    if (goos === "windows" && official) {
      for (const dll of DLLS) {
        replacements.push({
          directory,
          from: dll,
          to: `build/bin/${dll}`,
          sha256: checksums.get(dll),
        });
      }
    }
    for (const file of ["manifest.txt", "SHA256SUMS", "go-build-info.txt"]) {
      replacements.push({
        directory,
        from: file,
        to: `provenance/${target}/${file}`,
        sha256: (await hashFile(path.join(directory, file))).sha256,
      });
    }
  }
  const historical = new Map([
    ["provenance/original-bundle-BUILDINFO.txt", await readText(source, "BUILDINFO.txt")],
    ["provenance/original-bundle-SHA256SUMS", originalLedger],
  ]);
  if (!ledger.has("BUILDINFO.txt")) {
    throw new Error("Native package provenance is missing BUILDINFO.txt");
  }
  for (const file of historical.keys()) {
    if (!ledger.has(file)) {
      try {
        await fs.lstat(path.join(source, file));
        throw new Error(`Untracked historical native provenance already exists: ${file}`);
      } catch (error) {
        if (error.code !== "ENOENT") {
          throw error;
        }
      }
    }
  }
  for (const { to } of replacements) {
    if (!ledger.has(to)) {
      throw new Error(`Native package provenance is missing overlay destination: ${to}`);
    }
    await regularFile(source, to);
  }

  // All targets are admitted before any package byte changes; source checkout stays untouched.
  for (const { directory, from, to, sha256, executable } of replacements) {
    await fs.copyFile(path.join(directory, from), path.join(source, to));
    if (executable) {
      await fs.chmod(path.join(source, to), 0o755);
    }
    if ((await hashFile(path.join(source, to))).sha256 !== sha256) {
      throw new Error(`Native artifact changed during package overlay: ${to}`);
    }
    ledger.set(to, sha256);
  }
  if (sourceBundle) {
    const { directory, file, sha256 } = sourceBundle;
    await fs.copyFile(path.join(directory, file), path.join(source, file));
    if ((await hashFile(path.join(source, file))).sha256 !== sha256) {
      throw new Error("Native source archive changed during package overlay");
    }
    ledger.set(file, sha256);
    const metadata = "patches/transaction-finality-source.json";
    await fs.writeFile(path.join(source, metadata), `${JSON.stringify(finality, null, 2)}\n`);
    ledger.set(metadata, (await hashFile(path.join(source, metadata))).sha256);
  }
  for (const [file, content] of historical) {
    if (!ledger.has(file)) {
      await fs.writeFile(path.join(source, file), content, { flag: "wx" });
      ledger.set(file, (await hashFile(path.join(source, file))).sha256);
    }
  }
  await fs.writeFile(
    path.join(source, "BUILDINFO.txt"),
    [
      official
        ? "CypherClaw official FHS-D native node provenance"
        : "CypherClaw patched native node provenance",
      `Repository: ${finality.repository}`,
      `Source commit: ${finality.baseCommit}`,
      ...(official ? [`Official native distribution commit: ${nativeDistributionSha}`] : []),
      `Source archive: ${finality.baseSourceArchive.file}`,
      `Source archive SHA256: ${finality.baseSourceArchive.sha256}`,
      ...(sourceBundle
        ? [
            `Reviewed patch base: ${finality.reviewedBaseCommit}`,
            "The current archive contains repository source only. Dependency sources retained from the original bundle may differ from the current Go module graph; current dependency source completeness is not established.",
          ]
        : []),
      `${official ? "Historical finality patch" : "Finality patch"} SHA256: ${finality.patchSha256}`,
      `IPC method: ${finality.method} (IPC only; boolean result)`,
      `Targets: ${TARGETS.join(", ")}`,
      `Go version: ${goVersion}; CGO_ENABLED=1; build tag: cypher_bounded_storage`,
      "Each target's manifest, SHA256SUMS and go-build-info identify this build.",
      official
        ? "Herumi and LevelDB references and Windows DLL hashes identify the selected official FHS-D distribution."
        : "Herumi and LevelDB references and the five Windows DLL bytes remain pinned to the retained bundle.",
      "Historical bundle description: provenance/original-bundle-BUILDINFO.txt",
      "Historical executable and DLL hashes: provenance/original-bundle-SHA256SUMS",
      "provenance/native-dependency-build-log-excerpts.txt and provenance/msys2/ describe the original bundle.",
      "Retained licenses and source-completeness limitations in the historical description still apply.",
      "Successful native build checks and embedded metadata are not live-chain or installer end-to-end proof.",
      "",
    ].join("\n"),
  );
  ledger.set("BUILDINFO.txt", (await hashFile(path.join(source, "BUILDINFO.txt"))).sha256);
  await fs.writeFile(
    path.join(source, "SHA256SUMS"),
    [...ledger].map(([file, hash]) => `${hash}  ${file}\n`).join(""),
  );
}
