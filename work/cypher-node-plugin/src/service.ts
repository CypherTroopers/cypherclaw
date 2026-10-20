import path from "node:path";
import { CypherNodeManager, CypherOperationError } from "./cypher/manager.js";
import type { CypherAuthority } from "./cypher/operations-contract.js";
import { CypherSqliteTransferStore } from "./cypher/transfer-store.js";
import { NativeInstaller } from "./native/index.js";
import { WalletGeneratorManager } from "./wallet-generator/manager.js";

type Owners = {
  installer: NativeInstaller;
  node: CypherNodeManager;
  wallet: WalletGeneratorManager;
  transfers: CypherSqliteTransferStore;
  signal: AbortSignal;
};

/** The plugin owns native resources; node and wallet generation remain separate owners. */
export class CypherPluginService {
  #owners: Owners | undefined;
  #lifetime: AbortController | undefined;
  #closing: Promise<void> | undefined;
  #cleanupFailed = false;
  #mutations: Promise<unknown> = Promise.resolve();

  constructor(readonly packageRoot: string) {}

  start(stateDir: string): void {
    if (this.#owners || this.#closing || this.#cleanupFailed) {
      throw new Error("The Cypher plugin service is already active or shutting down.");
    }
    const lifetime = new AbortController();
    const signal = lifetime.signal;
    this.#lifetime = lifetime;
    const installer = new NativeInstaller({ packageRoot: this.packageRoot, stateDir });
    const transfers = new CypherSqliteTransferStore(
      path.join(stateDir, "cypher", "transfers.sqlite"),
    );
    this.#mutations = Promise.resolve();
    this.#owners = {
      installer,
      node: new CypherNodeManager({
        assetDir: installer.nodeRoot,
        stateDir,
        transferStore: transfers,
      }),
      wallet: new WalletGeneratorManager(installer.walletRoot, signal),
      signal,
      transfers,
    };
  }

  /** Installation and native effects share a service generation and cannot overlap. */
  mutate<T>(owners: Owners, authority: CypherAuthority, task: () => Promise<T>): Promise<T> {
    const run = async () => {
      authority.assertCurrent();
      if (owners !== this.current()) {
        throw new Error("The Cypher plugin service changed.");
      }
      return await task();
    };
    const next = this.#mutations.then(run, run);
    this.#mutations = next.catch(() => undefined);
    return next;
  }

  async prepare(owners: Owners, authority: CypherAuthority) {
    const node = await owners.node.status();
    authority.assertCurrent();
    if (node.owned || node.connected || owners.wallet.active) {
      throw new CypherOperationError(
        "Stop or disconnect the Cypher node and finish wallet generation before preparing native components.",
      );
    }
    return await owners.installer.prepare(authority);
  }

  current(): Owners {
    if (!this.#owners || this.#owners.signal.aborted) {
      throw new Error("The Cypher plugin service is unavailable.");
    }
    return this.#owners;
  }

  async stop(): Promise<void> {
    if (this.#closing) {
      return await this.#closing;
    }
    const owners = this.#owners;
    this.#owners = undefined;
    this.#lifetime?.abort();
    this.#lifetime = undefined;
    if (!owners) {
      return;
    }
    this.#closing = (async () => {
      const results = await Promise.allSettled([
        owners.installer.close(),
        owners.wallet.close(),
        owners.node.close(),
        this.#mutations,
      ]);
      try {
        await owners.transfers.close();
      } catch (error) {
        results.push({ status: "rejected", reason: error });
      }
      if (results.some((result) => result.status === "rejected")) {
        this.#cleanupFailed = true;
        throw new Error(
          "Cypher cleanup did not finish. Check the node before restarting the plugin.",
        );
      }
    })();
    try {
      await this.#closing;
    } finally {
      this.#closing = undefined;
    }
  }
}
