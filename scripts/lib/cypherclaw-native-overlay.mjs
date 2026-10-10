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
export async function applyCypherClawNativeArtifacts({ packageRoot, artifactsDir }) {
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
  const ledger = checksumLedger(await readText(source, "SHA256SUMS"), "cypher");
  for (const [relative, expected] of ledger) {
    if ((await hashFile(await regularFile(source, relative))).sha256 !== expected) {
      throw new Error(`Package native provenance mismatch before overlay: cypher/${relative}`);
    }
  }
  const finality = JSON.parse(await readText(source, "patches/transaction-finality-source.json"));
  if (
    !/^[a-f0-9]{40}$/u.test(finality.baseCommit) ||
    finality.patch !== "transaction-finality-ipc.patch" ||
    finality.patchSha256 !== ledger.get(`patches/${finality.patch}`) ||
    finality.method !== "eth_getTransactionFinality" ||
    finality.transport !== "ipc"
  ) {
    throw new Error("Native overlay requires package-bound transaction finality source metadata");
  }
  const replacements = [];
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
      source_patch_sha256: finality.patchSha256,
      ipc_transaction_finality_method: finality.method,
      goos,
      goarch,
      go_version: "go1.26.2",
      build_tags: "cypher_bounded_storage",
      binary,
      binary_sha256: checksums.get(binary),
    };
    if (
      Object.entries(required).some(([key, value]) => manifest.get(key) !== value) ||
      PINS.some((key) => !previous.get(key) || manifest.get(key) !== previous.get(key)) ||
      !["bls_sha256", "mcl_sha256"].every((key) => DIGEST.test(manifest.get(key) ?? ""))
    ) {
      throw new Error(
        `Native source, target, toolchain, or dependency binding mismatch: ${target}`,
      );
    }
    const buildInfo = await readText(directory, "go-build-info.txt");
    if (
      !/^[^\r\n]+: go1\.26\.2\r?\n/u.test(buildInfo) ||
      ![`GOOS=${goos}`, `GOARCH=${goarch}`, "CGO_ENABLED=1", "-tags=cypher_bounded_storage"].every(
        (field) => buildInfo.split(/\r?\n/u).includes(`\tbuild\t${field}`),
      )
    ) {
      throw new Error(`Native embedded Go metadata mismatch: ${target}`);
    }
    if (checksums.has("cypher") && checksums.get("cypher") !== checksums.get(binary)) {
      throw new Error("Native Linux duplicate cypher differs from the canonical binary");
    }
    if (goos === "windows") {
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
    for (const file of ["manifest.txt", "SHA256SUMS", "go-build-info.txt"]) {
      replacements.push({
        directory,
        from: file,
        to: `provenance/${target}/${file}`,
        sha256: (await hashFile(path.join(directory, file))).sha256,
      });
    }
  }
  const historical = "provenance/original-bundle-BUILDINFO.txt";
  const original = await readText(source, "BUILDINFO.txt");
  if (!ledger.has("BUILDINFO.txt")) {
    throw new Error("Native package provenance is missing BUILDINFO.txt");
  }
  if (!ledger.has(historical)) {
    try {
      await fs.lstat(path.join(source, historical));
      throw new Error("Untracked historical native BUILDINFO already exists");
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
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
  if (!ledger.has(historical)) {
    await fs.writeFile(path.join(source, historical), original, { flag: "wx" });
    ledger.set(historical, (await hashFile(path.join(source, historical))).sha256);
  }
  await fs.writeFile(
    path.join(source, "BUILDINFO.txt"),
    [
      "CypherClaw patched native node provenance",
      `Repository: ${finality.repository}`,
      `Source commit: ${finality.baseCommit}`,
      `Finality patch SHA256: ${finality.patchSha256}`,
      `IPC method: ${finality.method} (IPC only; boolean result)`,
      `Targets: ${TARGETS.join(", ")}`,
      "Go version: go1.26.2; CGO_ENABLED=1; build tag: cypher_bounded_storage",
      "Each target's manifest, SHA256SUMS and go-build-info identify this build.",
      "Herumi and LevelDB references and the five Windows DLL bytes remain pinned to the retained bundle.",
      `Historical bundle description: ${historical}`,
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
