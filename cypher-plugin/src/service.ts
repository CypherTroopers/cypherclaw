import path from "node:path";
import { CypherNodeManager } from "./cypher/manager.js";
import { WalletGeneratorManager } from "./wallet-generator/manager.js";

type Owners = {
  node: CypherNodeManager;
  wallet: WalletGeneratorManager;
  signal: AbortSignal;
};

/** The plugin owns native resources; node and wallet generation remain separate owners. */
export class CypherPluginService {
  #owners: Owners | undefined;
  #lifetime: AbortController | undefined;
  #closing: Promise<void> | undefined;
  #cleanupFailed = false;

  constructor(readonly packageRoot: string) {}

  start(stateDir: string): void {
    if (this.#owners || this.#closing || this.#cleanupFailed) {
      throw new Error("The Cypher plugin service is already active or shutting down.");
    }
    const lifetime = new AbortController();
    const signal = lifetime.signal;
    this.#lifetime = lifetime;
    this.#owners = {
      node: new CypherNodeManager({
        assetDir: path.join(this.packageRoot, "assets", "cypher"),
        stateDir,
      }),
      wallet: new WalletGeneratorManager(
        path.join(this.packageRoot, "assets", "wallet-generator"),
        signal,
      ),
      signal,
    };
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
      const results = await Promise.allSettled([owners.wallet.close(), owners.node.close()]);
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
