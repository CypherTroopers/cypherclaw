import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const fixtures = vi.hoisted(() => ({
  node: "fixture node bytes\n",
  wallet: "fixture wallet bytes\n",
}));
vi.mock("./pins.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("./pins.js")>();
  const { createHash } = await import("node:crypto");
  const artifact = (name: string, bytes: string) => ({
    path: name,
    bytes: Buffer.byteLength(bytes),
    sha256: createHash("sha256").update(bytes).digest("hex"),
    executable: true,
  });
  return {
    ...original,
    NODE_ARTIFACTS: { "linux-amd64": [artifact("build/bin/cypher-linux-amd64", fixtures.node)] },
    WALLET_ARTIFACTS: {
      "linux-amd64": [artifact("bin/linux-amd64/coldwalletgenerator", fixtures.wallet)],
      "linux-arm64": [artifact("bin/linux-arm64/coldwalletgenerator", fixtures.wallet)],
    },
  };
});
import { NativeInstaller } from "./installer.js";

const nativeFetch = globalThis.fetch;
let server: http.Server;
let origin: string;
let directory: string;
let packageRoot: string;
let stateDir: string;
let installer: NativeInstaller;
let requests: string[];
let serve: (url: string, response: http.ServerResponse) => void;

beforeAll(async () => {
  server = http.createServer((request, response) => {
    const url = request.url ?? "";
    requests.push(url);
    serve(url, response);
  });
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    server.once("error", onError);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", onError);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fixture did not listen");
  origin = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => {
  if (!server.listening) return;
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});
beforeEach(async () => {
  // openclaw-temp-dir: allow standalone plugin fixture verifies installation and cleanup without importing core internals.
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "cypher-native-install-"));
  packageRoot = path.join(directory, "package");
  stateDir = path.join(directory, "state");
  const assets: Record<string, string> = {
    "cypher/colossusX_linux.sh": "#!/bin/sh\nexit 0\n",
    "cypher/genesis.json": "{}\n",
    "cypher/config/browser-relay/common-mine.json": "{}\n",
    "cypher/licenses/LICENSE": "fixture node license\n",
    "native/browser-relay.sh": "# fixture relay\n",
    "native/wallet-build-info/linux-amd64.json": '{"historical":true}\n',
    "native/wallet-build-info/linux-arm64.json": '{"historical":true}\n',
    "wallet-generator/LICENSE": "fixture wallet license\n",
    "wallet-generator/THIRD_PARTY_NOTICES.md": "fixture notices\n",
    "wallet-generator/third-party-licenses/LICENSE": "fixture dependency license\n",
  };
  for (const [file, contents] of Object.entries(assets)) {
    const destination = path.join(packageRoot, "assets", file);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, contents);
  }
  requests = [];
  serve = (url, response) =>
    response.end(url.includes("coldwalletgenerator") ? fixtures.wallet : fixtures.node);
  vi.stubGlobal("fetch", (input: URL, init: RequestInit) =>
    nativeFetch(new URL(input.pathname, origin), init),
  );
  installer = new NativeInstaller({ packageRoot, stateDir, platform: "linux", arch: "x64" });
});
afterEach(async () => {
  await installer?.close();
  vi.unstubAllGlobals();
  if (directory) await fs.rm(directory, { recursive: true, force: true });
});

