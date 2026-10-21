import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { copyTreeCloseOnExec } from "../../test/helpers/close-on-exec-copy.js";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";

const tempDirs = useAutoCleanupTempDirTracker(afterEach);
const nativeStub = `#!/bin/bash
set -eu
args=("$@")
data_dir=
mode=start
while (( $# )); do
  case "$1" in
    --datadir) data_dir="$2"; shift ;;
    init) mode=init ;;
  esac
  shift
done
printf '%s\\0' "\${args[@]}" > "\${CYPHER_LAUNCH_TEST_DIR}/\${mode}.args"
if [[ "$mode" == init ]]; then
  mkdir -p "$data_dir/cypher/chaindata"
else
  exit "\${CYPHER_LAUNCH_TEST_NODE_EXIT:-0}"
fi
`;

function fixture(script: string, binary: string) {
  const directory = tempDirs.make("cypher-launcher-");
  const root = path.join(directory, "node package");
  fs.mkdirSync(path.join(root, "build", "bin"), { recursive: true });
  copyTreeCloseOnExec(
    fileURLToPath(new URL(`../../cypher/${script}`, import.meta.url)),
    path.join(root, script),
  );
  fs.writeFileSync(path.join(root, "genesis.json"), "{}\n");
  fs.writeFileSync(path.join(root, "build", "bin", binary), nativeStub, { mode: 0o755 });
  return {
    directory,
    root,
    launch(env: Record<string, string> = {}) {
      return spawnSync("/bin/bash", [path.join(root, script)], {
        cwd: directory,
        env: {
          PATH: process.env.PATH ?? "/usr/bin:/bin",
          HOME: directory,
          CYPHER_LAUNCH_TEST_DIR: directory,
          ...env,
        },
        encoding: "utf8",
      });
    },
    argumentsFor(mode: "init" | "start") {
      const bytes = fs.readFileSync(path.join(directory, `${mode}.args`), "utf8");
      expect(bytes.endsWith("\0")).toBe(true);
      return bytes.slice(0, -1).split("\0");
    },
  };
}

function expectFlag(args: string[], flag: string, value: string) {
  const index = args.indexOf(flag);
  expect(index, `${flag} is present`).toBeGreaterThanOrEqual(0);
  expect(args[index + 1]).toBe(value);
}

describe.skipIf(process.platform !== "linux" && process.platform !== "darwin")(
  "Unix ColossusX launchers",
  () => {
    describe.each([
      ["Linux", "colossusX_linux.sh", "cypher-linux-amd64"],
      ["macOS", "colossusX_mac.sh", "cypher-darwin-arm64"],
    ])("%s", (_platform, script, binary) => {
      it.each(["absolute", "relative", "relative IPC directory", "default"] as const)(
        "uses %s data and IPC paths for initialization and startup",
        (kind) => {
          const node = fixture(script, binary);
          const absoluteDataDir = path.join(node.directory, "persistent chain data");
          const absoluteIpcPath = path.join(node.directory, "native socket.ipc");
          const dataDir = kind === "absolute" ? absoluteDataDir : "relative chain";
          const ipcPath =
            kind === "absolute"
              ? absoluteIpcPath
              : kind === "relative IPC directory"
                ? "run/custom socket.ipc"
                : "custom socket.ipc";
          const env: Record<string, string> =
            kind === "default" ? {} : { CYPHER_DATADIR: dataDir, CYPHER_IPC_PATH: ipcPath };
          const expectedDataDir =
            kind === "absolute"
              ? absoluteDataDir
              : path.join(node.root, kind === "default" ? "chaindbname" : "relative chain");

          const result = node.launch(env);
          expect(result.error).toBeUndefined();
          expect(result.status, result.stderr).toBe(0);
          const initArgs = node.argumentsFor("init");
          const startArgs = node.argumentsFor("start");
          expectFlag(initArgs, "--datadir", kind === "default" ? "chaindbname" : dataDir);
          expect(initArgs).toContain("init");
          expect(initArgs).not.toContain("--ipcpath");
          expectFlag(startArgs, "--datadir", kind === "default" ? "chaindbname" : dataDir);
          if (kind === "default") {
            expect(startArgs).not.toContain("--ipcpath");
          } else {
            expectFlag(startArgs, "--ipcpath", ipcPath);
            expect(fs.existsSync(path.join(node.root, "chaindbname"))).toBe(false);
          }
          expect(startArgs.at(-1)).toBe("console");
          expect(startArgs.filter((arg) => arg.startsWith("--browser.public-relay"))).toEqual([]);
          const peers = path.join(expectedDataDir, "cypher");
          expect(fs.statSync(path.join(peers, "chaindata")).isDirectory()).toBe(true);
          const staticPeers = fs.readFileSync(path.join(peers, "static-nodes.json"), "utf8");
          expect(JSON.parse(staticPeers).length).toBeGreaterThan(0);
          expect(fs.readFileSync(path.join(peers, "trusted-nodes.json"), "utf8")).toBe(staticPeers);
        },
      );

      it("reuses existing chain and peer files and returns the native node exit code", () => {
        const node = fixture(script, binary);
        const dataDir = path.join(node.directory, "existing chain");
        const peers = path.join(dataDir, "cypher");
        fs.mkdirSync(path.join(peers, "chaindata"), { recursive: true });
        fs.writeFileSync(path.join(peers, "chaindata", "marker"), "existing chain bytes\n");
        fs.writeFileSync(path.join(peers, "static-nodes.json"), '["existing static peer"]\n');
        fs.writeFileSync(path.join(peers, "trusted-nodes.json"), '["existing trusted peer"]\n');

        const result = node.launch({
          CYPHER_DATADIR: dataDir,
          CYPHER_IPC_PATH: "existing socket.ipc",
          CYPHER_LAUNCH_TEST_NODE_EXIT: "23",
        });
        expect(result.error).toBeUndefined();
        expect(result.status, result.stderr).toBe(23);
        expect(fs.existsSync(path.join(node.directory, "init.args"))).toBe(false);
        const startArgs = node.argumentsFor("start");
        expectFlag(startArgs, "--datadir", dataDir);
        expectFlag(startArgs, "--ipcpath", "existing socket.ipc");
        expect(startArgs.filter((arg) => arg.startsWith("--browser.public-relay"))).toEqual([]);
        expect(fs.readFileSync(path.join(peers, "chaindata", "marker"), "utf8")).toBe(
          "existing chain bytes\n",
        );
        expect(fs.readFileSync(path.join(peers, "static-nodes.json"), "utf8")).toBe(
          '["existing static peer"]\n',
        );
        expect(fs.readFileSync(path.join(peers, "trusted-nodes.json"), "utf8")).toBe(
          '["existing trusted peer"]\n',
        );
      });
    });
  },
);
