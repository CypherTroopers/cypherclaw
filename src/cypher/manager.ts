import { constants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { stripVTControlCharacters } from "node:util";
import { hasErrnoCode } from "../infra/errno.js";
import { mergeProcessEnv, resolveEnvironmentValue } from "../infra/process-env.js";
import {
  callCypherIpc,
  CypherIpcError,
  resolveCypherIpcPaths,
  type CypherRpcMethod,
  type CypherRpcParams,
} from "./ipc.js";
import {
  booleanResult,
  CypherOperationError,
  isCypherAddress,
  type CypherAuthority,
} from "./operations-contract.js";
import {
  launchCypherProcess,
  type CypherProcess,
  type CypherLaunchOptions as LaunchOptions,
} from "./process.js";
import type {
  CypherNodeSnapshot,
  CypherRewardRegistration,
  CypherStatus,
  CypherTransferStore,
} from "./types.js";
import { CypherWalletOperations } from "./wallet-operations.js";

export type { CypherProcess } from "./process.js";

export {
  CypherOperationError,
  isCypherAddress,
  type CypherAuthority,
} from "./operations-contract.js";

type ManagerOptions = {
  platform?: string;
  arch?: string;
  rootDir?: string;
  rpc?: typeof callCypherIpc;
  launch?: (options: LaunchOptions) => Promise<CypherProcess>;
  preflight?: () => Promise<void>;
  endpointExists?: () => Promise<boolean>;
  stopTimeoutMs?: number;
  transferStore?: CypherTransferStore;
};
const targets: Record<string, { binary: string; script: string }> = {
  "linux/x64": { binary: "cypher-linux-amd64", script: "colossusX_linux.sh" },
  "darwin/arm64": { binary: "cypher-darwin-arm64", script: "colossusX_mac.sh" },
  "win32/x64": { binary: "cypher.exe", script: "colossusX_windows.ps1" },
};

function safeError(error: unknown): string {
  return error instanceof CypherOperationError || error instanceof CypherIpcError
    ? error.message
    : "The ColossusX operation failed. Check the node and its local IPC endpoint.";
}
function stringResult(value: unknown): string {
  if (typeof value !== "string" || value.length > 1024) {
    throw new CypherOperationError("ColossusX returned an invalid result.");
  }
  return value;
}

/** One process/endpoint owner for one Gateway lifetime. No startup or IPC dialing at construction. */
export class CypherNodeManager {
  readonly #options: ManagerOptions;
  readonly #env: Record<string, string>;
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
  readonly #walletOperations: CypherWalletOperations;

  constructor(options: ManagerOptions = {}) {
    this.#options = options;
    this.#env = mergeProcessEnv([process.env], this.#platform === "win32" ? "win32" : "linux");
    this.#rpc = options.rpc ?? callCypherIpc;
    this.#walletOperations = new CypherWalletOperations(
      {
        call: (method, params, authority) => this.#call(method, params, authority),
        serialize: (task) => this.#serialize(task),
        operation: (authority, task) => this.#operation(authority, task),
        assert: (authority) => this.#assert(authority),
        requireAccount: (address, authority) => this.#requireAccount(address, authority),
        requireConnected: (authority) => this.#requireConnected(authority),
        resolvePaths: () => this.#resolvePaths(),
        isConnected: () => this.#connected,
        isClosed: () => this.#closed,
      },
      options.transferStore,
    );
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
      const platform = this.#platform === "win32" ? "win32" : "linux";
      let packageRoot =
        this.#options.rootDir ?? resolveEnvironmentValue(this.#env, "CYPHER_ROOT", platform);
      if (!packageRoot) {
        const { resolveOpenClawPackageRoot } = await import("../infra/openclaw-root.js");
        const root = await resolveOpenClawPackageRoot({ moduleUrl: import.meta.url });
        if (!root) {
          throw new CypherOperationError("The ColossusX package directory could not be found.");
        }
        packageRoot = path.join(root, "cypher");
      }
      const pathApi = platform === "win32" ? path.win32 : path;
      let rootDir = pathApi.resolve(packageRoot);
      if (platform !== "win32") {
        rootDir = await fs.realpath(rootDir).catch((error: unknown) => {
          if (hasErrnoCode(error, "ENOENT")) {
            return rootDir;
          }
          throw new CypherOperationError("The ColossusX package directory could not be resolved.");
        });
      }
      return resolveCypherIpcPaths(rootDir, this.#env, platform);
    })());
  }
  #serialize<T>(task: () => Promise<T>): Promise<T> {
    const next = this.#queue.then(task, task);
    this.#queue = next.catch(() => undefined);
    return next;
  }
  #assert(authority: CypherAuthority) {
    if (this.#closed) {
      throw new CypherOperationError("The ColossusX Gateway owner has closed.");
    }
    try {
      authority.signal?.throwIfAborted();
      authority.assertCurrent();
    } catch {
      throw new CypherOperationError(
        "The ColossusX operation failed because its caller is no longer authorized.",
        "CYPHER_AUTHORITY_REVOKED",
      );
    }
  }
  async #call<M extends CypherRpcMethod>(
    method: M,
    params: CypherRpcParams[M],
    authority?: CypherAuthority,
  ) {
    const paths = await this.#resolvePaths();
    if (this.#closed) {
      throw new CypherOperationError("The ColossusX Gateway owner has closed.");
    }
    if (authority) {
      this.#assert(authority);
    }
    return await this.#rpc(paths.ipcPath, method, params, {
      timeoutMs: method === "personal_signTransaction" ? 120_000 : undefined,
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
      throw new CypherOperationError("ColossusX returned an invalid account list.");
    }
    // A fresh node has no etherbase until its first account exists.
    const signer = accounts.length ? await this.#call("eth_coinbase", [], authority) : null;
    if (this.#closed) {
      throw new CypherOperationError("The ColossusX Gateway owner has closed.");
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
    this.#walletOperations.startTracking();
    return this.#serialize(() => this.#status());
  }
  async #requireConnected(authority: CypherAuthority) {
    this.#assert(authority);
    if (!this.#connected) {
      throw new CypherOperationError("Connect to ColossusX IPC before performing this operation.");
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
          "This Gateway OS and architecture have no bundled ColossusX binary.",
        );
      }
      if (this.#process || this.#connected) {
        throw new CypherOperationError(
          "ColossusX is already owned or connected. Stop or disconnect it before starting another node.",
        );
      }
      const paths = await this.#resolvePaths();
      const pathApi = this.#platform === "win32" ? path.win32 : path;
      const script = pathApi.join(paths.rootDir, this.#target.script);
      if (this.#options.endpointExists) {
        if (await this.#options.endpointExists()) {
          throw new CypherOperationError(
            "A ColossusX IPC endpoint already exists. Use Connect IPC for that node.",
          );
        }
      } else if (this.#platform === "win32") {
        try {
          await this.#call("web3_clientVersion", [], authority);
          throw new CypherOperationError(
            "A ColossusX IPC endpoint already exists. Use Connect IPC for that node.",
          );
        } catch (error) {
          if (
            !(error instanceof CypherIpcError) ||
            !["ENOENT", "ECONNREFUSED"].includes(String(error.code))
          ) {
            throw error;
          }
        }
      } else if (
        await fs.lstat(paths.ipcPath).then(
          () => true,
          (error: unknown) => {
            if (hasErrnoCode(error, "ENOENT")) {
              return false;
            }
            throw new CypherOperationError("The ColossusX IPC endpoint could not be inspected.");
          },
        )
      ) {
        throw new CypherOperationError(
          "A ColossusX IPC endpoint already exists. Use Connect IPC for that node.",
        );
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
            "ColossusX binaries or launch files are missing or not executable. Install this fork with its bundled ColossusX files.",
          );
        }
      }
      if (this.#env.CYPHER_BROWSER_RELAY_CONFIG) {
        const { provisionCypherClawRelayConfiguration } =
          await import("../infra/cypherclaw-distribution.js");
        await provisionCypherClawRelayConfiguration(pathApi.dirname(paths.rootDir), this.#env, () =>
          this.#assert(authority),
        );
      }
      this.#assert(authority);
      this.#logs = [];
      this.#error = null;
      this.#state = "starting";
      this.#refreshAllowed = true;
      this.#stopRequested = false;
      try {
        const owned = await (this.#options.launch ?? launchCypherProcess)({
          platform: this.#platform,
          script,
          rootDir: paths.rootDir,
          env: { ...this.#env },
          assertCurrent: () => this.#assert(authority),
        });
        this.#process = owned;
        this.#processExited = false;
        owned.onData((data) => {
          // Passwords are IPC-only. Strip terminal controls; retain a bounded local node log.
          const clean = stripVTControlCharacters(data).replace(/\p{Cc}/gu, (control) =>
            control === "\n" || control === "\t" ? control : "",
          );
          for (const line of clean.split(/\r?\n/)) {
            if (line) {
              this.#logs.push(line.slice(0, 1024));
            }
          }
          this.#logs = this.#logs.slice(-200);
        });
        this.#exit = new Promise<void>((resolve) => {
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
                    "The Windows launcher exited. ColossusX shutdown has not been confirmed; check IPC before starting another node.";
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
                : "The ColossusX process exited. Check its node logs and binary dependencies.";
            }
            resolve();
          });
        });
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
      throw new CypherOperationError("This Gateway does not own the connected ColossusX process.");
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
        "ColossusX could not receive the graceful stop request. Its process has been left running.";
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
        "ColossusX did not finish its graceful shutdown. Its process has been left running; check the node before retrying Stop.";
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
          "ColossusX IPC still responds after the Windows launcher exited. Its node has been left running; check it before retrying Stop.",
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
      throw new CypherOperationError("Select an account in this ColossusX node's local keystore.");
    }
  }
  createAccount(password: string, authority: CypherAuthority) {
    return this.#operation(authority, async () => {
      await this.#requireConnected(authority);
      const address = await this.#call("personal_newAccount", [password], authority);
      if (!isCypherAddress(address)) {
        throw new CypherOperationError("ColossusX returned an invalid new account address.");
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
        throw new CypherOperationError("ColossusX did not select the signing account.");
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
      throw new CypherOperationError("ColossusX returned an invalid reward registration.");
    }
    if (
      value.configured &&
      (!("rewardRecipient" in value) || !isCypherAddress(value.rewardRecipient))
    ) {
      throw new CypherOperationError("ColossusX returned an invalid reward recipient.");
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
  wallets(options: { offset?: number; limit?: number } = {}) {
    return this.#walletOperations.wallets(options);
  }
  prepareTransfer(
    params: { from: string; to: string; amount: string },
    authority: CypherAuthority,
  ) {
    return this.#walletOperations.prepareTransfer(params, authority);
  }
  sendTransfer(
    params: { requestId: string; quoteId: string; password: string },
    authority: CypherAuthority,
  ) {
    return this.#walletOperations.sendTransfer(params, authority);
  }
  transfers(options: { limit?: number } = {}) {
    return this.#walletOperations.transfers(options);
  }
  close() {
    if (this.#close) {
      return this.#close;
    }
    // Cancel active IPC before joining its queue. Shutdown retains ownership of its process handle.
    this.#closed = true;
    this.#lifetime.abort();
    const tracking = this.#walletOperations.close();
    const stopped = this.#serialize(async () => {
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
    // Tracking publications can join this queue, so join tracking outside its stop callback.
    this.#close = (async () => {
      const outcomes = await Promise.allSettled([stopped, tracking]);
      for (const outcome of outcomes) {
        if (outcome.status === "rejected") {
          throw outcome.reason;
        }
      }
    })();
    return this.#close;
  }
}
