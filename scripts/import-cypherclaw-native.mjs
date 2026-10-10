#!/usr/bin/env node

import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { booleanFlag, parseFlagArgs, stringFlag } from "./lib/arg-utils.runtime.mjs";
import { hashFile } from "./lib/cypherclaw-contract.mjs";
import { assertRealOutputRoot } from "./lib/output-root-guard.mjs";

const execFileAsync = promisify(execFile);
const TARGETS = ["linux-amd64", "darwin-arm64", "windows-amd64"];
const DLLS = [
  "libcrypto-3-x64.dll",
  "libgcc_s_seh-1.dll",
  "libgmp-10.dll",
  "libstdc++-6.dll",
  "libwinpthread-1.dll",
];
const RECORDS = ["manifest.txt", "SHA256SUMS", "go-build-info.txt"];

async function git(root, ...args) {
  const env = { ...process.env, GIT_NO_REPLACE_OBJECTS: "1" };
  for (const key of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR"]) {
    delete env[key];
  }
  return (
    await execFileAsync("git", ["-c", "maintenance.auto=false", "-c", "gc.auto=0", ...args], {
      cwd: root,
      env,
      encoding: "utf8",
    })
  ).stdout.trim();
}

async function regularFile(root, relative) {
  let file = root;
  const parts = relative.split("/");
  for (let index = 0; index < parts.length; index += 1) {
    file = path.join(file, parts[index]);
    const stat = await fs.lstat(file);
    if (
      stat.isSymbolicLink() ||
      (index < parts.length - 1 ? !stat.isDirectory() : !stat.isFile())
    ) {
      throw new Error(`Official native distribution contains an unsafe file: ${relative}`);
    }
  }
  return file;
}

async function importNative({ sourceDir, distributionSha, outputDir }) {
  if (!/^[a-f0-9]{40}$/u.test(distributionSha)) {
    throw new Error("--distribution-sha must be a full lowercase 40-character commit SHA");
  }
  const source = await fs.realpath(sourceDir);
  if (path.resolve(await git(source, "rev-parse", "--show-toplevel")) !== source) {
    throw new Error("--source-dir must name the Cypher repository root");
  }
  const output = path.resolve(outputDir);
  const relative = path.relative(source, output);
  if (
    !relative ||
    (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
  ) {
    throw new Error("--output-dir must be outside the Cypher checkout");
  }
  assertRealOutputRoot(output);
  await fs.mkdir(output, { recursive: true });
  if ((await fs.readdir(output)).length) {
    throw new Error("Official native import requires a new or empty output directory");
  }
  const clone = await fs.mkdtemp(path.join(output, ".official-source-"));
  try {
    await git(source, "clone", "--quiet", "--no-hardlinks", "--no-checkout", "--", source, clone);
    await git(clone, "config", "core.autocrlf", "false");
    await git(clone, "checkout", "--quiet", "--detach", distributionSha);
    if (await git(clone, "status", "--porcelain", "--untracked-files=normal")) {
      throw new Error("Official native import requires a clean distribution checkout");
    }
    let nativeSourceCommit;
    const copies = [];
    for (const target of TARGETS) {
      const provenance = `build/provenance/${target}`;
      const manifest = await fs.readFile(
        await regularFile(clone, `${provenance}/manifest.txt`),
        "utf8",
      );
      const sourceRows = [...manifest.matchAll(/^source_sha=([a-f0-9]{40})\r?$/gmu)];
      if (
        sourceRows.length !== 1 ||
        (nativeSourceCommit && sourceRows[0][1] !== nativeSourceCommit)
      ) {
        throw new Error(
          "Official native artifacts do not share one source commit; run the FHS-D native build first",
        );
      }
      nativeSourceCommit = sourceRows[0][1];
      const binary = target === "windows-amd64" ? "cypher.exe" : `cypher-${target}`;
      const payload = [binary, ...(target === "windows-amd64" ? DLLS : [])];
      if (target === "linux-amd64") {
        try {
          await regularFile(clone, "build/bin/cypher");
          payload.push("cypher");
        } catch (error) {
          if (error.code !== "ENOENT") {
            throw error;
          }
        }
      }
      for (const file of payload) {
        copies.push({ target, file, source: await regularFile(clone, `build/bin/${file}`) });
      }
      for (const file of RECORDS) {
        copies.push({ target, file, source: await regularFile(clone, `${provenance}/${file}`) });
      }
    }
    try {
      await git(clone, "merge-base", "--is-ancestor", nativeSourceCommit, distributionSha);
    } catch (error) {
      throw new Error(
        "Official FHS-D native source is not an ancestor of its distribution commit; run and publish the three-OS native build first",
        { cause: error },
      );
    }
    const changed = (
      await git(
        clone,
        "diff",
        "--name-only",
        "--no-renames",
        "-z",
        nativeSourceCommit,
        distributionSha,
      )
    )
      .split("\0")
      .filter(Boolean);
    if (
      changed.some(
        (file) => !file.startsWith("build/bin/") && !file.startsWith("build/provenance/"),
      )
    ) {
      throw new Error(
        "FHS-D source changed after the official native build. Run and publish the three-OS native build for the latest source before importing it",
      );
    }
    // Byte validation remains with the package overlay owner; this adapter preserves producer records.
    for (const entry of copies) {
      const destination = path.join(output, "native", entry.target, entry.file);
      await fs.mkdir(path.dirname(destination), { recursive: true });
      const before = await hashFile(entry.source);
      await fs.copyFile(entry.source, destination);
      if ((await hashFile(destination)).sha256 !== before.sha256) {
        throw new Error(
          `Official native bytes changed during import: ${entry.target}/${entry.file}`,
        );
      }
    }
    return { nativeSourceCommit, nativeDistributionCommit: distributionSha };
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error(
        `Official FHS-D native provenance is incomplete. Run and publish its three-OS native build first. ${error.message}`,
      );
    }
    throw error;
  } finally {
    await fs.rm(clone, { recursive: true, force: true });
  }
}

async function main() {
  const options = parseFlagArgs(
    process.argv.slice(2),
    { sourceDir: "", distributionSha: "", outputDir: "", help: false },
    [
      stringFlag("--source-dir", "sourceDir"),
      stringFlag("--distribution-sha", "distributionSha"),
      stringFlag("--output-dir", "outputDir"),
      booleanFlag("--help", "help"),
    ],
  );
  if (options.help) {
    console.log(
      "Usage: node scripts/import-cypherclaw-native.mjs --source-dir <Cypher checkout> --distribution-sha <full SHA> --output-dir <directory>",
    );
    return;
  }
  if (!options.sourceDir || !options.outputDir) {
    throw new Error("--source-dir, --distribution-sha, and --output-dir are required");
  }
  console.log(JSON.stringify(await importNative(options)));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
