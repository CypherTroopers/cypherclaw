import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runNodeScript } from "../helpers/run-node-script.js";
import { useAutoCleanupTempDirTracker } from "../helpers/temp-dir.js";

const tempDirs = useAutoCleanupTempDirTracker(afterAll);
const BUILDER = "scripts/build-cypherclaw-release.mjs";
const SOURCE_ARCHIVE = "cypher-source-60b8164-with-go-dependencies.tar.gz";
const NATIVE_FILES = [
  "cypher-linux-amd64",
  "cypher-darwin-arm64",
  "cypher.exe",
  "libcrypto-3-x64.dll",
  "libgcc_s_seh-1.dll",
  "libgmp-10.dll",
  "libstdc++-6.dll",
  "libwinpthread-1.dll",
];

function writeFixtureFile(root: string, relative: string, content: string): void {
  const filename = path.join(root, relative);
  mkdirSync(path.dirname(filename), { recursive: true });
  writeFileSync(filename, content);
}

describe("CypherClaw release builder CLI", () => {
  let root: string;
  let sourceCommit: string;
  let fixtureEnv: NodeJS.ProcessEnv;

  beforeAll(() => {
    root = tempDirs.make("cypherclaw-release-builder-");
    fixtureEnv = {
      ...process.env,
      GIT_CONFIG_GLOBAL: path.join(root, "empty-git-config"),
      GIT_CONFIG_NOSYSTEM: "1",
    };
    for (const relative of [
      BUILDER,
      "scripts/lib/arg-utils.runtime.mjs",
      "scripts/lib/output-root-guard.mjs",
      "scripts/lib/cypherclaw-contract.mjs",
    ]) {
      writeFixtureFile(root, relative, readFileSync(path.resolve(relative), "utf8"));
    }
    mkdirSync(path.join(root, "node_modules"));
    symlinkSync(
      realpathSync(path.resolve("node_modules/tar")),
      path.join(root, "node_modules/tar"),
      process.platform === "win32" ? "junction" : "dir",
    );
    writeFixtureFile(root, ".gitignore", "node_modules/\noutput/\nstaging/\n");
    writeFixtureFile(root, "source-marker.txt", "selected source\n");
    writeFixtureFile(
      root,
      "package.json",
      JSON.stringify({
        name: "openclaw",
        version: "2026.9.9",
        type: "module",
        engines: { node: ">=24.21.0" },
        openclaw: { schemaVersions: { state: 19, agent: 19 } },
      }),
    );
    const nativeFiles = new Map([
      ...NATIVE_FILES.map((name) => [`build/bin/${name}`, `harmless fixture ${name}\n`] as const),
      ["BUILDINFO.txt", "Body-owned node build record\n"],
      ["licenses/GPL-3.0.txt", "Synthetic license fixture\n"],
      ["licenses/LGPL-3.0.txt", "Synthetic library license fixture\n"],
      ["provenance/linux-amd64/manifest.txt", "Synthetic Linux build provenance\n"],
      ["provenance/darwin-arm64/manifest.txt", "Synthetic macOS build provenance\n"],
      ["provenance/windows-amd64/manifest.txt", "Synthetic Windows build provenance\n"],
      [SOURCE_ARCHIVE, "Synthetic source archive bytes\n"],
    ]);
    for (const [relative, content] of nativeFiles) {
      writeFixtureFile(root, `cypher/${relative}`, content);
    }
    writeFixtureFile(
      root,
      "cypher/SHA256SUMS",
      [...nativeFiles]
        .map(
          ([relative, content]) =>
            `${createHash("sha256").update(content).digest("hex")}  ${relative}\n`,
        )
        .join(""),
    );
    writeFixtureFile(root, "cypher/config/browser-relay/common-mine.json", "{}\n");
    for (const relative of [
      "scripts/install-cypherclaw.sh",
      "scripts/install-cypherclaw.ps1",
      "scripts/install-cli.sh",
      "scripts/install.ps1",
      "scripts/install-cypherclaw.mjs",
    ]) {
      writeFixtureFile(root, relative, "Synthetic installer asset\n");
    }
    // Only expensive build/import validation children are fixtures. The builder
    // still owns Git admission, tar repacking, native hashes, and release sealing.
    writeFixtureFile(
      root,
      "scripts/package-openclaw-for-docker.mjs",
      String.raw`import fs from "node:fs";
import path from "node:path";
import { create as createTar } from "tar";
const args = process.argv.slice(2);
const output = args[args.indexOf("--output-dir") + 1];
const name = args[args.indexOf("--output-name") + 1];
const stage = path.resolve("staging", path.basename(output));
const pkg = path.join(stage, "package");
fs.mkdirSync(path.join(pkg, "dist/control-ui"), { recursive: true });
fs.copyFileSync("package.json", path.join(pkg, "package.json"));
fs.cpSync("cypher", path.join(pkg, "cypher"), { recursive: true });
fs.writeFileSync(path.join(pkg, "dist/control-ui/index.html"), "<!doctype html>fixture");
fs.writeFileSync(path.join(pkg, "dist/build-info.json"), JSON.stringify({
  commit: process.env.GIT_COMMIT,
  version: JSON.parse(fs.readFileSync("package.json", "utf8")).version,
}));
createTar({ cwd: stage, file: path.join(output, name), gzip: true, portable: true, sync: true }, ["package"]);
if (process.env.CYPHERCLAW_FIXTURE_MUTATE_SOURCE === "1") {
  fs.writeFileSync("source-marker.txt", "changed during packing\n");
}
`,
    );
    writeFixtureFile(
      root,
      "scripts/check-openclaw-package-tarball.mjs",
      "// Heavy import checker fixture.\n",
    );
    const git = (...args: string[]) =>
      execFileSync("git", args, { cwd: root, env: fixtureEnv, encoding: "utf8" }).trim();
    git("init", "--quiet");
    git("add", ".");
    git(
      "-c",
      "user.name=Release Fixture",
      "-c",
      "user.email=release-fixture@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "-c",
      `core.hooksPath=${path.join(root, "disabled-hooks")}`,
      "commit",
      "--quiet",
      "-m",
      "Synthetic release source",
    );
    sourceCommit = git("rev-parse", "HEAD");
    git("update-ref", "refs/remotes/origin/cypherclaw-stable", sourceCommit);
  });

  it.for([
    { mode: "production", args: [], ready: true, limitations: [] },
    {
      mode: "candidate",
      args: ["--candidate"],
      ready: false,
      limitations: [expect.stringContaining("Local candidate proof")],
    },
  ])(
    "seals $mode readiness without a standalone plugin",
    async ({ mode, args, ready, limitations }, { signal }) => {
      const output = path.join(root, "output", mode);
      const prepared = await runNodeScript(
        [BUILDER, "--source-sha", sourceCommit, "--output-dir", output, ...args],
        fixtureEnv,
        undefined,
        { cwd: root, signal },
      );
      expect(prepared.error, prepared.stderr).toBeUndefined();
      expect(prepared.status, prepared.stderr).toBe(0);
      expect(
        JSON.parse(readFileSync(path.join(output, "cypherclaw-release.json"), "utf8")).publication,
      ).toEqual({ ready, limitations });
      const checked = await runNodeScript(
        [BUILDER, "--check", "--output-dir", output],
        fixtureEnv,
        undefined,
        { cwd: root, signal },
      );
      expect(checked.error, checked.stderr).toBeUndefined();
      expect(checked.status, checked.stderr).toBe(0);
    },
  );

  it("rejects a source change during packing before granting publication readiness", async ({
    signal,
  }) => {
    const output = path.join(root, "output", "source-changed");
    try {
      const prepared = await runNodeScript(
        [BUILDER, "--source-sha", sourceCommit, "--output-dir", output],
        { ...fixtureEnv, CYPHERCLAW_FIXTURE_MUTATE_SOURCE: "1" },
        undefined,
        { cwd: root, signal },
      );
      expect(prepared.error, prepared.stderr).toBeUndefined();
      expect(prepared.status).toBe(1);
      expect(prepared.stderr).toContain("source checkout changed during release preparation");
      expect(existsSync(path.join(output, "cypherclaw.tgz"))).toBe(true);
      expect(existsSync(path.join(output, "cypherclaw-release.json"))).toBe(false);
      expect(existsSync(path.join(output, "SHA256SUMS"))).toBe(false);
    } finally {
      writeFixtureFile(root, "source-marker.txt", "selected source\n");
    }
  });

  it("requires the body source archive even when its checksum row is omitted", async ({
    signal,
  }) => {
    const output = path.join(root, "output", "source-missing");
    const archive = path.join(root, "cypher", SOURCE_ARCHIVE);
    const archiveBytes = readFileSync(archive);
    const checksumFile = path.join(root, "cypher/SHA256SUMS");
    const checksums = readFileSync(checksumFile, "utf8");
    try {
      unlinkSync(archive);
      writeFileSync(
        checksumFile,
        checksums
          .split("\n")
          .filter((line) => !line.endsWith(`  ${SOURCE_ARCHIVE}`))
          .join("\n"),
      );
      const prepared = await runNodeScript(
        [BUILDER, "--source-sha", sourceCommit, "--output-dir", output, "--candidate"],
        fixtureEnv,
        undefined,
        { cwd: root, signal },
      );
      expect(prepared.error, prepared.stderr).toBeUndefined();
      expect(prepared.status).toBe(1);
      expect(prepared.stderr).toContain(`cypher/${SOURCE_ARCHIVE}`);
      expect(existsSync(path.join(output, "cypherclaw-release.json"))).toBe(false);
      expect(existsSync(path.join(output, "SHA256SUMS"))).toBe(false);
    } finally {
      writeFileSync(archive, archiveBytes);
      writeFileSync(checksumFile, checksums);
    }
  });
});
