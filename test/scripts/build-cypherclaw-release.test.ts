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
import { create as createTar, extract as extractTar } from "tar";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runNodeScript } from "../helpers/run-node-script.js";
import { useAutoCleanupTempDirTracker } from "../helpers/temp-dir.js";

const tempDirs = useAutoCleanupTempDirTracker(afterAll);
const BUILDER = "scripts/build-cypherclaw-release.mjs";
const SOURCE_ARCHIVE = "cypher-source-60b8164-with-go-dependencies.tar.gz";
const NATIVE_SOURCE = "a".repeat(40);
const NATIVE_TARGETS = ["linux-amd64", "darwin-arm64", "windows-amd64"];
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

function fixtureHash(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

function resealFixturePackage(output: string): void {
  const manifestPath = path.join(output, "cypherclaw-release.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const tarball = readFileSync(path.join(output, manifest.package.file));
  manifest.package.sha256 = fixtureHash(tarball);
  manifest.package.bytes = tarball.length;
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const entries = [
    manifest.package,
    ...manifest.assets,
    { file: "cypherclaw-release.json", sha256: fixtureHash(readFileSync(manifestPath)) },
  ];
  writeFileSync(
    path.join(output, "SHA256SUMS"),
    entries
      .toSorted((a, b) => a.file.localeCompare(b.file))
      .map(({ file, sha256 }) => `${sha256}  ${file}\n`)
      .join(""),
  );
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
      "scripts/lib/cypherclaw-native-overlay.mjs",
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
      [SOURCE_ARCHIVE, "Synthetic source archive bytes\n"],
    ]);
    const patch = "Synthetic finality patch bytes\n";
    nativeFiles.set("patches/transaction-finality-ipc.patch", patch);
    nativeFiles.set("patches/README.md", "Synthetic finality build instructions\n");
    nativeFiles.set("patches/build-finality-node.sh", "# Synthetic build wrapper\n");
    nativeFiles.set(
      "patches/transaction-finality-source.json",
      JSON.stringify({
        baseCommit: NATIVE_SOURCE,
        patch: "transaction-finality-ipc.patch",
        patchSha256: fixtureHash(patch),
        method: "eth_getTransactionFinality",
        transport: "ipc",
        result: "boolean",
        targets: NATIVE_TARGETS,
        baseSourceArchive: {
          file: SOURCE_ARCHIVE,
          sha256: fixtureHash(nativeFiles.get(SOURCE_ARCHIVE)!),
        },
      }),
    );
    for (const target of NATIVE_TARGETS) {
      const binary = target === "windows-amd64" ? "cypher.exe" : `cypher-${target}`;
      const [goos, goarch] = target.split("-");
      nativeFiles.set(
        `provenance/${target}/manifest.txt`,
        [
          `source_sha=${NATIVE_SOURCE}`,
          `source_patch_sha256=${fixtureHash(patch)}`,
          "ipc_transaction_finality_method=eth_getTransactionFinality",
          `binary=${binary}`,
          `binary_sha256=${fixtureHash(nativeFiles.get(`build/bin/${binary}`)!)}`,
          `goos=${goos}`,
          `goarch=${goarch}`,
          "go_version=go1.26.2",
          "build_tags=cypher_bounded_storage",
          "herumi_ref=synthetic-herumi-pin",
          "leveldb_module=synthetic-leveldb-module",
          "leveldb_version=synthetic-leveldb-version",
          "leveldb_module_sum=synthetic-leveldb-sum",
          "leveldb_patch_sha256=synthetic-leveldb-patch",
          `bls_sha256=${"b".repeat(64)}`,
          `mcl_sha256=${"c".repeat(64)}`,
          "",
        ].join("\n"),
      );
      nativeFiles.set(
        `provenance/${target}/SHA256SUMS`,
        `${fixtureHash(nativeFiles.get(`build/bin/${binary}`)!)}  ${binary}\n`,
      );
      nativeFiles.set(`provenance/${target}/go-build-info.txt`, "Historical fixture metadata\n");
    }
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

  function nativeArtifacts(mutate?: (files: Map<string, string>, target: string) => void): string {
    const directory = tempDirs.make("cypherclaw-native-fixture-");
    for (const target of NATIVE_TARGETS) {
      const binary = target === "windows-amd64" ? "cypher.exe" : `cypher-${target}`;
      const [goos, goarch] = target.split("-");
      const content = `Rebuilt harmless fixture ${target}\n`;
      const files = new Map([
        [binary, content],
        [
          "manifest.txt",
          readFileSync(
            path.join(root, "cypher/provenance", target, "manifest.txt"),
            "utf8",
          ).replace(/^binary_sha256=.*$/mu, `binary_sha256=${fixtureHash(content)}`),
        ],
        [
          "go-build-info.txt",
          [
            `${binary}: go1.26.2`,
            `\tbuild\tGOOS=${goos}`,
            `\tbuild\tGOARCH=${goarch}`,
            "\tbuild\tCGO_ENABLED=1",
            "\tbuild\t-tags=cypher_bounded_storage",
            "",
          ].join("\n"),
        ],
      ]);
      if (goos === "windows") {
        for (const dll of NATIVE_FILES.filter((file) => file.endsWith(".dll"))) {
          files.set(dll, readFileSync(path.join(root, "cypher/build/bin", dll), "utf8"));
        }
      }
      mutate?.(files, target);
      for (const [file, bytes] of files) {
        writeFixtureFile(directory, `${target}/${file}`, bytes);
      }
      writeFixtureFile(
        directory,
        `${target}/SHA256SUMS`,
        [...files].map(([file, bytes]) => `${fixtureHash(bytes)}  ${file}\n`).join(""),
      );
    }
    return directory;
  }

  it("packages all native builds without changing the clean reviewed source", async ({
    signal,
  }) => {
    const artifacts = nativeArtifacts();
    const originalBinary = readFileSync(path.join(root, "cypher/build/bin/cypher-linux-amd64"));
    const originalLedger = readFileSync(path.join(root, "cypher/SHA256SUMS"));
    const output = path.join(root, "output", "native-overlay");
    const prepared = await runNodeScript(
      [
        BUILDER,
        "--source-sha",
        sourceCommit,
        "--output-dir",
        output,
        "--native-artifacts-dir",
        artifacts,
      ],
      fixtureEnv,
      undefined,
      { cwd: root, signal },
    );
    expect(prepared.status, prepared.stderr).toBe(0);
    expect(
      JSON.parse(readFileSync(path.join(output, "cypherclaw-release.json"), "utf8")).publication
        .ready,
    ).toBe(true);
    const stage = path.join(root, "staging/native-overlay-check");
    mkdirSync(stage);
    extractTar({ file: path.join(output, "cypherclaw.tgz"), cwd: stage, strict: true, sync: true });
    for (const target of NATIVE_TARGETS) {
      const binary = target === "windows-amd64" ? "cypher.exe" : `cypher-${target}`;
      expect(readFileSync(path.join(stage, "package/cypher/build/bin", binary), "utf8")).toBe(
        `Rebuilt harmless fixture ${target}\n`,
      );
    }
    expect(readFileSync(path.join(root, "cypher/build/bin/cypher-linux-amd64"))).toEqual(
      originalBinary,
    );
    expect(readFileSync(path.join(root, "cypher/SHA256SUMS"))).toEqual(originalLedger);
    expect(
      execFileSync("git", ["status", "--porcelain"], {
        cwd: root,
        env: fixtureEnv,
        encoding: "utf8",
      }),
    ).toBe("");
    const checked = await runNodeScript(
      [BUILDER, "--check", "--output-dir", output],
      fixtureEnv,
      undefined,
      { cwd: root, signal },
    );
    expect(checked.status, checked.stderr).toBe(0);
  });

  it.for([
    {
      defect: "mixed source",
      target: "darwin-arm64",
      file: "manifest.txt",
      expected: "binding mismatch",
      change: (text: string) => text.replace(/^source_sha=.*$/mu, `source_sha=${"d".repeat(40)}`),
    },
    {
      defect: "changed DLL",
      target: "windows-amd64",
      file: "libgmp-10.dll",
      expected: "pinned package provenance",
      change: () => "Different runtime bytes\n",
    },
  ])(
    "refuses $defect before granting native release readiness",
    async ({ target, file, change, expected, defect }, { signal }) => {
      const artifacts = nativeArtifacts((files, current) => {
        if (current === target) {
          files.set(file, change(files.get(file)!));
        }
      });
      const output = path.join(root, "output", defect.replaceAll(" ", "-"));
      const prepared = await runNodeScript(
        [
          BUILDER,
          "--source-sha",
          sourceCommit,
          "--output-dir",
          output,
          "--native-artifacts-dir",
          artifacts,
        ],
        fixtureEnv,
        undefined,
        { cwd: root, signal },
      );
      expect(prepared.status).toBe(1);
      expect(prepared.stderr).toContain(expected);
      expect(existsSync(path.join(output, "cypherclaw-release.json"))).toBe(false);
      expect(
        execFileSync("git", ["status", "--porcelain"], {
          cwd: root,
          env: fixtureEnv,
          encoding: "utf8",
        }),
      ).toBe("");
    },
  );

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

  it.for([
    { target: "linux-amd64", key: "source_sha", value: "b".repeat(40) },
    { target: "darwin-arm64", key: "source_patch_sha256", value: "c".repeat(64) },
    {
      target: "windows-amd64",
      key: "ipc_transaction_finality_method",
      value: "eth_getTransactionReceipt",
    },
  ])(
    "rejects resealed publishable bytes with mismatched $target $key",
    async ({ target, key, value }, { signal }) => {
      const output = path.join(root, "output", `native-mismatch-${target}`);
      const prepared = await runNodeScript(
        [BUILDER, "--source-sha", sourceCommit, "--output-dir", output],
        fixtureEnv,
        undefined,
        { cwd: root, signal },
      );
      expect(prepared.status, prepared.stderr).toBe(0);
      const stage = path.join(root, "staging", `native-mismatch-${target}`);
      mkdirSync(stage, { recursive: true });
      const tarball = path.join(output, "cypherclaw.tgz");
      extractTar({ file: tarball, cwd: stage, strict: true, sync: true });
      const cypherRoot = path.join(stage, "package", "cypher");
      const relative = `provenance/${target}/manifest.txt`;
      const changed = readFileSync(path.join(cypherRoot, relative), "utf8").replace(
        new RegExp(`^${key}=.*$`, "mu"),
        `${key}=${value}`,
      );
      writeFileSync(path.join(cypherRoot, relative), changed);
      const ledger = path.join(cypherRoot, "SHA256SUMS");
      writeFileSync(
        ledger,
        readFileSync(ledger, "utf8")
          .split("\n")
          .map((line) =>
            line.endsWith(`  ${relative}`) ? `${fixtureHash(changed)}  ${relative}` : line,
          )
          .join("\n"),
      );
      createTar({ cwd: stage, file: tarball, gzip: true, portable: true, sync: true }, ["package"]);
      resealFixturePackage(output);
      const checked = await runNodeScript(
        [BUILDER, "--check", "--output-dir", output],
        fixtureEnv,
        undefined,
        { cwd: root, signal },
      );
      expect(checked.status).toBe(1);
      expect(checked.stderr).toContain(
        "publication requires patched native binaries on all targets",
      );
      expect(checked.stderr).toContain(target);
    },
  );

  it("keeps old native binaries available only as an explicitly limited candidate", async ({
    signal,
  }) => {
    const ledger = path.join(root, "cypher/SHA256SUMS");
    const checksums = readFileSync(ledger, "utf8");
    const originals = NATIVE_TARGETS.map((target) => {
      const relative = `provenance/${target}/manifest.txt`;
      return { relative, bytes: readFileSync(path.join(root, "cypher", relative), "utf8") };
    });
    try {
      let changedChecksums = checksums;
      for (const original of originals) {
        const content = original.bytes.replace(
          /^source_patch_sha256=.*\n|^ipc_transaction_finality_method=.*\n/gmu,
          "",
        );
        writeFixtureFile(root, `cypher/${original.relative}`, content);
        changedChecksums = changedChecksums
          .split("\n")
          .map((line) =>
            line.endsWith(`  ${original.relative}`)
              ? `${fixtureHash(content)}  ${original.relative}`
              : line,
          )
          .join("\n");
      }
      writeFileSync(ledger, changedChecksums);
      const output = path.join(root, "output", "old-native-candidate");
      const prepared = await runNodeScript(
        [BUILDER, "--source-sha", sourceCommit, "--output-dir", output, "--candidate"],
        fixtureEnv,
        undefined,
        { cwd: root, signal },
      );
      expect(prepared.status, prepared.stderr).toBe(0);
      const publication = JSON.parse(
        readFileSync(path.join(output, "cypherclaw-release.json"), "utf8"),
      ).publication;
      expect(publication.ready).toBe(false);
      for (const target of NATIVE_TARGETS) {
        expect(publication.limitations).toContain(
          `Bundled ${target} node provenance does not bind the transaction finality patch.`,
        );
      }
    } finally {
      for (const original of originals) {
        writeFixtureFile(root, `cypher/${original.relative}`, original.bytes);
      }
      writeFileSync(ledger, checksums);
    }
  });
});