describe("native installation owner", () => {
  it("keeps construction and status read-only, then atomically prepares only the host's files", async () => {
    expect((await installer.status()).state).toBe("missing");
    expect(requests).toEqual([]);
    await expect(fs.stat(stateDir)).rejects.toMatchObject({ code: "ENOENT" });
    const chainFile = path.join(stateDir, "cypher", "chaindbname", "keystore", "existing");
    await fs.mkdir(path.dirname(chainFile), { recursive: true });
    await fs.writeFile(chainFile, "operator data");
    const result = await installer.prepare({ assertCurrent() {} });
    expect(result).toMatchObject({
      state: "ready",
      target: "linux-amd64",
      node: { ready: true },
      wallet: { ready: true },
    });
    expect(requests).toHaveLength(2);
    expect(
      requests.every((url) => url.includes("/linux-amd64/") || url.endsWith("cypher-linux-amd64")),
    ).toBe(true);
    expect(await fs.readFile(chainFile, "utf8")).toBe("operator data");
    expect(
      await fs.readFile(path.join(installer.walletRoot, "bin/linux-amd64/build-info.json"), "utf8"),
    ).toBe('{"historical":true}\n');
    expect(
      (await fs.stat(path.join(installer.nodeRoot, "build/bin/cypher-linux-amd64"))).mode & 0o111,
    ).not.toBe(0);
    expect(await fs.readdir(path.join(stateDir, "native"))).toEqual(
      expect.arrayContaining([
        path.basename(installer.nodeRoot),
        path.basename(installer.walletRoot),
      ]),
    );
    const restarted = new NativeInstaller({
      packageRoot,
      stateDir,
      platform: "linux",
      arch: "x64",
    });
    try {
      expect((await restarted.status()).state).toBe("ready");
      expect(requests).toHaveLength(2);
    } finally {
      await restarted.close();
    }
  });

  it("prepares the independent wallet on a host without a node build", async () => {
    installer = new NativeInstaller({ packageRoot, stateDir, platform: "linux", arch: "arm64" });
    expect((await installer.status()).node.supported).toBe(false);
    const result = await installer.prepare({ assertCurrent() {} });
    expect(result).toMatchObject({
      state: "ready",
      node: { supported: false, ready: false },
      wallet: { supported: true, ready: true },
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toContain("/bin/linux-arm64/coldwalletgenerator");
  });

  it("shares one preparation and exposes progress while the HTTP response is pending", async () => {
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    serve = (url, response) => {
      if (url.includes("cypher-linux")) {
        entered.resolve();
        void release.promise.then(() => response.end(fixtures.node));
      } else response.end(fixtures.wallet);
    };
    const first = installer.prepare({ assertCurrent() {} });
    const second = installer.prepare({ assertCurrent() {} });
    try {
      await entered.promise;
      expect(await installer.status()).toMatchObject({
        state: "preparing",
        progress: { completedFiles: 0, totalFiles: 2, downloadedBytes: 0 },
      });
    } finally {
      release.resolve();
    }
    await expect(first).resolves.toMatchObject({ state: "ready" });
    await expect(second).resolves.toMatchObject({ state: "ready" });
    expect(requests).toHaveLength(2);
  });

  it("preserves an existing installation when a corrupt replacement cannot be activated", async () => {
    await fs.mkdir(installer.nodeRoot, { recursive: true });
    await fs.writeFile(path.join(installer.nodeRoot, "operator-file"), "preserve me");
    serve = (_url, response) => response.end(Buffer.alloc(Buffer.byteLength(fixtures.node), 1));
    await expect(installer.prepare({ assertCurrent() {} })).rejects.toMatchObject({
      code: "integrity",
    });
    expect((await installer.status()).state).toBe("error");
    expect(await fs.readFile(path.join(installer.nodeRoot, "operator-file"), "utf8")).toBe(
      "preserve me",
    );
    expect(await fs.readdir(path.join(stateDir, "native"))).toEqual([
      path.basename(installer.nodeRoot),
    ]);
  });

  it("cleans only its staging files after authority changes during a download", async () => {
    let current = true;
    serve = (_url, response) => {
      current = false;
      response.end(fixtures.node);
    };
    await expect(
      installer.prepare({
        assertCurrent() {
          if (!current) throw new Error("revoked");
        },
      }),
    ).rejects.toMatchObject({ code: "authority" });
    expect((await installer.status()).error?.code).toBe("authority");
    expect(await fs.readdir(path.join(stateDir, "native"))).toEqual([]);
  });

  it("aborts a pending response and joins cleanup before service closure finishes", async () => {
    const entered = Promise.withResolvers<void>();
    serve = (_url, response) => {
      response.write(fixtures.node.slice(0, 4));
      entered.resolve();
    };
    const preparation = installer.prepare({ assertCurrent() {} });
    const rejected = expect(preparation).rejects.toMatchObject({ code: "closed" });
    await entered.promise;
    await installer.close();
    await rejected;
    expect(await fs.readdir(path.join(stateDir, "native"))).toEqual([]);
  });

  it("detects a modified executable during admission without downloading or executing it", async () => {
    await installer.prepare({ assertCurrent() {} });
    const binary = path.join(installer.walletRoot, "bin/linux-amd64/coldwalletgenerator");
    const original = await fs.readFile(binary);
    await fs.writeFile(binary, Buffer.alloc(original.length, 1));
    const restarted = new NativeInstaller({
      packageRoot,
      stateDir,
      platform: "linux",
      arch: "x64",
    });
    try {
      expect(await restarted.status()).toMatchObject({
        state: "missing",
        node: { ready: true },
        wallet: { ready: false },
      });
      expect(requests).toHaveLength(2);
    } finally {
      await restarted.close();
    }
  });

  it("repairs files changed after admission when setup is explicitly requested again", async () => {
    await installer.prepare({ assertCurrent() {} });
    const binary = path.join(installer.walletRoot, "bin/linux-amd64/coldwalletgenerator");
    await fs.unlink(binary);
    // Ordinary status retains owner-admitted facts and performs no file polling.
    expect((await installer.status()).wallet.ready).toBe(true);
    expect(requests).toHaveLength(2);
    await expect(installer.prepare({ assertCurrent() {} })).resolves.toMatchObject({
      state: "ready",
      wallet: { ready: true },
    });
    expect(await fs.readFile(binary, "utf8")).toBe(fixtures.wallet);
    expect(requests).toHaveLength(3);
    expect(requests[2]).toContain("coldwalletgenerator");
  });
});
