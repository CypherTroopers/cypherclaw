#!/usr/bin/env node

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The release asset sits beside its contract; the source entry uses scripts/lib.
const contractPath =
  path.basename(fileURLToPath(import.meta.url)) === "install-runtime.mjs"
    ? "./cypherclaw-contract.mjs"
    : "./lib/cypherclaw-contract.mjs";
const {
  CYPHERCLAW_NODE_VERSION,
  parseCypherClawDistribution,
  parseChecksumFile,
  validateCypherClawReleaseManifest,
  verifyAsset,
  hashFile,
} = await import(new URL(contractPath, import.meta.url));

function parseArgs(argv) {
  const options = {
    prefix: path.join(os.homedir(), ".cypherclaw"),
    releaseDir: "",
    releaseTag: "",
    noOnboard: false,
    dryRun: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (["--prefix", "--release-dir", "--release-tag"].includes(arg)) {
      const value = argv[++index];
      if (!value || value.startsWith("--")) {
        throw new Error(`Missing value for ${arg}.`);
      }
      options[
        { "--prefix": "prefix", "--release-dir": "releaseDir", "--release-tag": "releaseTag" }[arg]
      ] = value;
    } else if (arg === "--no-onboard") {
      options.noOnboard = true;
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  return options;
}

async function run(command, args, env, capture = false) {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
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
        reject(new Error(`${path.basename(command)} failed (${code ?? signal}).`));
      }
    });
  });
}

