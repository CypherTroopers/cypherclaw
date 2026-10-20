import { Worker } from "node:worker_threads";
import type { CypherTransferListOptions } from "./transfer-store.contract.js";
import type {
  TransferStoreCommand,
  TransferStoreResponse,
  TransferStoreResult,
} from "./transfer-store.protocol.js";
import type { CypherTransferRecord, CypherTransferStore } from "./types.js";

type Pending = {
  assertCurrent?: () => void;
  resolve: (result: TransferStoreResult) => void;
  reject: (error: Error) => void;
};

/** One FIFO worker owns this plugin's transfer database; Gateway code never opens SQLite. */
export class CypherSqliteTransferStore implements CypherTransferStore {
  #worker: Worker | undefined;
  #exit: Promise<void> | undefined;
  #nextId = 0;
  #pending = new Map<number, Pending>();
  #closed = false;
  #closing: Promise<void> | undefined;
  #failed = false;

  constructor(readonly filename: string) {}

  #getWorker() {
    if (this.#failed) {
      throw new Error(
        "Cypher transfer storage stopped unexpectedly. Restart the plugin and check history before sending again.",
      );
    }
    if (this.#worker) {
      return this.#worker;
    }
    // Published plugins ship the compiled worker. Source tests consume that same built artifact.
    const url = new URL(
      import.meta.url.endsWith(".ts")
        ? "../../dist/transfer-store.worker.js"
        : "./transfer-store.worker.js",
      import.meta.url,
    );
    const worker = new Worker(url, { workerData: { filename: this.filename } });
    this.#worker = worker;
    const fail = () => {
      this.#failed = true;
      for (const pending of this.#pending.values()) {
        pending.reject(
          new Error(
            "Cypher transfer storage stopped unexpectedly. Check its durable history before retrying a payment.",
          ),
        );
      }
      this.#pending.clear();
    };
    worker.on("error", fail);
    this.#exit = new Promise<void>((resolve) =>
      worker.once("exit", () => {
        if (this.#pending.size || !this.#closed) {
          fail();
        }
        resolve();
      }),
    );
    worker.on("message", (message: TransferStoreResponse) => {
      const pending = this.#pending.get(message.id);
      if (!pending) {
        return;
      }
      if (message.type === "admission") {
        let grant = 2;
        try {
          pending.assertCurrent?.();
          grant = 1;
        } catch {
          // The worker rolls back; request failure cannot grant a persistence mutation.
        }
        const gate = new Int32Array(message.gate);
        Atomics.store(gate, 0, grant);
        Atomics.notify(gate, 0);
        return;
      }
      this.#pending.delete(message.id);
      if (message.type === "error") {
        pending.reject(new Error(message.message));
      } else {
        pending.resolve(message);
      }
      if (!this.#pending.size) {
        worker.unref();
      }
    });
    worker.unref();
    return worker;
  }

  #request(command: TransferStoreCommand, assertCurrent?: () => void) {
    if (this.#closed && command.type !== "close") {
      return Promise.reject(new Error("Cypher transfer storage is closed."));
    }
    assertCurrent?.();
    const worker = this.#getWorker();
    const id = ++this.#nextId;
    return new Promise<TransferStoreResult>((resolve, reject) => {
      this.#pending.set(id, { resolve, reject, assertCurrent });
      worker.ref();
      try {
        worker.postMessage({ id, command });
      } catch (error) {
        this.#pending.delete(id);
        if (!this.#pending.size) {
          worker.unref();
        }
        reject(error);
      }
    });
  }
  async get(requestId: string): Promise<CypherTransferRecord | null> {
    const reply = await this.#request({ type: "get", requestId });
    if (reply.command !== "get") {
      throw new Error("Unexpected Cypher transfer read response.");
    }
    return reply.result;
  }
  async list(options: CypherTransferListOptions): Promise<CypherTransferRecord[]> {
    const reply = await this.#request({ type: "list", options });
    if (reply.command !== "list") {
      throw new Error("Unexpected Cypher transfer history response.");
    }
    return reply.result;
  }
  async insert(
    record: CypherTransferRecord,
    assertCurrent?: () => void,
  ): Promise<CypherTransferRecord> {
    const reply = await this.#request({ type: "insert", record }, assertCurrent);
    if (reply.command !== "insert") {
      throw new Error("Unexpected Cypher transfer reservation response.");
    }
    return reply.result;
  }
  async update(
    record: CypherTransferRecord,
    assertCurrent?: () => void,
  ): Promise<CypherTransferRecord> {
    const reply = await this.#request({ type: "update", record }, assertCurrent);
    if (reply.command !== "update") {
      throw new Error("Unexpected Cypher transfer outcome response.");
    }
    return reply.result;
  }
  close(): Promise<void> {
    if (this.#closing) {
      return this.#closing;
    }
    this.#closed = true;
    this.#closing = (async () => {
      if (!this.#worker) {
        return;
      }
      await this.#request({ type: "close" });
      await this.#exit;
    })();
    return this.#closing;
  }
}
