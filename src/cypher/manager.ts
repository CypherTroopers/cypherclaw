import { spawn } from "node:child_process";
import { constants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import {
  callCypherIpc,
  CypherIpcError,
  type CypherRpcMethod,
  type CypherRpcParams,
} from "./ipc.js";
import type { CypherNodeSnapshot, CypherRewardRegistration, CypherStatus } from "./types.js";

export type CypherAuthority = { assertCurrent: () => void; signal?: AbortSignal };
export class CypherOperationError extends Error {
  constructor(
    message: string,
    readonly code = "CYPHER_OPERATION",
  ) {
    super(message);
    this.name = "CypherOperationError";
  }
}

export type CypherProcess = {
  pid: number;
  onData(listener: (data: string) => void): void;
  onExit(listener: (code: number | null) => void): void;
  interrupt(): void;
};
type LaunchOptions = {
  platform: string;
  script: string;
  rootDir: string;
  env: Record<string, string>;
  assertCurrent: () => void;
};
type ManagerOptions = {
  platform?: string;
  arch?: string;
  rootDir?: string;
  dataDir?: string;
  ipcPath?: string;
  rpc?: typeof callCypherIpc;
  launch?: (options: LaunchOptions) => Promise<CypherProcess>;
  preflight?: () => Promise<void>;
  endpointExists?: () => Promise<boolean>;
  stopTimeoutMs?: number;
};
const targets: Record<string, { binary: string; script: string }> = {
  "linux/x64": { binary: "cypher-linux-amd64", script: "colossusX_linux.sh" },
  "darwin/arm64": { binary: "cypher-darwin-arm64", script: "colossusX_mac.sh" },
  "win32/x64": { binary: "cypher.exe", script: "colossusX_windows.ps1" },
};
const addressPattern = /^0x[0-9a-fA-F]{40}$/;
export function isCypherAddress(value: unknown): value is string {
  return typeof value === "string" && addressPattern.test(value) && !/^0x0{40}$/i.test(value);
}
function safeError(error: unknown): string {
  return error instanceof CypherOperationError || error instanceof CypherIpcError
    ? error.message
    : "The Cypher operation failed. Check the node and its local IPC endpoint.";
}
function stringResult(value: unknown): string {
  if (typeof value !== "string" || value.length > 1024) {
    throw new CypherOperationError("Cypher returned an invalid result.");
  }
  return value;
}
function booleanResult(value: unknown): boolean {
  if (typeof value !== "boolean") {
    throw new CypherOperationError("Cypher returned an invalid result.");
  }
  return value;
}
async function launchProcess(options: LaunchOptions): Promise<CypherProcess> {
  if (options.platform === "win32") {
    // A Windows pipe child cannot receive a graceful SIGINT via child.kill().
    // ConPTY delivers Ctrl+C to the console running the supplied PowerShell script.
    const { spawnTerminalPty } = await import("../process/terminal-pty.js");
    const terminal = await spawnTerminalPty(
      {
        file: "powershell.exe",
        args: ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", options.script],
        cwd: options.rootDir,
        env: options.env,
        cols: 120,
        rows: 30,
      },
      { assertCurrent: options.assertCurrent },
    );
    return {
      pid: terminal.pid,
      onData: (listener) => {
        terminal.onData(listener);
      },
      onExit: (listener) => {
        terminal.onExit(({ exitCode }) => listener(exitCode));
      },
      interrupt: () => terminal.write("\x03"),
    };
  }
  options.assertCurrent();
  const child = spawn("bash", [options.script], {
    cwd: options.rootDir,
    env: options.env,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise<void>((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", () =>
      reject(new CypherOperationError("The Cypher launch script could not be started.")),
    );
  });
  return {
    pid: child.pid!,
    onData: (listener) => {
      child.stdout.setEncoding("utf8").on("data", listener);
      child.stderr.setEncoding("utf8").on("data", listener);
    },
    onExit: (listener) => {
      child.once("close", (code) => listener(code));
    },
    interrupt: () => {
      // The initialization binary runs before Bash execs the long-lived node.
      process.kill(-child.pid!, "SIGINT");
    },
  };
}

/** One process/endpoint owner for one Gateway lifetime. No startup or IPC dialing at construction. */
export class CypherNodeManager {
  readonly #options: ManagerOptions;
  readonly #rpc: typeof callCypherIpc;
  #paths: Promise<{ rootDir: string; dataDir: string; ipcPath: string }> | undefined;
  #queue: Promise<unknown> = Promise.resolve();
  #process: CypherProcess | null = null;
  #processExited = false;
  #exit: Promise<void> | null = null;
  #state: CypherStatus["state"] = "stopped";
  #connected = false;
  #refreshAllowed = false;
  #stopRequested = false;
  #node: CypherNodeSnapshot | null = null;
  #error: string | null = null;
  #logs: string[] = [];
  #closed = false;
  #close: Promise<void> | undefined;
  readonly #lifetime = new AbortController();

  constructor(options: ManagerOptions = {}) {
    this.#options = options;
    this.#rpc = options.rpc ?? callCypherIpc;
  }
  get #platform() {
    return this.#options.platform ?? process.platform;
  }
  get #arch() {
    return this.#options.arch ?? process.arch;
  }
  get #target() {
    return targets[`${this.#platform}/${this.#arch}`];
  }
  async #resolvePaths() {
    return await (this.#paths ??= (async () => {
      const pathApi = this.#platform === "win32" ? path.win32 : path;
      let packageRoot = this.#options.rootDir ?? process.env.CYPHER_ROOT;
      if (!packageRoot) {
        const { resolveOpenClawPackageRoot } = await import("../infra/openclaw-root.js");
        const root = await resolveOpenClawPackageRoot({ moduleUrl: import.meta.url });
        if (!root) {
          throw new CypherOperationError("The Cypher package directory could not be found.");
        }
        packageRoot = path.join(root, "cypher");
      }
      let dataDir = this.#options.dataDir ?? process.env.CYPHER_DATADIR;
      if (!dataDir) {
        const { resolveStateDir } = await import("../config/state-dir.js");
        dataDir = pathApi.join(resolveStateDir(), "cypher", "chaindbname");
      }
      return {
        rootDir: pathApi.resolve(packageRoot),
        dataDir: pathApi.resolve(dataDir),
        ipcPath:
          this.#options.ipcPath ??
          process.env.CYPHER_IPC_PATH ??
          (this.#platform === "win32"
            ? "\\\\.\\pipe\\cypher.ipc"
            : pathApi.join(pathApi.resolve(dataDir), "cypher.ipc")),
      };
    })());
  }
  #serialize<T>(task: () => Promise<T>): Promise<T> {
    const next = this.#queue.then(task, task);
    this.#queue = next.catch(() => undefined);
    return next;
  }
  #assert(authority: CypherAuthority) {
    if (this.#closed) {
      throw new CypherOperationError("The Cypher Gateway owner has closed.");
    }
    authority.signal?.throwIfAborted();
    authority.assertCurrent();
  }
  async #call<M extends CypherRpcMethod>(
    method: M,
    params: CypherRpcParams[M],
    authority?: CypherAuthority,
  ) {
    const paths = await this.#resolvePaths();
    if (this.#closed) {
      throw new CypherOperationError("The Cypher Gateway owner has closed.");
    }
    if (authority) {
      this.#assert(authority);
    }
    return await this.#rpc(paths.ipcPath, method, params, {
      signal: authority?.signal
        ? AbortSignal.any([authority.signal, this.#lifetime.signal])
        : this.#lifetime.signal,
      assertCurrent: authority ? () => this.#assert(authority) : undefined,
    });
  }
  async #snapshot(authority?: CypherAuthority) {
    const [clientVersion, chainId, blockNumber, peerCount, mining, hashrate, accounts] =
      await Promise.all([
        this.#call("web3_clientVersion", [], authority),
        this.#call("eth_chainId", [], authority),
        this.#call("eth_blockNumber", [], authority),
        this.#call("net_peerCount", [], authority),
        this.#call("eth_mining", [], authority),
        this.#call("eth_hashrate", [], authority),
        this.#call("eth_accounts", [], authority),
      ]);
    if (!Array.isArray(accounts) || accounts.length > 1024 || !accounts.every(isCypherAddress)) {
      throw new CypherOperationError("Cypher returned an invalid account list.");
    }
    // A fresh node has no etherbase until its first account exists.
    const signer = accounts.length ? await this.#call("eth_coinbase", [], authority) : null;
    if (this.#closed) {
      throw new CypherOperationError("The Cypher Gateway owner has closed.");
    }
    if (authority) {
      this.#assert(authority);
    }
    this.#node = {
      clientVersion: stringResult(clientVersion),
      chainId: stringResult(chainId),
      blockNumber: stringResult(blockNumber),
      peerCount: stringResult(peerCount),
      mining: booleanResult(mining),
      hashrate: stringResult(hashrate),
      accounts,
      signer: isCypherAddress(signer) ? signer : null,
    };
    this.#connected = true;
    this.#error = null;
    if (this.#process && this.#state === "starting") {
      this.#state = "running";
    }
  }
  async #status(refresh = true): Promise<CypherStatus> {
    const paths = await this.#resolvePaths();
    if (
      refresh &&
      this.#refreshAllowed &&
      !this.#closed &&
      (this.#connected || (this.#process && this.#state !== "stopping"))
    ) {
      try {
        await this.#snapshot();
      } catch (error) {
        this.#connected = false;
        this.#node = null;
        this.#error = this.#state === "starting" ? null : safeError(error);
      }
    }
    const pathApi = this.#platform === "win32" ? path.win32 : path;
    return {
      platform: this.#platform,
      arch: this.#arch,
      supported: Boolean(this.#target),
      ...paths,
      binaryPath: this.#target
        ? pathApi.join(paths.rootDir, "build", "bin", this.#target.binary)
        : "",
      state: this.#state,
      owned: this.#process !== null,
      pid: this.#processExited ? null : (this.#process?.pid ?? null),
      connected: this.#connected,
      node: this.#node ? { ...this.#node, accounts: [...this.#node.accounts] } : null,
      logs: [...this.#logs],
      error: this.#error,
    };
  }
  status() {
    return this.#serialize(() => this.#status());
  }
  async #requireConnected(authority: CypherAuthority) {
    this.#assert(authority);
    if (!this.#connected) {
      throw new CypherOperationError("Connect to Cypher IPC before performing this operation.");
    }
  }
  #operation<T>(authority: CypherAuthority, task: () => Promise<T>) {
    return this.#serialize(async () => {
      this.#assert(authority);
      try {
        return await task();
      } catch (error) {
        if (error instanceof CypherOperationError || error instanceof CypherIpcError) {
          throw error;
        }
        throw new CypherOperationError(safeError(error));
      }
    });
  }
  start(authority: CypherAuthority) {
    return this.#operation(authority, async () => {
      if (!this.#target) {
        throw new CypherOperationError(
          "This Gateway OS and architecture have no bundled Cypher binary.",
        );
      }
      if (this.#process || this.#connected) {
        throw new CypherOperationError(
          "Cypher is already owned or connected. Stop or disconnect it before starting another node.",
        );
      }
      const paths = await this.#resolvePaths();
      const pathApi = this.#platform === "win32" ? path.win32 : path;
      const script = pathApi.join(paths.rootDir, this.#target.script);
      if (this.#options.endpointExists) {
        if (await this.#options.endpointExists()) {
          throw new CypherOperationError(
            "A Cypher IPC endpoint already exists. Use Connect IPC for that node.",
          );
        }
      } else if (this.#platform === "win32") {
        try {
          await this.#call("web3_clientVersion", [], authority);
          throw new CypherOperationError(
            "A Cypher IPC endpoint already exists. Use Connect IPC for that node.",
          );
        } catch (error) {
          if (
            !(error instanceof CypherIpcError) ||
            !["ENOENT", "ECONNREFUSED"].includes(String(error.code))
          ) {
            throw error;
          }
        }
      } else {
        if (
          await fs.lstat(paths.ipcPath).then(
            () => true,
            (error: NodeJS.ErrnoException) => {
              if (error.code === "ENOENT") {
                return false;
              }
              throw new CypherOperationError("The Cypher IPC endpoint could not be inspected.");
            },
          )
        ) {
          throw new CypherOperationError(
            "A Cypher IPC endpoint already exists. Use Connect IPC for that node.",
          );
        }
      }
      if (this.#options.preflight) {
        await this.#options.preflight();
      } else {
        try {
          await Promise.all([
            fs.access(
              pathApi.join(paths.rootDir, "build", "bin", this.#target.binary),
              this.#platform === "win32" ? constants.R_OK : constants.R_OK | constants.X_OK,
            ),
            fs.access(script, constants.R_OK),
            fs.access(pathApi.join(paths.rootDir, "genesis.json"), constants.R_OK),
          ]);
        } catch {
          throw new CypherOperationError(
            "Cypher binaries or launch files are missing or not executable. Install this fork with its bundled Cypher files.",
          );
        }
        this.#assert(authority);
        await fs.mkdir(paths.dataDir, { recursive: true, mode: 0o700 });
      }
      this.#assert(authority);
      const env: Record<string, string> = {};
      for (const [key, value] of Object.entries(process.env)) {
        if (value !== undefined) {
          env[key] = value;
        }
      }
      Object.assign(env, {
        CYPHER_HEADLESS: "1",
        CYPHER_DATADIR: paths.dataDir,
        CYPHER_IPC_PATH: paths.ipcPath,
        CYPHER_BROWSER_RELAY: "0",
        CYPHER_RPC_ENABLED: "0",
        CYPHER_RPC_BIND: "127.0.0.1",
        CYPHER_WS_BIND: "127.0.0.1",
      });
      this.#logs = [];
      this.#error = null;
      this.#state = "starting";
      this.#refreshAllowed = true;
      this.#stopRequested = false;
      try {
        const owned = await (this.#options.launch ?? launchProcess)({
          platform: this.#platform,
          script,
          rootDir: paths.rootDir,
          env,
          assertCurrent: () => this.#assert(authority),
        });
        this.#process = owned;
        this.#processExited = false;
        owned.onData((data) => {
          // Passwords are IPC-only. Strip terminal controls; retain a bounded local node log.
          const clean = data
            .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
            .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "");
          for (const line of clean.split(/\r?\n/)) {
            if (line) {
              this.#logs.push(line.slice(0, 1024));
            }
          }
          this.#logs = this.#logs.slice(-200);
        });
        this.#exit = new Promise<void>((resolve) =>
          owned.onExit((code) => {
            if (this.#process === owned) {
              this.#processExited = true;
              if (this.#platform === "win32") {
                // PowerShell's exit alone does not prove its Cypher child stopped.
                this.#connected = false;
                this.#node = null;
                if (!this.#stopRequested) {
                  this.#refreshAllowed = false;
                  this.#state = "error";
                  this.#error =
                    "The Windows launcher exited. Cypher shutdown has not been confirmed; check IPC before starting another node.";
                }
                resolve();
                return;
              }
              const stopped = this.#stopRequested || code === 0;
              this.#process = null;
              this.#connected = false;
              this.#node = null;
              this.#refreshAllowed = false;
              this.#state = stopped ? "stopped" : "error";
              this.#error = stopped
                ? null
                : "The Cypher process exited. Check its node logs and binary dependencies.";
            }
            resolve();
          }),
        );
        return await this.#status(false);
      } catch (error) {
        this.#state = "error";
        this.#error = safeError(error);
        throw new CypherOperationError(this.#error);
      }
    });
  }
  async #stop(authority?: CypherAuthority) {
    const owned = this.#process;
    if (!owned) {
      throw new CypherOperationError("This Gateway does not own the connected Cypher process.");
    }
    if (authority) {
      this.#assert(authority);
    }
    this.#state = "stopping";
    this.#stopRequested = true;
    try {
      if (!this.#processExited) {
        owned.interrupt();
      }
    } catch {
      this.#stopRequested = false;
      this.#state = "error";
      this.#error =
        "Cypher could not receive the graceful stop request. Its process has been left running.";
      throw new CypherOperationError(this.#error);
    }
    const exited = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), this.#options.stopTimeoutMs ?? 30_000);
      timer.unref();
      void this.#exit!.then(() => {
        clearTimeout(timer);
        resolve(true);
      });
    });
    if (!exited) {
      this.#state = "error";
      this.#error =
        "Cypher did not finish its graceful shutdown. Its process has been left running; check the node before retrying Stop.";
      throw new CypherOperationError(this.#error);
    }
    if (this.#platform === "win32") {
      const paths = await this.#resolvePaths();
      if (authority) {
        this.#assert(authority);
      }
      try {
        // Shutdown owns this endpoint even after the ordinary request lifetime was canceled.
        await this.#rpc(paths.ipcPath, "web3_clientVersion", [], {
          signal: authority?.signal,
          assertCurrent: authority ? () => this.#assert(authority) : undefined,
        });
        throw new CypherOperationError(
          "Cypher IPC still responds after the Windows launcher exited. Its node has been left running; check it before retrying Stop.",
        );
      } catch (error) {
        if (
          !(error instanceof CypherIpcError) ||
          !["ENOENT", "ECONNREFUSED"].includes(String(error.code))
        ) {
          this.#state = "error";
          this.#error = safeError(error);
          throw new CypherOperationError(this.#error);
        }
      }
      this.#process = null;
      this.#connected = false;
      this.#node = null;
      this.#refreshAllowed = false;
      this.#state = "stopped";
      this.#error = null;
    }
    return await this.#status(false);
  }
  stop(authority: CypherAuthority) {
    return this.#operation(authority, () => this.#stop(authority));
  }
  connect(authority: CypherAuthority) {
    return this.#operation(authority, async () => {
      await this.#call("web3_clientVersion", [], authority);
      this.#assert(authority);
      await this.#snapshot(authority);
      this.#refreshAllowed = true;
      return await this.#status(false);
    });
  }
  disconnect(authority: CypherAuthority) {
    return this.#operation(authority, async () => {
      this.#refreshAllowed = false;
      this.#connected = false;
      this.#node = null;
      this.#error = null;
      return await this.#status(false);
    });
  }
  startMining(
    params: { threads: number; signer: string; password: string },
    authority: CypherAuthority,
  ) {
    return this.#operation(authority, async () => {
      await this.#requireConnected(authority);
      if (booleanResult(await this.#call("eth_mining", [], authority))) {
        throw new CypherOperationError(
          "Stop mining before changing its signer or starting it again.",
        );
      }
      await this.#requireAccount(params.signer, authority);
      await this.#call("miner_start", [params.threads, params.signer, params.password], authority);
      return await this.#status();
    });
  }
  stopMining(authority: CypherAuthority) {
    return this.#operation(authority, async () => {
      await this.#requireConnected(authority);
      await this.#call("miner_stop", [], authority);
      return await this.#status();
    });
  }
  async #requireAccount(address: string, authority: CypherAuthority) {
    const accounts = await this.#call("eth_accounts", [], authority);
    if (
      !Array.isArray(accounts) ||
      !accounts.some(
        (item) => typeof item === "string" && item.toLowerCase() === address.toLowerCase(),
      )
    ) {
      throw new CypherOperationError("Select an account in this Cypher node's local keystore.");
    }
  }
  createAccount(password: string, authority: CypherAuthority) {
    return this.#operation(authority, async () => {
      await this.#requireConnected(authority);
      const address = await this.#call("personal_newAccount", [password], authority);
      if (!isCypherAddress(address)) {
        throw new CypherOperationError("Cypher returned an invalid new account address.");
      }
      return { address };
    });
  }
  selectAccount(address: string, authority: CypherAuthority) {
    return this.#operation(authority, async () => {
      await this.#requireConnected(authority);
      if (booleanResult(await this.#call("eth_mining", [], authority))) {
        throw new CypherOperationError("Stop mining before changing the signing account.");
      }
      await this.#requireAccount(address, authority);
      if (!booleanResult(await this.#call("miner_setEtherbase", [address], authority))) {
        throw new CypherOperationError("Cypher did not select the signing account.");
      }
      return await this.#status();
    });
  }
  unlockAccount(
    params: { address: string; password: string; duration: number },
    authority: CypherAuthority,
  ) {
    return this.#operation(authority, async () => {
      await this.#requireConnected(authority);
      await this.#requireAccount(params.address, authority);
      return {
        unlocked: booleanResult(
          await this.#call(
            "personal_unlockAccount",
            [params.address, params.password, params.duration],
            authority,
          ),
        ),
      };
    });
  }
  lockAccount(address: string, authority: CypherAuthority) {
    return this.#operation(authority, async () => {
      await this.#requireConnected(authority);
      await this.#requireAccount(address, authority);
      return {
        locked: booleanResult(await this.#call("personal_lockAccount", [address], authority)),
      };
    });
  }
  async #reward(signer: string, authority: CypherAuthority): Promise<CypherRewardRegistration> {
    const value = await this.#call("personal_getCommonRPCRewardAddress", [signer], authority);
    if (
      !value ||
      typeof value !== "object" ||
      !("configured" in value) ||
      typeof value.configured !== "boolean" ||
      !("signer" in value) ||
      !isCypherAddress(value.signer) ||
      value.signer.toLowerCase() !== signer.toLowerCase()
    ) {
      throw new CypherOperationError("Cypher returned an invalid reward registration.");
    }
    if (
      value.configured &&
      (!("rewardRecipient" in value) || !isCypherAddress(value.rewardRecipient))
    ) {
      throw new CypherOperationError("Cypher returned an invalid reward recipient.");
    }
    return {
      configured: value.configured,
      signer: value.signer,
      ...(value.configured && "rewardRecipient" in value
        ? { rewardRecipient: String(value.rewardRecipient) }
        : {}),
      ...("chainId" in value && typeof value.chainId === "string"
        ? { chainId: value.chainId }
        : {}),
      ...("genesisHash" in value && typeof value.genesisHash === "string"
        ? { genesisHash: value.genesisHash }
        : {}),
    };
  }
  getReward(signer: string, authority: CypherAuthority) {
    return this.#operation(authority, async () => {
      await this.#requireConnected(authority);
      await this.#requireAccount(signer, authority);
      return await this.#reward(signer, authority);
    });
  }
  setReward(
    params: { signer: string; recipient: string; password: string },
    authority: CypherAuthority,
  ) {
    return this.#operation(authority, async () => {
      await this.#requireConnected(authority);
      await this.#requireAccount(params.signer, authority);
      if (params.signer.toLowerCase() === params.recipient.toLowerCase()) {
        throw new CypherOperationError(
          "The Common reward recipient must differ from the signing account.",
        );
      }
      await this.#call(
        "personal_setCommonRPCRewardAddress",
        [params.signer, params.recipient, params.password],
        authority,
      );
      return await this.#reward(params.signer, authority);
    });
  }
  close() {
    if (this.#close) {
      return this.#close;
    }
    // Cancel active IPC before joining its queue. Shutdown retains ownership of its process handle.
    this.#closed = true;
    this.#lifetime.abort();
    this.#close = this.#serialize(async () => {
      try {
        if (this.#process) {
          await this.#stop();
        }
      } finally {
        this.#refreshAllowed = false;
        this.#connected = false;
        this.#node = null;
      }
    });
    return this.#close;
  }
}
