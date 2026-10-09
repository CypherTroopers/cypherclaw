import fs from "node:fs";
import path from "node:path";
import { beforeEach, expect, it, vi } from "vitest";
import { CYPHERCLAW_INSTALL_ASSETS } from "../../../scripts/lib/cypherclaw-contract.mjs";
import { normalizeUpdateChannel } from "../../infra/update-channels.js";
import * as packageMetadata from "../../infra/update-check-package-target.js";
import * as updateCheck from "../../infra/update-check.js";
import { defaultRuntime, ExitError } from "../../runtime.js";
import { invokeUpdateCli } from "../update-cli-invocation.test-support.js";
import { installFreshUpdateFixture } from "./update-command-fresh.test-support.js";
import * as packageUpdate from "./update-command-package.js";
import * as pluginPreflight from "./update-command-plugin-preflight.js";
import * as commandRun from "./update-command-run.js";

const { fixture, dirs } = installFreshUpdateFixture();
const sourceCommit = "a".repeat(40);
const releaseTag = `cypherclaw-v2026.9.4-${sourceCommit.slice(0, 12)}`;
const distribution = {
  id: "cypherclaw",
  repository: "CypherTroopers/cypherclaw",
  channel: "stable",
  sourceBranch: "cypherclaw-stable",
  sourceCommit,
  releaseTag,
};
const release = {
  ...distribution,
  schemaVersion: 1,
  version: "2026.9.4",
  nodeVersion: "24.21.0",
  package: {
    file: "cypherclaw.tgz",
    name: "openclaw",
    sha256: "b".repeat(64),
    bytes: 123,
    nodeEngine: ">=24.16.0 <25 || >=26.1.0",
    schemaVersions: { state: 19, agent: 24 },
  },
  assets: CYPHERCLAW_INSTALL_ASSETS.map((file) => ({ file, sha256: "c".repeat(64), bytes: 1 })),
  supportedTargets: ["linux-x64", "darwin-arm64", "win32-x64"],
  publication: { ready: true, limitations: [] },
};

beforeEach(() => {
  vi.spyOn(defaultRuntime, "exit").mockImplementation((code) => {
    throw new ExitError(code);
  });
  vi.spyOn(pluginPreflight, "preflightConfiguredNpmPluginTargets").mockResolvedValue([]);
  fs.writeFileSync(
    path.join(fixture.root, "package.json"),
    JSON.stringify({ name: "openclaw", version: "2026.9.3", openclaw: { distribution } }),
  );
  const prepare = vi.mocked(commandRun.prepareUpdateCommand).getMockImplementation()!;
  vi.mocked(commandRun.prepareUpdateCommand).mockImplementation(async (opts) => ({
    ...(await prepare(opts)),
    requestedChannel: normalizeUpdateChannel(opts.channel),
  }));
});

it.each([undefined, releaseTag])(
  "previews a fork release through the registered update command (selector=%s) without npm or fresh-state writes",
  async (tag) => {
    const urls: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      urls.push(url);
      if (url.endsWith("/releases/latest")) {
        return Response.json({ tag_name: releaseTag });
      }
      if (url.endsWith(`/${releaseTag}/cypherclaw-release.json`)) {
        return Response.json(release);
      }
      throw new Error(`Unexpected update request: ${url}`);
    });
    await invokeUpdateCli({ tag, dryRun: true, json: true, restart: false });
    expect(defaultRuntime.writeJson).toHaveBeenCalledWith(
      expect.objectContaining({
        dryRun: true,
        effectiveChannel: "stable",
        targetVersion: "2026.9.4",
        tag: `https://github.com/CypherTroopers/cypherclaw/releases/download/${releaseTag}/cypherclaw.tgz`,
        switchToGit: false,
      }),
    );
    expect(urls).toEqual([
      ...(tag ? [] : ["https://api.github.com/repos/CypherTroopers/cypherclaw/releases/latest"]),
      `https://github.com/CypherTroopers/cypherclaw/releases/download/${releaseTag}/cypherclaw-release.json`,
    ]);
    expect(updateCheck.resolveNpmChannelTag).not.toHaveBeenCalled();
    expect(packageMetadata.fetchNpmPackageTargetStatus).not.toHaveBeenCalled();
    expect(packageUpdate.stagePackageInstallUpdate).not.toHaveBeenCalled();
    expect(fs.existsSync(fixture.databasePath)).toBe(false);
  },
);

it.each(["dev", "beta", "extended-stable"])(
  "refuses upstream channel %s before release lookup or staging",
  async (channel) => {
    const fetchRelease = vi.spyOn(globalThis, "fetch");
    await expect(invokeUpdateCli({ channel, dryRun: true, json: true })).rejects.toMatchObject({
      code: 1,
    });
    expect(defaultRuntime.writeJson).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "unsupported-cypherclaw-channel" }),
    );
    expect(fetchRelease).not.toHaveBeenCalled();
    expect(packageUpdate.stagePackageInstallUpdate).not.toHaveBeenCalled();
    expect(fs.existsSync(fixture.databasePath)).toBe(false);
  },
);

it.each([false, true])(
  "selects distribution policy from the admitted service root (fork=%s)",
  async (forkSelected) => {
    const selectedRoot = dirs.make("update-selected-distribution-");
    fs.writeFileSync(
      path.join(selectedRoot, "package.json"),
      JSON.stringify({
        name: "openclaw",
        version: "2026.9.3",
        ...(forkSelected ? { openclaw: { distribution } } : {}),
      }),
    );
    if (forkSelected) {
      fs.writeFileSync(
        path.join(fixture.root, "package.json"),
        JSON.stringify({ name: "openclaw", version: "2026.9.3" }),
      );
    }
    const prepare = vi.mocked(commandRun.prepareUpdateCommand).getMockImplementation()!;
    vi.mocked(commandRun.prepareUpdateCommand).mockImplementation(async (opts) => ({
      ...(await prepare(opts)),
      servicePlan: { rootRedirect: { root: selectedRoot, previousRoot: fixture.root } },
    }));
    const fetchRelease = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith("/releases/latest")) {
        return Response.json({ tag_name: releaseTag });
      }
      return Response.json(release);
    });
    await invokeUpdateCli({ dryRun: true, json: true, restart: false });
    expect(defaultRuntime.writeJson).toHaveBeenCalledWith(
      expect.objectContaining({
        root: selectedRoot,
        targetVersion: forkSelected ? "2026.9.4" : "2026.9.2",
      }),
    );
    expect(updateCheck.resolveNpmChannelTag).toHaveBeenCalledTimes(forkSelected ? 0 : 1);
    expect(fetchRelease).toHaveBeenCalledTimes(forkSelected ? 2 : 0);
  },
);
