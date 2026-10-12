import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { userInfo } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isRecord } from "../packages/normalization-core/src/record-coerce.ts";
import {
  verifyReleaseDirectory,
  assertExpectedIdentities,
} from "./cypherclaw-release-validation.mjs";
import type { LaneState } from "./lib/cross-os-release-checks/config.ts";
import { waitForInstalledGateway } from "./lib/cross-os-release-checks/installed.ts";
import {
  resolveDashboardAssetUrls,
  verifyDashboardAssetUrls,
} from "./lib/cross-os-release-checks/network-smokes.ts";
import {
  canConnectToLoopbackPort,
  reserveGatewayPortForLane,
  runCommand,
} from "./lib/cross-os-release-checks/process.ts";

type Release = Awaited<ReturnType<typeof verifyReleaseDirectory>>;
type BuildInfo = { commit: string; version: string; buildId: string };
type History = { sessionId: string; messages: unknown[] };
type Probe = {
  targets: Array<{
    url: string;
    connect: { ok: boolean };
    server?: { version: string; buildId: string };
  }>;
};
type UpdateResult = {
  status: string;
  reason?: string;
  runId: string;
  run?: { runId: string };
  after: { version: string };
};
type ServiceStatus = { service: { loaded: boolean; runtime?: { status?: string; pid?: number } } };
const timeoutMs = 60 * 60 * 1000;
const argv = new Map<string, string>();
for (let index = 2; index < process.argv.length; index += 2) {
  const name = process.argv[index];
  const value = process.argv[index + 1];
  assert(
    name && ["--candidate-dir", "--baseline-dir", "--output-dir", "--target"].includes(name),
    "Unknown acceptance argument",
  );
  assert(value && !value.startsWith("--") && !argv.has(name), `Missing or repeated ${name}`);
  argv.set(name, value);
}
function argument(name: string) {
  const value = argv.get(name);
  assert(value, `Missing ${name}`);
  return value;
}
const target = argument("--target");
const home = fs.realpathSync.native(userInfo().homedir);
const state = path.join(home, ".openclaw-cypherclaw");
const candidateDir = path.resolve(argument("--candidate-dir"));
const baselineDir = path.resolve(argument("--baseline-dir"));
const outputDir = path.resolve(argument("--output-dir"));
assert(
  !fs.existsSync(outputDir) || fs.readdirSync(outputDir).length === 0,
  "Use an empty proof directory",
);
fs.mkdirSync(outputDir, { recursive: true, mode: 0o700 });
let candidate: Release;
let baseline: Release;
let phase = "runner-admission";
const env: NodeJS.ProcessEnv = {};
const inherited = new Set([
  "PATH",
  "HOME",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  "SYSTEMROOT",
  "WINDIR",
  "COMSPEC",
  "PATHEXT",
  "USER",
  "LOGNAME",
  "TMP",
  "TEMP",
  "TMPDIR",
  "XDG_RUNTIME_DIR",
  "DBUS_SESSION_BUS_ADDRESS",
  "LANG",
  "LC_ALL",
]);
for (const [key, value] of Object.entries(process.env)) {
  if (inherited.has(key.toUpperCase())) {
    env[key] = value;
  }
}
Object.assign(env, {
  OPENCLAW_PROFILE: "cypherclaw",
  OPENCLAW_DISABLE_BONJOUR: "1",
  CI: "1",
  OPENCLAW_NO_PROMPT: "1",
  OPENCLAW_NO_ONBOARD: "1",
});
const ownership = randomUUID();
const marker = path.join(state, ".cypherclaw-release-test-owner");
let sequence = 0;
function readRecord(filename: string) {
  const value: unknown = JSON.parse(fs.readFileSync(filename, "utf8"));
  assert(isRecord(value), "Expected an installed JSON object");
  return value;
}
function packageRoot(prefix: string) {
  return path.join(
    prefix,
    ...(process.platform === "win32" ? [] : ["lib"]),
    "node_modules",
    "openclaw",
  );
}
function launcher(prefix: string) {
  return path.join(prefix, "bin", process.platform === "win32" ? "cypherclaw.cmd" : "cypherclaw");
}
function privateNode(prefix: string) {
  return path.join(
    prefix,
    "tools",
    "node",
    ...(process.platform === "win32" ? ["node.exe"] : ["bin", "node"]),
  );
}
async function command(
  prefix: string,
  args: string[],
  check = true,
  limit = timeoutMs,
  selectedEnv = env,
) {
  return runCommand(launcher(prefix), args, {
    env: selectedEnv,
    cwd: home,
    logPath: path.join(outputDir, `${++sequence}-command.log`),
    timeoutMs: limit,
    check,
  });
}
async function json<T>(prefix: string, args: string[]): Promise<T> {
  return JSON.parse((await command(prefix, args)).stdout) as T;
}
function assertOwnership() {
  assert(
    fs.lstatSync(state).isDirectory() && !fs.lstatSync(state).isSymbolicLink(),
    "Test state directory changed",
  );
  assert.equal(fs.readFileSync(marker, "utf8"), ownership, "Test state ownership changed");
}
async function install(directory: string, prefix: string) {
  assert(!fs.existsSync(prefix), "Fresh installation prefix already exists");
  const win = process.platform === "win32";
  await runCommand(
    win ? "powershell.exe" : "/bin/bash",
    win
      ? [
          "-NoLogo",
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          path.join(directory, "install.ps1"),
          "-ReleaseDir",
          directory,
          "-Prefix",
          prefix,
          "-NoOnboard",
        ]
      : [
          path.join(directory, "install.sh"),
          "--release-dir",
          directory,
          "--prefix",
          prefix,
          "--no-onboard",
        ],
    { env, cwd: home, logPath: path.join(outputDir, `${++sequence}-installer.log`), timeoutMs },
  );
}
function installedIdentity(prefix: string, release: Release): BuildInfo {
  const root = packageRoot(prefix);
  const pkg = readRecord(path.join(root, "package.json"));
  assert(isRecord(pkg.openclaw) && isRecord(pkg.openclaw.distribution));
  const distribution = pkg.openclaw.distribution;
  assert.equal(pkg.name, "openclaw");
  assert.equal(pkg.version, release.version);
  assert.equal(distribution.repository, "CypherTroopers/cypherclaw");
  assert.equal(distribution.releaseTag, release.releaseTag);
  assert.equal(distribution.sourceCommit, release.sourceCommit);
  const build = readRecord(path.join(root, "dist", "build-info.json"));
  assert(typeof build.commit === "string" && typeof build.version === "string");
  assert.equal(build.commit, release.sourceCommit);
  assert.equal(build.version, release.version);
  assert(typeof build.buildId === "string" && build.buildId.length > 0, "Missing build identity");
  return { commit: build.commit, version: build.version, buildId: build.buildId };
}
async function status(prefix: string) {
  return json<ServiceStatus>(prefix, ["gateway", "status", "--json", "--no-probe"]);
}
async function rpc<T>(prefix: string, token: string, method: string, params: object = {}) {
  const result = await command(
    prefix,
    ["gateway", "call", method, "--params", JSON.stringify(params), "--json"],
    true,
    timeoutMs,
    { ...env, OPENCLAW_GATEWAY_TOKEN: token },
  );
  return JSON.parse(result.stdout) as T;
}
async function probe(prefix: string, token: string) {
  const result = await command(prefix, ["gateway", "probe", "--json"], true, timeoutMs, {
    ...env,
    OPENCLAW_GATEWAY_TOKEN: token,
  });
  return JSON.parse(result.stdout) as Probe;
}
async function serving(prefix: string, release: Release, token: string, port: number) {
  const build = installedIdentity(prefix, release);
  await waitForInstalledGateway({
    lane,
    cliPath: launcher(prefix),
    env,
    logPath: path.join(outputDir, `${++sequence}-readiness.log`),
  });
  const reported = await status(prefix);
  assert.equal(reported.service.loaded, true, "Managed service is not installed");
  assert.equal(reported.service.runtime?.status, "running", "Managed service is not running");
  const targetResult = (await probe(prefix, token)).targets.find(
    (entry) => entry.url === `ws://127.0.0.1:${port}`,
  );
  assert.equal(targetResult?.connect.ok, true, "Authenticated RPC did not connect");
  assert.equal(targetResult.server?.version, release.version);
  assert.equal(targetResult.server?.buildId, build.buildId);
  const refused = await command(prefix, ["gateway", "probe", "--json"], false, timeoutMs, {
    ...env,
    OPENCLAW_GATEWAY_TOKEN: `wrong-${token}`,
  });
  const denied = (JSON.parse(refused.stdout) as Probe).targets.find(
    (entry) => entry.url === `ws://127.0.0.1:${port}`,
  );
  assert.equal(denied?.connect.ok, false, "Incorrect token connected to Gateway");
  const url = `http://127.0.0.1:${port}/`;
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  assert.equal(response.status, 200, "Control UI did not load");
  const html = await response.text();
  assert(
    html.includes("<title>CypherClaw Control</title>") &&
      html.includes("<openclaw-app></openclaw-app>"),
    "Control UI shell identity differs",
  );
  assert.equal(
    (await verifyDashboardAssetUrls(resolveDashboardAssetUrls(url, html))).ok,
    true,
    "Control UI assets did not load",
  );
}
async function configure(prefix: string, token: string, port: number) {
  fs.mkdirSync(state, { mode: 0o700 });
  fs.writeFileSync(marker, ownership, { mode: 0o600, flag: "wx" });
  assert.equal(
    (await status(prefix)).service.loaded,
    false,
    "Preexisting managed service refuses acceptance",
  );
  assertOwnership();
  fs.writeFileSync(
    path.join(state, "openclaw.json"),
    JSON.stringify({
      gateway: {
        mode: "local",
        port,
        bind: "loopback",
        auth: { mode: "token", token },
        reload: { mode: "off" },
        controlUi: { enabled: true },
      },
      agents: {
        defaults: { heartbeat: { every: "0m" } },
        entries: { main: { workspace: path.join(state, "workspace") } },
      },
      cron: { enabled: false },
      plugins: { enabled: false },
    }),
    { mode: 0o600, flag: "wx" },
  );
  await command(prefix, ["config", "validate", "--json"]);
  await command(prefix, ["gateway", "install", "--runtime", "node", "--json"]);
  await command(prefix, ["gateway", "start", "--json"]);
}
async function cleanup(prefix: string, port: number) {
  assertOwnership();
  await command(prefix, ["gateway", "stop", "--json"], true, 10 * 60 * 1000);
  const stopped = await status(prefix);
  assert.equal(stopped.service.runtime?.status, "stopped", "Managed Gateway stop is unverified");
  assert.equal(await canConnectToLoopbackPort(port), false, "Gateway listener survived stop");
  await command(prefix, ["gateway", "uninstall", "--json"]);
  assert.equal((await status(prefix)).service.loaded, false, "Managed service survived uninstall");
  assertOwnership();
  fs.rmSync(state, { recursive: true });
  assert(!fs.existsSync(state));
}
function configPreserved(token: string, port: number) {
  const config = readRecord(path.join(state, "openclaw.json"));
  assert(isRecord(config.gateway) && isRecord(config.cron) && isRecord(config.agents));
  const { gateway, cron, agents } = config;
  assert(isRecord(gateway.auth));
  assert(isRecord(agents.defaults) && isRecord(agents.defaults.heartbeat));
  assert.equal(gateway.auth.mode, "token");
  assert.equal(gateway.auth.token, token);
  assert.equal(gateway.port, port);
  assert.equal(gateway.bind, "loopback");
  assert.equal(cron.enabled, false);
  assert.equal(agents.defaults.heartbeat.every, "0m");
}
async function databaseIntegrity(prefix: string, release: Release, sessionId: string) {
  const helper = pathToFileURL(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "lib/sqlite-transcript-payload.mjs"),
  ).href;
  const script = `import assert from 'node:assert/strict'; import { DatabaseSync } from 'node:sqlite'; import { createHash } from 'node:crypto';
const [state, globalVersion, agentVersion, sessionId, helper] = process.argv.slice(1);
const { readSqliteTranscriptPayload, sqliteTranscriptPayloadColumns } = await import(helper);
let events;
for (const [filename, role, version] of [[state + '/state/openclaw.sqlite','global',globalVersion],[state + '/agents/main/agent/openclaw-agent.sqlite','agent',agentVersion]]) {
  const db = new DatabaseSync(filename,{readOnly:true});
  try { assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
    const meta = db.prepare("SELECT role,schema_version FROM schema_meta WHERE meta_key='primary'").get();
    assert.equal(meta.role,role); assert.equal(meta.schema_version,Number(version));
    if (role === 'agent') {
      const rows = db.prepare('SELECT seq,' + sqliteTranscriptPayloadColumns(db) + ' FROM transcript_events WHERE session_id=? ORDER BY seq,rowid').all(sessionId);
      assert(rows.length > 0, 'Session transcript is missing');
      events = rows.map(row => ({ seq: row.seq, sha256: createHash('sha256').update(readSqliteTranscriptPayload(row)).digest('hex') }));
    }
  } finally { db.close(); }
}
console.log(JSON.stringify(events));`;
  const result = await runCommand(
    privateNode(prefix),
    [
      "--input-type=module",
      "-e",
      script,
      state,
      String(release.package.schemaVersions.state),
      String(release.package.schemaVersions.agent),
      sessionId,
      helper,
    ],
    {
      env,
      cwd: home,
      logPath: path.join(outputDir, `${++sequence}-sqlite.log`),
      timeoutMs: 2 * 60 * 1000,
    },
  );
  return JSON.parse(result.stdout) as Array<{ seq: number; sha256: string }>;
}
const lane: LaneState = {
  name: "cypherclaw-app",
  rootDir: outputDir,
  prefixDir: "",
  homeDir: home,
  stateDir: state,
  appDataDir: env.APPDATA || state,
  gatewayPort: 0,
  phaseTimings: [],
};
async function cell(prefix: string, directory: string, release: Release, upgrade: boolean) {
  const cellName = upgrade ? "upgrade" : "fresh";
  phase = `${cellName}.install`;
  await install(directory, prefix);
  installedIdentity(prefix, release);
  const reservation = await reserveGatewayPortForLane(lane);
  const token = `cypherclaw-release-fixture-${randomUUID()}`;
  try {
    await reservation.release();
    phase = `${cellName}.managed-gateway`;
    await configure(prefix, token, lane.gatewayPort);
    await serving(prefix, release, token, lane.gatewayPort);
    phase = `${cellName}.session-fixture`;
    const key = `agent:main:release-${randomUUID()}`;
    const created = await rpc<{ ok: boolean; key: string; sessionId: string; runStarted: boolean }>(
      prefix,
      token,
      "sessions.create",
      { key, agentId: "main", label: "release preservation fixture" },
    );
    assert.equal(created.ok, true);
    assert.equal(created.runStarted, false);
    assert.equal(created.key, key);
    const text = "release upgrade preserves this conversation π 雪";
    const injected = await rpc<{ ok: boolean; messageId: string }>(prefix, token, "chat.inject", {
      sessionKey: key,
      agentId: "main",
      message: text,
    });
    assert.equal(injected.ok, true);
    assert(injected.messageId);
    const before = await rpc<History>(prefix, token, "chat.history", {
      sessionKey: key,
      agentId: "main",
      limit: 20,
    });
    assert.equal(before.sessionId, created.sessionId);
    assert(JSON.stringify(before.messages).includes(text));
    const transcriptBefore = await databaseIntegrity(prefix, release, created.sessionId);
    let updateRunId: string | undefined;
    if (upgrade) {
      phase = "upgrade.installed-updater";
      const updated = await json<UpdateResult>(prefix, [
        "update",
        "--tag",
        path.join(candidateDir, "cypherclaw.tgz"),
        "--yes",
        "--json",
      ]);
      assert.equal(
        updated.status,
        "ok",
        "Installed updater did not complete the selected transition",
      );
      assert.equal(updated.after.version, candidate.version);
      assert(typeof updated.runId === "string" && updated.runId.length > 0);
      if (updated.run) {
        assert.equal(updated.runId, updated.run.runId);
      }
      const recorded = await json<{
        lastRun: { runId: string; status: string; phase: string; reason?: string };
      }>(prefix, ["update", "status", "--json"]);
      assert.equal(recorded.lastRun.runId, updated.runId);
      assert.equal(recorded.lastRun.status, "succeeded");
      assert.equal(recorded.lastRun.phase, "finished");
      updateRunId = updated.runId;
      phase = "upgrade.serving-candidate";
      await serving(prefix, candidate, token, lane.gatewayPort);
    }
    configPreserved(token, lane.gatewayPort);
    const after = await rpc<History>(prefix, token, "chat.history", {
      sessionKey: key,
      agentId: "main",
      limit: 20,
    });
    assert.equal(after.sessionId, before.sessionId, "Session identity changed during upgrade");
    assert.deepEqual(after.messages, before.messages, "Session history changed during upgrade");
    assert.deepEqual(
      await databaseIntegrity(prefix, upgrade ? candidate : release, created.sessionId),
      transcriptBefore,
      "Persisted transcript bytes changed during upgrade",
    );
    const appended = await rpc<{ ok: boolean; messageId: string }>(prefix, token, "chat.inject", {
      sessionKey: key,
      agentId: "main",
      message: "candidate can append after upgrade",
    });
    assert.equal(appended.ok, true);
    assert(appended.messageId);
    const usable = await rpc<History>(prefix, token, "chat.history", {
      sessionKey: key,
      agentId: "main",
      limit: 20,
    });
    assert.equal(usable.sessionId, created.sessionId);
    assert(JSON.stringify(usable.messages).includes(appended.messageId));
    await databaseIntegrity(prefix, upgrade ? candidate : release, created.sessionId);
    phase = `${cellName}.cleanup`;
    await cleanup(prefix, lane.gatewayPort);
    return updateRunId;
  } finally {
    await reservation.release();
  }
}
try {
  assert.equal(target, `${process.platform}-${process.arch}`, "Runner does not match target");
  assert(["linux-x64", "darwin-arm64", "win32-x64"].includes(target));
  assert.equal(
    process.env.GITHUB_ACTIONS,
    "true",
    "Acceptance requires a disposable GitHub Actions runner",
  );
  assert.equal(
    fs.realpathSync.native(process.env.HOME || process.env.USERPROFILE || ""),
    home,
    "Account HOME must remain canonical",
  );
  assert(!fs.existsSync(state), "Preexisting CypherClaw state refuses acceptance");
  phase = "sealed-artifact-validation";
  candidate = await verifyReleaseDirectory(candidateDir);
  baseline = await verifyReleaseDirectory(baselineDir);
  assertExpectedIdentities(candidate, baseline, process.env);
  await cell(path.join(outputDir, "fresh-prefix"), candidateDir, candidate, false);
  const updateRunId = await cell(
    path.join(outputDir, "upgrade-prefix"),
    baselineDir,
    baseline,
    true,
  );
  phase = "final-artifact-validation";
  const sealedCandidate = await verifyReleaseDirectory(candidateDir);
  const sealedBaseline = await verifyReleaseDirectory(baselineDir);
  assertExpectedIdentities(sealedCandidate, sealedBaseline, process.env);
  assert.equal(sealedCandidate.package.sha256, candidate.package.sha256);
  const identity = (release: Release) => ({
    releaseTag: release.releaseTag,
    sourceCommit: release.sourceCommit,
    packageSha256: release.package.sha256,
    manifestSha256: release.manifestSha256,
  });
  fs.writeFileSync(
    path.join(outputDir, "receipt.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        target,
        status: "passed",
        baseline: identity(baseline),
        candidate: identity(candidate),
        updateRunId,
        checks: {
          freshInstall: true,
          managedGateway: true,
          installedUpdater: true,
          servingIdentity: true,
          configPreserved: true,
          authentication: true,
          sessionPreserved: true,
          databaseIntegrity: true,
          controlUi: true,
          cleanup: true,
        },
        limitations: [
          "No model-provider inference or external-channel roundtrip",
          "Plugins disabled in the synthetic operator fixture",
          "Control UI shell and asset retrieval; no browser interaction or native desktop application proof",
          "No Cypher native-node operations",
        ],
      },
      null,
      2,
    )}\n`,
    { mode: 0o600, flag: "wx" },
  );
  console.log(`CypherClaw application acceptance passed for ${target}.`);
} catch (error) {
  fs.writeFileSync(
    path.join(outputDir, "receipt.json"),
    `${JSON.stringify({ schemaVersion: 1, target, status: "failed", phase, errorCategory: error instanceof assert.AssertionError ? "contract-check" : "execution" }, null, 2)}\n`,
    { mode: 0o600, flag: "wx" },
  );
  console.error(
    `CypherClaw application acceptance failed during ${phase}; private state and logs remain on the disposable runner.`,
  );
  process.exitCode = 1;
}
