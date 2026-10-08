import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callCypherIpc, CypherIpcError, type CypherRpcMethod } from "./ipc.js";
import { CypherNodeManager, type CypherAuthority, type CypherProcess } from "./manager.js";

const childProcessMock = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: childProcessMock.spawn }));

const A = `0x${"1".repeat(40)}`;
const B = `0x${"2".repeat(40)}`;
const GENESIS = `0x${"a".repeat(64)}`;
const authority: CypherAuthority = { assertCurrent: () => {} };
type Options = NonNullable<ConstructorParameters<typeof CypherNodeManager>[0]>;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

class FakeProcess implements CypherProcess {
  pid = 123;
  exited = false;
  dataListener: (data: string) => void = () => {};
  exitListener: (code: number | null) => void = () => {};
  interrupt = vi.fn(() => {
    this.exit(0);
  });
  onData(listener: (data: string) => void) {
    this.dataListener = listener;
  }
  onExit(listener: (code: number | null) => void) {
    this.exitListener = listener;
  }
  exit(code: number | null) {
    this.exited = true;
    this.exitListener(code);
  }
}

describe("Cypher node owner", () => {
  const fixtures: Array<{ manager: CypherNodeManager; process: FakeProcess }> = [];

  function fixture(options: Partial<Options> = {}) {
    const process = new FakeProcess();
    const values: Partial<Record<CypherRpcMethod, unknown>> = {
      web3_clientVersion: "Cypher/test",
      eth_chainId: "0x9a24df",
      eth_blockNumber: "0x10",
      net_peerCount: "0x2",
      eth_mining: false,
      eth_hashrate: "0x0",
      eth_accounts: [A],
      eth_coinbase: A,
      miner_start: "Mining started",
      miner_setEtherbase: true,
      personal_newAccount: A,
      personal_unlockAccount: true,
      personal_lockAccount: true,
      personal_getCommonRPCRewardAddress: {
        configured: true,
        signer: A,
        rewardRecipient: B,
        chainId: "0x9a24df",
        genesisHash: GENESIS,
      },
    };
    const rpc = vi.fn<typeof callCypherIpc>();
    rpc.mockImplementation(async (_endpoint, method, _params, callOptions) => {
      callOptions?.assertCurrent?.();
      if (options.platform === "win32" && process.exited) {
        throw new CypherIpcError("IPC endpoint absent.", "ENOENT");
      }
      return values[method];
    });
    const launch = vi.fn<NonNullable<Options["launch"]>>(async (launchOptions) => {
      launchOptions.assertCurrent();
      return process;
    });
    const preflight = vi.fn(async () => {});
    const endpointExists = vi.fn(async () => false);
    const manager = new CypherNodeManager({
      assetDir: "/bundled/cypher",
      stateDir: "/state",
      platform: "linux",
      arch: "x64",
      rootDir: "/bundled/cypher",
      rpc,
      launch,
      preflight,
      endpointExists,
      stopTimeoutMs: 50,
      ...options,
    });
    fixtures.push({ manager, process });
    return { manager, process, rpc, values, launch, preflight, endpointExists };
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubEnv("CYPHER_ROOT", undefined);
    vi.stubEnv("CYPHER_DATADIR", "/state/chaindbname");
  });
  afterEach(async () => {
    for (const entry of fixtures.splice(0)) {
      if (!entry.process.exited) {
        entry.process.exit(0);
      }
      await entry.manager.close().catch(() => {});
    }
    vi.restoreAllMocks();
    childProcessMock.spawn.mockReset();
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("preserves node log lines while removing terminal and binary controls", async () => {
    const { manager, process } = fixture();
    await manager.start(authority);
    process.dataListener(
      "\u001b[31mfirst\u001b[0m\tline\r\n\u001b]0;title\u0007second\u0000\u0085\n",
    );
    await expect(manager.status()).resolves.toMatchObject({ logs: ["first\tline", "second"] });
  });

  it.each([
    [
      "linux",
      "x64",
      "/bundled/cypher",
      "/bundled/cypher/chaindbname",
      "cypher-linux-amd64",
      "colossusX_linux.sh",
      "/bundled/cypher/chaindbname/cypher.ipc",
    ],
    [
      "darwin",
      "arm64",
      "/bundled/cypher",
      "/bundled/cypher/chaindbname",
      "cypher-darwin-arm64",
      "colossusX_mac.sh",
      "/bundled/cypher/chaindbname/cypher.ipc",
    ],
    [
      "win32",
      "x64",
      "C:\\bundled\\cypher",
      "C:\\bundled\\cypher\\chaindbname",
      "cypher.exe",
      "colossusX_windows.ps1",
      "\\\\.\\pipe\\cypher.ipc",
    ],
  ])(
    "launches the supplied %s/%s script without replacing inherited node settings",
    async (platform, arch, rootDir, dataDir, binary, script, ipcPath) => {
      vi.stubEnv("CYPHER_DATADIR", undefined);
      vi.stubEnv("CYPHER_ROOT", rootDir);
      vi.stubEnv("CYPHER_IPC_PATH", undefined);
      vi.stubEnv("CYPHER_HEADLESS", "0");
      vi.stubEnv("CYPHER_BROWSER_RELAY", "0");
      vi.stubEnv("CYPHER_RPC_ENABLED", "0");
      vi.stubEnv("CYPHER_RPC_BIND", "127.0.0.1");
      vi.stubEnv("CYPHER_WS_BIND", "127.0.0.2");
      const { manager, launch, rpc } = fixture({ platform, arch, rootDir });
      const state = await manager.start(authority);
      expect(state).toMatchObject({
        state: "starting",
        owned: true,
        connected: false,
        dataDir,
        ipcPath,
      });
      expect(state.binaryPath).toContain(binary);
      expect(launch).toHaveBeenCalledWith(
        expect.objectContaining({
          platform,
          rootDir,
          script: expect.stringContaining(script),
          env: expect.objectContaining({
            CYPHER_HEADLESS: "0",
            CYPHER_BROWSER_RELAY: "0",
            CYPHER_RPC_ENABLED: "0",
            CYPHER_RPC_BIND: "127.0.0.1",
            CYPHER_WS_BIND: "127.0.0.2",
          }),
        }),
      );
      expect(launch.mock.calls[0]?.[0].env).not.toHaveProperty("CYPHER_DATADIR");
      expect(launch.mock.calls[0]?.[0].env).not.toHaveProperty("CYPHER_IPC_PATH");
      expect(rpc).not.toHaveBeenCalled();
    },
  );

  it("does not dial or launch at construction or initial status", async () => {
    const { manager, rpc, launch } = fixture();
    await expect(manager.status()).resolves.toMatchObject({
      state: "stopped",
      connected: false,
      owned: false,
    });
    expect(rpc).not.toHaveBeenCalled();
    expect(launch).not.toHaveBeenCalled();
  });

  it("keeps default chain data outside the replaceable plugin installation", async () => {
    vi.stubEnv("CYPHER_DATADIR", undefined);
    const { manager, launch } = fixture({ rootDir: undefined });
    await expect(manager.start(authority)).resolves.toMatchObject({
      rootDir: "/bundled/cypher",
      dataDir: "/state/cypher/chaindbname",
      ipcPath: "/state/cypher/chaindbname/cypher.ipc",
    });
    expect(launch.mock.calls[0]?.[0].env.CYPHER_DATADIR).toBe("/state/cypher/chaindbname");
  });

  it("preserves an existing CYPHER_ROOT and its relative chain data during migration", async () => {
    vi.stubEnv("CYPHER_ROOT", "/existing/cypher");
    vi.stubEnv("CYPHER_DATADIR", undefined);
    const { manager, launch } = fixture({ rootDir: undefined });
    await expect(manager.start(authority)).resolves.toMatchObject({
      rootDir: "/existing/cypher",
      dataDir: "/existing/cypher/chaindbname",
      ipcPath: "/existing/cypher/chaindbname/cypher.ipc",
    });
    expect(launch.mock.calls[0]?.[0].env).not.toHaveProperty("CYPHER_DATADIR");
  });

  it("refuses unsupported architectures", async () => {
    const { manager, launch } = fixture({ platform: "darwin", arch: "x64" });
    await expect(manager.start(authority)).rejects.toThrow("no bundled Cypher binary");
    expect(launch).not.toHaveBeenCalled();
  });

  it.each([
    [
      "linux",
      "/bundled/cypher",
      "/user/private/cypher",
      "/user/private/cypher/custom.ipc",
      "/user/private/cypher",
      "/user/private/cypher/custom.ipc",
    ],
    [
      "linux",
      "/bundled/cypher",
      "custom-chain",
      "custom.ipc",
      "/bundled/cypher/custom-chain",
      "/bundled/cypher/custom-chain/custom.ipc",
    ],
    [
      "darwin",
      "/bundled/cypher",
      "custom-chain",
      "./custom.ipc",
      "/bundled/cypher/custom-chain",
      "/bundled/cypher/custom-chain/custom.ipc",
    ],
    [
      "linux",
      "/bundled/cypher",
      "custom-chain",
      "run/custom.ipc",
      "/bundled/cypher/custom-chain",
      "/bundled/cypher/run/custom.ipc",
    ],
    [
      "linux",
      "/bundled/cypher",
      "custom-chain",
      "${CYPHER_DATADIR}/custom.ipc",
      "/bundled/cypher/custom-chain",
      "/bundled/cypher/custom-chain/custom.ipc",
    ],
    [
      "linux",
      "/bundled/cypher",
      "custom-chain",
      "${PWD}/custom.ipc",
      "/bundled/cypher/custom-chain",
      "/bundled/cypher/custom.ipc",
    ],
    [
      "win32",
      "C:\\bundled\\cypher",
      "custom-chain",
      "custom.ipc",
      "C:\\bundled\\cypher\\custom-chain",
      "\\\\.\\pipe\\custom.ipc",
    ],
    [
      "win32",
      "C:\\bundled\\cypher",
      "custom-chain",
      "\\\\.\\pipe\\custom.ipc",
      "C:\\bundled\\cypher\\custom-chain",
      "\\\\.\\pipe\\custom.ipc",
    ],
  ])(
    "connects to the %s launcher's IPC endpoint for datadir %s/%s and IPC %s",
    async (platform, rootDir, dataDir, ipcPath, expectedDataDir, expectedIpcPath) => {
      vi.stubEnv("CYPHER_DATADIR", dataDir);
      vi.stubEnv("CYPHER_IPC_PATH", ipcPath);
      const { manager, launch, rpc } = fixture({
        platform,
        arch: platform === "darwin" ? "arm64" : "x64",
        rootDir,
      });
      await expect(manager.start(authority)).resolves.toMatchObject({
        dataDir: expectedDataDir,
        ipcPath: expectedIpcPath,
      });
      expect(launch.mock.calls[0]?.[0].env).toMatchObject({
        CYPHER_DATADIR: dataDir,
        CYPHER_IPC_PATH: ipcPath,
      });
      await manager.connect(authority);
      expect(rpc).toHaveBeenCalledWith(
        expectedIpcPath,
        "web3_clientVersion",
        [],
        expect.any(Object),
      );
    },
  );

  it.skipIf(process.platform === "win32")(
    "resolves Unix relative paths beside the physical launcher",
    async () => {
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "cypher-script-root-"));
      try {
        const physicalBase = await fs.realpath(tempDir);
        const rootDir = path.join(physicalBase, "releases", "cypher");
        const alias = path.join(physicalBase, "current");
        await fs.mkdir(rootDir, { recursive: true });
        await fs.symlink(rootDir, alias, "dir");
        vi.stubEnv("CYPHER_DATADIR", "../chain");
        vi.stubEnv("CYPHER_IPC_PATH", "${PWD}/custom.ipc");
        const { manager } = fixture({ rootDir: alias });
        await expect(manager.start(authority)).resolves.toMatchObject({
          rootDir,
          dataDir: path.join(physicalBase, "releases", "chain"),
          ipcPath: path.join(rootDir, "custom.ipc"),
        });
        await manager.close();
      } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
      }
    },
  );

  it("checks the missing Unix endpoint without creating the launcher's data directory", async () => {
    const lstat = vi
      .spyOn(fs, "lstat")
      .mockRejectedValue(Object.assign(new Error("absent"), { code: "ENOENT" }));
    const access = vi.spyOn(fs, "access").mockResolvedValue();
    const mkdir = vi.spyOn(fs, "mkdir").mockResolvedValue(undefined);
    const { manager, launch } = fixture({ endpointExists: undefined, preflight: undefined });
    await manager.start(authority);
    expect(lstat).toHaveBeenCalledOnce();
    expect(access).toHaveBeenCalledTimes(3);
    expect(mkdir).not.toHaveBeenCalled();
    expect(launch).toHaveBeenCalledOnce();
  });

  it("does not launch over an existing IPC endpoint", async () => {
    const { manager, launch } = fixture({ endpointExists: async () => true });
    await expect(manager.start(authority)).rejects.toThrow("endpoint already exists");
    expect(launch).not.toHaveBeenCalled();
  });

  it("does not launch a duplicate process while the owned node is starting", async () => {
    const { manager, launch } = fixture();
    await manager.start(authority);
    await expect(manager.start(authority)).rejects.toThrow("already owned or connected");
    expect(launch).toHaveBeenCalledOnce();
  });

  it.each(["ENOENT", "ECONNREFUSED"])(
    "permits a Windows launch only after the pipe reports %s",
    async (code) => {
      const { manager, rpc, launch } = fixture({ platform: "win32", endpointExists: undefined });
      rpc.mockRejectedValueOnce(new CypherIpcError("absent", code));
      await manager.start(authority);
      expect(rpc).toHaveBeenCalledWith(
        "\\\\.\\pipe\\cypher.ipc",
        "web3_clientVersion",
        [],
        expect.any(Object),
      );
      expect(launch).toHaveBeenCalledOnce();
    },
  );

  it.each(["EACCES", "EBUSY", "IPC_TIMEOUT"])(
    "preserves a Windows endpoint reporting %s without launching another node",
    async (code) => {
      const { manager, rpc, launch } = fixture({ platform: "win32", endpointExists: undefined });
      rpc.mockRejectedValueOnce(new CypherIpcError("unavailable", code));
      await expect(manager.start(authority)).rejects.toMatchObject({ code });
      expect(launch).not.toHaveBeenCalled();
    },
  );

  it("connects a fresh accountless node so its first wallet can be created", async () => {
    const { manager, values, rpc } = fixture();
    values.eth_accounts = [];
    const state = await manager.connect(authority);
    expect(state).toMatchObject({
      connected: true,
      owned: false,
      node: { accounts: [], signer: null },
    });
    expect(rpc.mock.calls.some(([, method]) => method === "eth_coinbase")).toBe(false);
    await expect(manager.createAccount("password", authority)).resolves.toEqual({ address: A });
  });

  it("refuses to stop an explicitly connected external node", async () => {
    const { manager, launch, process } = fixture();
    await expect(manager.connect(authority)).resolves.toMatchObject({
      connected: true,
      owned: false,
    });
    await expect(manager.stop(authority)).rejects.toThrow("does not own");
    expect(launch).not.toHaveBeenCalled();
    expect(process.interrupt).not.toHaveBeenCalled();
  });

  it("keeps an owned node disconnected until Connect IPC is requested again", async () => {
    const { manager, rpc } = fixture();
    await manager.start(authority);
    await expect(manager.status()).resolves.toMatchObject({ state: "running", connected: true });
    await manager.disconnect(authority);
    const calls = rpc.mock.calls.length;
    await expect(manager.status()).resolves.toMatchObject({
      owned: true,
      connected: false,
      node: null,
    });
    expect(rpc).toHaveBeenCalledTimes(calls);
    await expect(manager.connect(authority)).resolves.toMatchObject({ connected: true });
  });

  it("joins graceful owner shutdown and clears the unused deadline", async () => {
    const { manager, process } = fixture();
    await manager.start(authority);
    await expect(manager.stop(authority)).resolves.toMatchObject({
      state: "stopped",
      owned: false,
      pid: null,
    });
    expect(process.interrupt).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps a started node running without an automatic uptime deadline", async () => {
    const { manager, process } = fixture();
    await manager.start(authority);
    await vi.advanceTimersByTimeAsync(120_000);
    await expect(manager.status()).resolves.toMatchObject({ owned: true, state: "running" });
    expect(process.interrupt).not.toHaveBeenCalled();
  });

  it("refuses a queued stop when its request authority is revoked before interruption", async () => {
    const { manager, process } = fixture();
    await manager.start(authority);
    let current = true;
    const stopped = manager.stop({
      assertCurrent() {
        if (!current) {
          throw new Error("retired requester");
        }
      },
    });
    current = false;
    await expect(stopped).rejects.toThrow("retired requester");
    expect(process.interrupt).not.toHaveBeenCalled();
    await expect(manager.status()).resolves.toMatchObject({ owned: true, state: "running" });
  });

  it("interrupts the entire owned Unix process group and joins inherited output closure", async () => {
    class FakeOutput extends EventEmitter {
      setEncoding() {
        return this;
      }
    }
    class FakeChild extends EventEmitter {
      pid = 456;
      stdout = new FakeOutput();
      stderr = new FakeOutput();
    }
    const child = new FakeChild();
    childProcessMock.spawn.mockImplementation(() => {
      queueMicrotask(() => child.emit("spawn"));
      return child;
    });
    const interrupted = deferred<void>();
    const kill = vi.spyOn(process, "kill").mockImplementation(() => {
      child.emit("exit", 0);
      interrupted.resolve();
      return true;
    });
    const { manager } = fixture({ launch: undefined });
    try {
      await manager.start(authority);
      expect(childProcessMock.spawn).toHaveBeenCalledWith(
        "bash",
        ["/bundled/cypher/colossusX_linux.sh"],
        expect.objectContaining({ detached: true, stdio: ["pipe", "pipe", "pipe"] }),
      );
      let finished = false;
      const stopped = manager.stop(authority);
      await expect(stopped).resolves.toMatchObject({ state: "stopping", owned: true, pid: 456 });
      await expect(manager.status()).resolves.toMatchObject({ state: "stopping", owned: true });
      await expect(manager.start(authority)).rejects.toThrow("still stopping");
      await expect(manager.disconnect(authority)).rejects.toThrow("still stopping");
      const closed = manager.close().then(() => {
        finished = true;
      });
      await interrupted.promise;
      expect(kill).toHaveBeenCalledWith(-456, "SIGINT");
      expect(finished).toBe(false);
      // Child close follows inherited stdout/stderr closure, unlike the parent's exit event.
      child.emit("close", 0);
      await closed;
      await expect(manager.status()).resolves.toMatchObject({
        state: "stopped",
        owned: false,
        pid: null,
      });
      expect(kill).toHaveBeenCalledExactlyOnceWith(-456, "SIGINT");
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      child.emit("close", 0);
    }
  });

  it("leaves the owned process alive after a graceful stop timeout", async () => {
    const { manager, process } = fixture({ stopTimeoutMs: undefined });
    const interrupted = deferred<void>();
    process.interrupt.mockImplementation(() => {
      interrupted.resolve();
    });
    await manager.start(authority);
    await expect(manager.stop(authority)).resolves.toMatchObject({
      state: "stopping",
      owned: true,
    });
    await interrupted.promise;
    await vi.advanceTimersByTimeAsync(30_001);
    await expect(manager.status()).resolves.toMatchObject({
      state: "error",
      owned: true,
      pid: 123,
      error: expect.stringContaining("left running"),
    });
    await expect(manager.close()).rejects.toThrow("left running");
    await vi.advanceTimersByTimeAsync(30_000);
    expect(process.exited).toBe(false);
    expect(process.interrupt).toHaveBeenCalledOnce();
    process.exit(0);
    await expect(manager.status()).resolves.toMatchObject({
      state: "stopped",
      owned: false,
      pid: null,
      error: null,
    });
  });

  it("does not claim a Windows node stopped when IPC still responds after PowerShell exits", async () => {
    const { manager, rpc } = fixture({ platform: "win32" });
    await manager.start(authority);
    rpc.mockResolvedValue("Cypher/test");
    await manager.stop(authority);
    await expect(manager.close()).rejects.toThrow("IPC still responds");
    await expect(manager.status()).resolves.toMatchObject({
      state: "error",
      owned: true,
      pid: null,
    });
  });

  it("does not claim Windows shutdown for an inaccessible pipe after PowerShell exits", async () => {
    const { manager, rpc } = fixture({ platform: "win32" });
    await manager.start(authority);
    rpc.mockRejectedValue(new CypherIpcError("IPC unavailable.", "EACCES"));
    await manager.stop(authority);
    await expect(manager.close()).rejects.toThrow("IPC unavailable");
    await expect(manager.status()).resolves.toMatchObject({ state: "error", owned: true });
  });

  it("confirms Windows shutdown only when its owned pipe is absent", async () => {
    const { manager, rpc, process } = fixture({ platform: "win32" });
    await manager.start(authority);
    await manager.stop(authority);
    await manager.close();
    await expect(manager.status()).resolves.toMatchObject({
      state: "stopped",
      owned: false,
      pid: null,
    });
    expect(process.interrupt).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith(
      "\\\\.\\pipe\\cypher.ipc",
      "web3_clientVersion",
      [],
      expect.any(Object),
    );
  });

  it("finishes an accepted Windows stop after the requesting connection loses authority", async () => {
    const { manager, process } = fixture({ platform: "win32" });
    const connection = new AbortController();
    let current = true;
    process.interrupt.mockImplementation(() => {});
    await manager.start(authority);
    await expect(
      manager.stop({
        signal: connection.signal,
        assertCurrent() {
          if (!current) {
            throw new Error("retired requester");
          }
        },
      }),
    ).resolves.toMatchObject({ state: "stopping" });
    current = false;
    connection.abort();
    process.exit(0);
    await manager.close();
    await expect(manager.status()).resolves.toMatchObject({ state: "stopped", owned: false });
    expect(process.interrupt).toHaveBeenCalledOnce();
  });

  it("confirms a Windows launcher that exits after its stop observation expired without interrupting again", async () => {
    const { manager, process } = fixture({ platform: "win32" });
    process.interrupt.mockImplementation(() => {});
    await manager.start(authority);
    await manager.stop(authority);
    await vi.advanceTimersByTimeAsync(51);
    await expect(manager.status()).resolves.toMatchObject({ state: "error", owned: true });
    process.exit(0);
    await manager.close();
    await expect(manager.status()).resolves.toMatchObject({
      state: "stopped",
      owned: false,
      error: null,
    });
    expect(process.interrupt).toHaveBeenCalledOnce();
  });

  it("keeps signer A separate from payout B and never selects B as etherbase", async () => {
    const { manager, rpc } = fixture();
    await manager.connect(authority);
    await manager.selectAccount(A, authority);
    await expect(
      manager.setReward({ signer: A, recipient: B, password: "secret" }, authority),
    ).resolves.toMatchObject({ signer: A, rewardRecipient: B });
    expect(rpc).toHaveBeenCalledWith(
      "/state/chaindbname/cypher.ipc",
      "miner_setEtherbase",
      [A],
      expect.any(Object),
    );
    expect(rpc).toHaveBeenCalledWith(
      "/state/chaindbname/cypher.ipc",
      "personal_setCommonRPCRewardAddress",
      [A, B, "secret"],
      expect.any(Object),
    );
    expect(
      rpc.mock.calls.some(
        ([, method, params]) => method === "miner_setEtherbase" && params[0] === B,
      ),
    ).toBe(false);
  });

  it("rejects A=B before any reward registration", async () => {
    const { manager, rpc } = fixture();
    await manager.connect(authority);
    await expect(
      manager.setReward(
        { signer: A, recipient: A.toUpperCase().replace("0X", "0x"), password: "secret" },
        authority,
      ),
    ).rejects.toThrow("must differ");
    expect(
      rpc.mock.calls.some(([, method]) => method === "personal_setCommonRPCRewardAddress"),
    ).toBe(false);
  });

  it("refuses already-running mining rather than silently ignoring its new signer", async () => {
    const { manager, values, rpc } = fixture();
    await manager.connect(authority);
    values.eth_mining = true;
    await expect(
      manager.startMining({ threads: 2, signer: A, password: "secret" }, authority),
    ).rejects.toThrow("Stop mining");
    expect(rpc.mock.calls.some(([, method]) => method === "miner_start")).toBe(false);
  });

  it("sends all three mining arguments and explicit unlock duration to the local account", async () => {
    const { manager, rpc } = fixture();
    await manager.connect(authority);
    await manager.startMining({ threads: 2, signer: A, password: "secret" }, authority);
    await expect(
      manager.unlockAccount({ address: A, password: "secret", duration: 3600 }, authority),
    ).resolves.toEqual({ unlocked: true });
    await expect(manager.lockAccount(A, authority)).resolves.toEqual({ locked: true });
    expect(rpc).toHaveBeenCalledWith(
      "/state/chaindbname/cypher.ipc",
      "miner_start",
      [2, A, "secret"],
      expect.any(Object),
    );
    expect(rpc).toHaveBeenCalledWith(
      "/state/chaindbname/cypher.ipc",
      "personal_unlockAccount",
      [A, "secret", 3600],
      expect.any(Object),
    );
  });

  it("revalidates authority after asynchronous preflight before spawning", async () => {
    const gate = deferred<void>();
    const entered = deferred<void>();
    let current = true;
    const requestAuthority = {
      assertCurrent: () => {
        if (!current) {
          throw new Error("revoked");
        }
      },
    };
    const { manager, launch } = fixture({
      preflight: async () => {
        entered.resolve();
        await gate.promise;
      },
    });
    const started = manager.start(requestAuthority);
    const rejected = expect(started).rejects.toThrow("operation failed");
    await entered.promise;
    current = false;
    gate.resolve();
    await rejected;
    expect(launch).not.toHaveBeenCalled();
  });

  it("revalidates authority after account lookup before a wallet mutation", async () => {
    const { manager, rpc, values } = fixture();
    await manager.connect(authority);
    const gate = deferred<void>();
    const entered = deferred<void>();
    let current = true;
    rpc.mockImplementation(async (_endpoint, method, _params, options) => {
      options?.assertCurrent?.();
      if (method === "eth_accounts") {
        entered.resolve();
        await gate.promise;
      }
      return values[method];
    });
    const unlocking = manager.unlockAccount(
      { address: A, password: "secret", duration: 300 },
      {
        assertCurrent: () => {
          if (!current) {
            throw new Error("revoked");
          }
        },
      },
    );
    const rejected = expect(unlocking).rejects.toThrow("operation failed");
    await entered.promise;
    current = false;
    gate.resolve();
    await rejected;
    expect(rpc.mock.calls.some(([, method]) => method === "personal_unlockAccount")).toBe(false);
  });

  it("sanitizes unexpected wallet errors instead of exposing its password", async () => {
    const { manager, rpc } = fixture();
    await manager.connect(authority);
    rpc.mockRejectedValueOnce(new Error("super-secret-password"));
    await expect(manager.createAccount("super-secret-password", authority)).rejects.toThrow(
      "operation failed",
    );
    await expect(manager.status()).resolves.not.toMatchObject({ error: "super-secret-password" });
  });

  it("aborts in-flight IPC before joining the queue during close and rejects queued mutations", async () => {
    const { manager, rpc, values } = fixture();
    await manager.connect(authority);
    const entered = deferred<void>();
    let aborted = false;
    rpc.mockImplementation(async (_endpoint, method, _params, options) => {
      options?.assertCurrent?.();
      if (method === "miner_start") {
        entered.resolve();
        return await new Promise((_resolve, reject) => {
          options?.signal?.addEventListener(
            "abort",
            () => {
              aborted = true;
              reject(new Error("secret"));
            },
            { once: true },
          );
        });
      }
      return values[method];
    });
    const mining = manager.startMining({ threads: 2, signer: A, password: "secret" }, authority);
    const rejected = expect(mining).rejects.toThrow("operation failed");
    await entered.promise;
    const creating = manager.createAccount("secret", authority);
    const queuedRejected = expect(creating).rejects.toThrow("owner has closed");
    await manager.close();
    await rejected;
    await queuedRejected;
    expect(aborted).toBe(true);
    expect(rpc.mock.calls.some(([, method]) => method === "personal_newAccount")).toBe(false);
    await expect(manager.status()).resolves.toMatchObject({ connected: false, node: null });
  });
});