async function exists(file) {
  try {
    await fs.lstat(file);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function readPackage(root) {
  return JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
}

function requireDistribution(pkg, manifest, requireSelected = true) {
  const distribution = parseCypherClawDistribution(pkg.openclaw?.distribution);
  if (pkg.name !== "openclaw" || !distribution) {
    throw new Error(
      "The private install directory does not contain a CypherClaw distribution. Choose a different --prefix.",
    );
  }
  if (
    requireSelected &&
    (pkg.version !== manifest.version ||
      distribution.releaseTag !== manifest.releaseTag ||
      distribution.sourceCommit !== manifest.sourceCommit)
  ) {
    throw new Error("Installed package identity differs from the verified CypherClaw release.");
  }
}

async function verifyRelease(directory, selectedTag) {
  const checksums = parseChecksumFile(
    await fs.readFile(path.join(directory, "SHA256SUMS"), "utf8"),
  );
  const manifestFile = path.join(directory, "cypherclaw-release.json");
  if ((await hashFile(manifestFile)).sha256 !== checksums.get("cypherclaw-release.json")) {
    throw new Error("CypherClaw release manifest checksum does not match SHA256SUMS.");
  }
  const manifest = validateCypherClawReleaseManifest(
    JSON.parse(await fs.readFile(manifestFile, "utf8")),
  );
  if (selectedTag && manifest.releaseTag !== selectedTag) {
    throw new Error("Requested release tag differs from the downloaded manifest.");
  }
  if (!manifest.supportedTargets.includes(`${process.platform}-${process.arch}`)) {
    throw new Error(`No bundled Cypher node for ${process.platform}-${process.arch}.`);
  }
  const required = new Set([
    "cypherclaw.tgz",
    "install-runtime.mjs",
    "cypherclaw-contract.mjs",
    process.platform === "win32" ? "install-node.ps1" : "install-node.sh",
  ]);
  for (const asset of [manifest.package, ...manifest.assets]) {
    if (!required.has(asset.file) && !(await exists(path.join(directory, asset.file)))) {
      continue;
    }
    const filename = path.join(directory, asset.file);
    const stat = await fs.lstat(filename);
    if (!stat.isFile() || stat.isSymbolicLink() || checksums.get(asset.file) !== asset.sha256) {
      throw new Error(`Release asset is missing or differs from its manifest: ${asset.file}`);
    }
    await verifyAsset(filename, asset);
    required.delete(asset.file);
  }
  if (required.size) {
    throw new Error(`Release assets are missing: ${[...required].join(", ")}`);
  }
  return manifest;
}

async function writeLaunchers(prefix, preflightOnly = false) {
  const directory = path.join(prefix, "bin");
  await fs.mkdir(directory, { recursive: true });
  const shell =
    '#!/bin/sh\n# CypherClaw managed launcher.\nscript_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nprefix=$(dirname -- "$script_dir")\nexport NPM_CONFIG_PREFIX="$prefix"\nexport PATH="$prefix/tools/node/bin:$prefix/bin:$PATH"\n: "${OPENCLAW_PROFILE:=cypherclaw}"\nexport OPENCLAW_PROFILE\nexec "$prefix/tools/node/bin/node" "$prefix/lib/node_modules/openclaw/openclaw.mjs" "$@"\n';
  const batch =
    '@echo off\r\nrem CypherClaw managed launcher.\r\nset "NPM_CONFIG_PREFIX=%~dp0.."\r\nset "PATH=%~dp0..\\tools\\node;%~dp0;%PATH%"\r\nif not defined OPENCLAW_PROFILE set "OPENCLAW_PROFILE=cypherclaw"\r\n"%~dp0..\\tools\\node\\node.exe" "%~dp0..\\node_modules\\openclaw\\openclaw.mjs" %*\r\n';
  for (const name of ["cypherclaw"]) {
    const filename = path.join(directory, process.platform === "win32" ? `${name}.cmd` : name);
    if (await exists(filename)) {
      const stat = await fs.lstat(filename);
      if (
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        !(await fs.readFile(filename, "utf8")).includes("CypherClaw managed launcher.")
      ) {
        throw new Error(`Refusing to overwrite an existing launcher: ${filename}`);
      }
    }
    if (!preflightOnly) {
      await fs.writeFile(filename, process.platform === "win32" ? batch : shell, { mode: 0o755 });
    }
  }
}

function npmLaunchers(prefix) {
  return process.platform === "win32"
    ? ["openclaw", "openclaw.cmd", "openclaw.ps1"].map((name) => path.join(prefix, name))
    : [path.join(prefix, "bin", "openclaw")];
}

async function preflightFreshNpmLaunchers(prefix) {
  for (const filename of npmLaunchers(prefix)) {
    if (await exists(filename)) {
      throw new Error(`Refusing to overwrite an existing npm launcher: ${filename}`);
    }
  }
}

async function promoteNpmLaunchers(stage, prefix, promoted) {
  const sources = npmLaunchers(stage);
  const destinations = npmLaunchers(prefix);
  for (let index = 0; index < sources.length; index++) {
    // npm owns the technical shim format used by update destination admission.
    // Relative package paths remain valid when the staging prefix is promoted.
    if (process.platform === "win32") {
      await fs.copyFile(sources[index], destinations[index], fs.constants.COPYFILE_EXCL);
    } else {
      await fs.symlink(await fs.readlink(sources[index]), destinations[index]);
    }
    promoted.push(destinations[index]);
  }
}

async function persistLauncherPath(prefix, env) {
  const bin = path.join(prefix, "bin");
  try {
    if (process.platform === "win32") {
      const script =
        '$bin = $env:CYPHERCLAW_INSTALL_BIN; $current = [Environment]::GetEnvironmentVariable("Path", "User"); $entries = @($current -split ";" | Where-Object { $_ }); if ($entries -notcontains $bin) { [Environment]::SetEnvironmentVariable("Path", (($entries + $bin) -join ";"), "User") }';
      await run(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-EncodedCommand",
          Buffer.from(script, "utf16le").toString("base64"),
        ],
        { ...env, CYPHERCLAW_INSTALL_BIN: bin },
      );
    } else {
      const rc = path.join(
        os.homedir(),
        path.basename(env.SHELL || "") === "zsh" ? ".zshrc" : ".bashrc",
      );
      const quoted = `'${bin.replaceAll("'", "'\\''")}'`;
      const entry = `export PATH=${quoted}:"$PATH"`;
      const current = (await exists(rc)) ? await fs.readFile(rc, "utf8") : "";
      if (!current.split(/\r?\n/).includes(entry)) {
        await fs.appendFile(
          rc,
          `${current && !current.endsWith("\n") ? "\n" : ""}\n# CypherClaw launcher\n${entry}\n`,
          { mode: 0o600 },
        );
      }
    }
    console.log("The cypherclaw command will be on PATH in new terminal sessions.");
  } catch (error) {
    console.warn(
      `Could not save launcher PATH: ${error.message}. Use ${path.join(bin, process.platform === "win32" ? "cypherclaw.cmd" : "cypherclaw")} directly.`,
    );
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(
      "Usage: install-runtime.mjs --release-dir <verified assets> [--prefix <directory>] [--release-tag <tag>] [--no-onboard] [--dry-run]",
    );
    return;
  }
  if (!options.releaseDir) {
    throw new Error("--release-dir is required; use install.sh or install.ps1.");
  }
  const prefix = path.resolve(options.prefix);
  if (prefix === path.parse(prefix).root || prefix === path.resolve(os.homedir())) {
    throw new Error("Choose a private subdirectory for --prefix.");
  }
  if (prefix.includes(path.delimiter)) {
    throw new Error(`Choose a --prefix without the PATH separator '${path.delimiter}'.`);
  }
  const releaseDir = path.resolve(options.releaseDir);
  const manifest = await verifyRelease(releaseDir, options.releaseTag);
  if (options.dryRun) {
    console.log(`Verified ${manifest.releaseTag}; install prebuilt package into ${prefix}.`);
    return;
  }
  if (process.version !== `v${CYPHERCLAW_NODE_VERSION}`) {
    throw new Error(
      `Use the private Node ${CYPHERCLAW_NODE_VERSION} installed by install.sh or install.ps1.`,
    );
  }
  const nodeRoot = path.join(prefix, "tools", "node");
  const node = path.join(nodeRoot, process.platform === "win32" ? "node.exe" : "bin/node");
  if ((await fs.realpath(process.execPath)) !== (await fs.realpath(node))) {
    throw new Error("Run this installer with its private Node runtime.");
  }
  const npm = path.join(
    nodeRoot,
    process.platform === "win32"
      ? "node_modules/npm/bin/npm-cli.js"
      : "lib/node_modules/npm/bin/npm-cli.js",
  );
  const packageRoot = path.join(
    prefix,
    process.platform === "win32" ? "node_modules/openclaw" : "lib/node_modules/openclaw",
  );
  const env = {
    ...process.env,
    OPENCLAW_PROFILE: process.env.OPENCLAW_PROFILE?.trim() || "cypherclaw",
    NPM_CONFIG_PREFIX: prefix,
    NPM_CONFIG_CACHE: path.join(prefix, ".cache", "npm"),
    PATH: [path.dirname(node), path.join(prefix, "bin"), process.env.PATH]
      .filter(Boolean)
      .join(path.delimiter),
  };
  for (const key of [
    "NPM_CONFIG_BEFORE",
    "npm_config_before",
    "NPM_CONFIG_MIN_RELEASE_AGE",
    "npm_config_min_release_age",
    "npm_config_min-release-age",
  ]) {
    delete env[key];
  }
  await fs.mkdir(prefix, { recursive: true });
  const lock = path.join(prefix, ".install-lock");
  try {
    await fs.mkdir(lock);
  } catch (error) {
    if (error.code === "EEXIST") {
      throw new Error(
        `Another installation owns ${lock}. If it stopped unexpectedly, remove that empty directory before retrying.`,
        { cause: error },
      );
    }
    throw error;
  }
  let stage;
  let activatedFreshPackage = false;
  const promotedNpmLaunchers = [];
  const managedLauncher = path.join(
    prefix,
    "bin",
    process.platform === "win32" ? "cypherclaw.cmd" : "cypherclaw",
  );
  let hadManagedLauncher = false;
  try {
    hadManagedLauncher = await exists(managedLauncher);
    await writeLaunchers(prefix, true);
    const tarball = path.join(releaseDir, manifest.package.file);
    if (await exists(packageRoot)) {
      requireDistribution(await readPackage(packageRoot), manifest, false);
      // Updates retain the existing owner's staging, admission, backups,
      // service recovery, and rollback rather than creating a second updater.
      await run(
        node,
        [path.join(packageRoot, "openclaw.mjs"), "update", "--tag", tarball, "--yes"],
        env,
      );
    } else {
      await preflightFreshNpmLaunchers(prefix);
      const npmVersion = await run(node, [npm, "--version"], env, true);
      const parsed = /^([0-9]+)\.([0-9]+)\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$/.exec(npmVersion);
      if (!parsed) {
        throw new Error("Cannot determine private npm version; no package changes were made.");
      }
      const lifecycle = [];
      if (Number(parsed[1]) >= 12 || (Number(parsed[1]) === 11 && Number(parsed[2]) >= 16)) {
        if (tarball.includes(",")) {
          throw new Error("npm lifecycle admission needs a release directory without commas.");
        }
        lifecycle.push(`--allow-scripts=${tarball}`);
      }
      stage = await fs.mkdtemp(path.join(prefix, ".install-"));
      await run(
        node,
        [
          npm,
          "install",
          "--global",
          "--prefix",
          stage,
          "--no-fund",
          "--no-audit",
          "--loglevel=error",
          ...lifecycle,
          tarball,
        ],
        env,
      );
      const stagedRoot = path.join(
        stage,
        process.platform === "win32" ? "node_modules/openclaw" : "lib/node_modules/openclaw",
      );
      requireDistribution(await readPackage(stagedRoot), manifest);
      for (const marker of [".openclaw-lifecycle-pending", "dist/openclaw-install-guard"]) {
        if (await exists(path.join(stagedRoot, marker))) {
          throw new Error(
            "Package lifecycle did not finish. Rerun installation after resolving the npm error.",
          );
        }
      }
      await run(node, [path.join(stagedRoot, "openclaw.mjs"), "--version"], env);
      await fs.mkdir(path.dirname(packageRoot), { recursive: true });
      await fs.rename(stagedRoot, packageRoot);
      activatedFreshPackage = true;
      await promoteNpmLaunchers(stage, prefix, promotedNpmLaunchers);
    }
    requireDistribution(await readPackage(packageRoot), manifest);
    await writeLaunchers(prefix);
  } catch (error) {
    if (activatedFreshPackage) {
      for (const launcher of promotedNpmLaunchers) {
        await fs.rm(launcher, { force: true });
      }
      if (!hadManagedLauncher) {
        await fs.rm(managedLauncher, { force: true });
      }
      await fs.rm(packageRoot, { recursive: true, force: true });
    }
    throw error;
  } finally {
    if (stage) {
      await fs.rm(stage, { recursive: true, force: true });
    }
    await fs.rmdir(lock);
  }
  console.log(`CypherClaw ${manifest.version} installed (${manifest.sourceCommit.slice(0, 12)}).`);
  console.log(
    `Launcher: ${path.join(prefix, "bin", process.platform === "win32" ? "cypherclaw.cmd" : "cypherclaw")}`,
  );
  await persistLauncherPath(prefix, env);
  if (!options.noOnboard && process.stdin.isTTY && process.stdout.isTTY) {
    await run(node, [path.join(packageRoot, "openclaw.mjs"), "onboard", "--install-daemon"], env);
  } else {
    console.log("Start interactive setup with: cypherclaw onboard --install-daemon");
  }
}

try {
  await main();
} catch (error) {
  console.error(`CypherClaw installation failed: ${error.message}`);
  process.exitCode = 1;
}
