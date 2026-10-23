#!/usr/bin/env node

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout } from "node:timers/promises";
import { fileURLToPath } from "node:url";

// The release asset sits beside its contract; the source entry uses scripts/lib.
const contractPath =
  path.basename(fileURLToPath(import.meta.url)) === "install-runtime.mjs"
    ? "./cypherclaw-contract.mjs"
    : "./lib/cypherclaw-contract.mjs";
const {
  CYPHERCLAW_SUPPORTED_NODE_RANGE,
  isSupportedCypherClawNodeVersion,
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
        reject(
          Object.assign(new Error(`${path.basename(command)} failed (${code ?? signal}).`), {
            stdout: output,
          }),
        );
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

async function runJson(node, cli, args, env) {
  const reportWarnings = (result) => {
    for (const warning of result.warnings ?? []) {
      console.warn(warning);
    }
  };
  let output;
  try {
    output = await run(node, [cli, ...args, "--json"], env, true);
  } catch (error) {
    try {
      const result = JSON.parse(error.stdout);
      reportWarnings(result);
      if (result.error) {
        console.warn(result.error);
      }
    } catch {
      // The child already reported non-JSON diagnostics on stderr.
    }
    throw error;
  }
  const result = JSON.parse(output);
  reportWarnings(result);
  return result;
}

async function readInstalledIdentity(root, manifest) {
  const [packageBytes, buildBytes] = await Promise.all([
    fs.readFile(path.join(root, "package.json")),
    fs.readFile(path.join(root, "dist", "build-info.json")),
  ]);
  const pkg = JSON.parse(packageBytes);
  const build = JSON.parse(buildBytes);
  requireDistribution(pkg, manifest, false);
  if (
    build.version !== pkg.version ||
    build.commit !== pkg.openclaw.distribution.sourceCommit ||
    typeof build.buildId !== "string" ||
    !build.buildId
  ) {
    throw new Error("Installed CypherClaw build identity could not be verified.");
  }
  return { pkg, build, packageBytes, buildBytes };
}

async function assertInstalledIdentity(root, manifest, original) {
  const current = await readInstalledIdentity(root, manifest);
  if (
    !current.packageBytes.equals(original.packageBytes) ||
    !current.buildBytes.equals(original.buildBytes)
  ) {
    throw new Error("The installed package changed; runtime recovery was not attempted.");
  }
}

async function inspectMigrationService(node, cli, env, root, original, port) {
  const status = await runJson(
    node,
    cli,
    ["gateway", "status", "--deep", "--timeout", "30000"],
    env,
  );
  const { service, config, gateway } = status;
  const intent = service?.runtimeIntent;
  if (
    service?.targetRole !== "target" ||
    service.loaded !== true ||
    service.loadState?.status !== "loaded" ||
    service.inspectionReason ||
    service.launcherOverridden !== false ||
    (process.platform === "linux" && service.definitionMutation !== "writable") ||
    intent?.status !== "known" ||
    intent.stored !== false ||
    intent.pin !== undefined ||
    typeof intent.revision !== "string" ||
    typeof intent.definition !== "string" ||
    service.layout?.entrypointSourceCheckout !== false ||
    service.layout.packageVersion !== original.pkg.version ||
    !service.layout.packageRootReal ||
    config?.cli?.valid !== true ||
    config?.daemon?.valid !== true ||
    config.mismatch === true ||
    config.cli.path !== config.daemon.path ||
    !Number.isInteger(gateway?.port) ||
    gateway.port < 1 ||
    gateway.port > 65535 ||
    (port !== undefined && gateway.port !== port) ||
    (await fs.realpath(service.layout.packageRootReal)) !== (await fs.realpath(root))
  ) {
    throw new Error(
      "The original managed Gateway, context, or unpinned runtime could not be verified. Inspect cypherclaw gateway status --deep before selecting its runtime manually.",
    );
  }
  const executable = service.command?.programArguments?.[0];
  if (!executable || !path.isAbsolute(executable) || path.basename(executable) !== "node") {
    throw new Error("The selected Gateway does not expose a direct Node executable.");
  }
  return {
    status,
    node: await fs.realpath(executable),
    port: gateway.port,
  };
}

async function assertMigrationAutoStart(service, env) {
  if (process.platform !== "darwin") {
    return;
  }
  // Published status exposes launchd registration, but omits its enabled override.
  // Project the selected owner's read-only fact using launchd-runtime.ts semantics.
  const source = service.command?.sourcePath;
  if (
    !source ||
    !path.isAbsolute(source) ||
    !source.endsWith(".plist") ||
    (await fs.realpath(source)) !== service.layout?.sourcePathReal
  ) {
    throw new Error("The selected LaunchAgent definition could not be verified.");
  }
  const label = path.basename(source, ".plist");
  const output = await run(
    "/bin/launchctl",
    ["print-disabled", `gui/${os.userInfo().uid}`],
    env,
    true,
  );
  for (const line of output.split("\n")) {
    const entry = line.trim();
    const prefix = `"${label}"`;
    if (!entry.startsWith(prefix)) {
      continue;
    }
    const state = entry.slice(prefix.length).trim();
    if (state === "=> enabled" || state === "=> false") {
      return;
    }
    if (state === "=> disabled" || state === "=> true") {
      throw new Error(
        "The LaunchAgent is disabled for automatic startup. Its selection was preserved; enable it intentionally before retrying the runtime migration.",
      );
    }
    throw new Error("The LaunchAgent enabled state could not be verified.");
  }
  // No persisted override leaves the plist's normal startup policy in effect.
}

function isOriginalGatewayHealthy(status, original) {
  return (
    status.service.runtime?.status === "running" &&
    status.rpc?.ok === true &&
    status.rpc.server?.version === original.pkg.version &&
    status.rpc.server?.buildId === original.build.buildId
  );
}

async function installMigrationRuntime(node, cli, env, service) {
  await assertMigrationAutoStart(service.status.service, env);
  // The published owner routes OPENCLAW_UPDATE_IN_PROGRESS through definition
  // reconciliation and treats --expected-runtime-pin as a running-state fence.
  // That combination exited before the updater recorded a run. The same
  // unpinned --runtime node install that created the service does not store a pin.
  const result = await runJson(
    node,
    cli,
    ["gateway", "install", "--runtime", "node", "--force", "--port", String(service.port)],
    env,
  );
  if (result.ok !== true) {
    throw new Error("The installed service owner did not confirm runtime installation.");
  }
}

async function waitForMigrationService(
  node,
  cli,
  env,
  root,
  manifest,
  original,
  expectedNode,
  port,
) {
  // Service installation confirms publication before startup; allow slow hosts
  // the same five-minute scale as managed lifecycle admission before recovery.
  const deadline = Date.now() + 5 * 60 * 1000;
  while (true) {
    try {
      const observed = await inspectMigrationService(node, cli, env, root, original, port);
      if (observed.node !== expectedNode) {
        throw new Error("The managed Gateway runtime changed during recovery.");
      }
      if (isOriginalGatewayHealthy(observed.status, original)) {
        const health = await runJson(
          node,
          cli,
          ["gateway", "call", "health", "--timeout", "30000"],
          env,
        );
        if (health.ok !== true) {
          throw new Error("The original Gateway health check failed after runtime selection.");
        }
        await assertInstalledIdentity(root, manifest, original);
        return observed;
      }
    } catch (error) {
      // A wrong published executable is not a restart race. Status and health
      // can fail while systemd or launchd is still activating the new command.
      if (error?.message === "The managed Gateway runtime changed during recovery.") {
        throw error;
      }
    }
    if (Date.now() >= deadline) {
      throw new Error("The original Gateway did not become healthy after runtime selection.");
    }
    await setTimeout(1000);
  }
}

function isVersionedPrivateNodeExecutable(executable) {
  return /[/\\]tools[/\\]node-v\d+\.\d+\.\d+[/\\]bin[/\\]node$/.test(executable);
}

async function refreshManagedRuntime(node, cli, env, root, manifest, original, service) {
  const currentNode = await fs.realpath(node);
  try {
    await installMigrationRuntime(node, cli, env, service);
    await waitForMigrationService(
      node,
      cli,
      env,
      root,
      manifest,
      original,
      currentNode,
      service.port,
    );
  } catch (refreshError) {
    try {
      await assertInstalledIdentity(root, manifest, original);
      const current = await inspectMigrationService(node, cli, env, root, original, service.port);
      if (current.node !== service.node) {
        if (current.node !== currentNode) {
          throw new Error("Another runtime selection was observed; it was preserved.", {
            cause: refreshError,
          });
        }
        await installMigrationRuntime(service.node, cli, env, current);
      }
      await waitForMigrationService(
        service.node,
        cli,
        env,
        root,
        manifest,
        original,
        service.node,
        service.port,
      );
      console.warn(
        "Runtime refresh failed; the original Gateway and unpinned runtime were restored.",
      );
    } catch (recoveryError) {
      throw new AggregateError(
        [refreshError, recoveryError],
        "Runtime refresh recovery could not be verified. Service-owner backups were retained; inspect cypherclaw gateway status --deep and the preceding owner diagnostics before retrying.",
        { cause: recoveryError },
      );
    }
    throw refreshError;
  }
}

async function alignManagedRuntimeBeforeUpdate(node, cli, env, root, manifest, original) {
  if (!original || !["linux", "darwin"].includes(process.platform)) {
    return;
  }
  let service;
  try {
    service = await inspectMigrationService(node, cli, env, root, original);
  } catch (error) {
    console.warn(`The installed updater will run without a runtime switch: ${error.message}`);
    return;
  }
  if (!isOriginalGatewayHealthy(service.status, original)) {
    console.warn(
      "The managed Gateway is not the healthy original install. Its runtime was left unchanged.",
    );
    return;
  }
  const currentNode = await fs.realpath(node);
  if (service.node === currentNode) {
    return;
  }
  const oldVersion = await run(service.node, ["--version"], env, true);
  if (!/^v\d+\.\d+\.\d+$/.test(oldVersion)) {
    throw new Error(
      "The managed Gateway Node version could not be read. Inspect cypherclaw gateway status --deep before retrying.",
    );
  }
  // The published updater selects the service executable. A local tarball has
  // no candidate engine and records no target version, so a retry after
  // target-native-unsupported never starts. Point the service at this Node first.
  console.warn(
    `The managed Gateway is still using Node ${oldVersion.slice(1)}. Selecting private Node ${manifest.nodeVersion} before the installed updater runs.`,
  );
  await refreshManagedRuntime(node, cli, env, root, manifest, original, service);
}

async function publishStableServiceNode(node, cli, env) {
  if (!["linux", "darwin"].includes(process.platform)) {
    return;
  }
  let status;
  try {
    status = await runJson(node, cli, ["gateway", "status", "--deep", "--timeout", "30000"], env);
  } catch (error) {
    console.warn(`The managed service was left unchanged after the update: ${error.message}`);
    return;
  }
  const executable = status.service?.command?.programArguments?.[0];
  const intent = status.service?.runtimeIntent;
  const port = status.gateway?.port;
  if (
    !executable ||
    !isVersionedPrivateNodeExecutable(executable) ||
    intent?.stored !== false ||
    intent?.pin !== undefined ||
    !Number.isInteger(port)
  ) {
    return;
  }
  const currentNode = await fs.realpath(node);
  if ((await fs.realpath(executable)) !== currentNode) {
    return;
  }
  // The previous service owner stored process.execPath, which is the versioned
  // directory. The updated owner maps that same file to the tools/node alias.
  console.warn(
    "Publishing the managed Gateway command on the version-independent private Node path.",
  );
  const result = await runJson(
    node,
    cli,
    ["gateway", "install", "--runtime", "node", "--force", "--port", String(port)],
    env,
  );
  if (result.ok !== true) {
    throw new Error("The installed service owner did not confirm runtime installation.");
  }
  const published = await runJson(
    node,
    cli,
    ["gateway", "status", "--deep", "--timeout", "30000"],
    env,
  );
  const publishedExecutable = published.service?.command?.programArguments?.[0];
  if (
    !publishedExecutable ||
    isVersionedPrivateNodeExecutable(publishedExecutable) ||
    (await fs.realpath(publishedExecutable)) !== currentNode
  ) {
    throw new Error(
      "The managed Gateway is still bound to a versioned private Node path. Inspect cypherclaw gateway status --deep before retrying.",
    );
  }
}

async function updateExistingInstallation(node, root, tarball, manifest, env) {
  const cli = path.join(root, "openclaw.mjs");
  // Missing old metadata must not prevent the installed updater's first attempt.
  const original = await readInstalledIdentity(root, manifest).catch(() => null);
  await alignManagedRuntimeBeforeUpdate(node, cli, env, root, manifest, original);
  await run(node, [cli, "update", "--tag", tarball, "--yes"], env);
  await publishStableServiceNode(node, cli, env);
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
  if (!isSupportedCypherClawNodeVersion(process.version)) {
    throw new Error(
      `Use a private Node that satisfies ${CYPHERCLAW_SUPPORTED_NODE_RANGE}, installed by install.sh or install.ps1.`,
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
      await updateExistingInstallation(node, packageRoot, tarball, manifest, env);
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
