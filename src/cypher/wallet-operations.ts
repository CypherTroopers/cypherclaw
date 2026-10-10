import { randomUUID } from "node:crypto";
import { isRecord } from "@openclaw/normalization-core/record-coerce";
import { CypherIpcError, type CypherTransactionArgs } from "./ipc.js";
import {
  booleanResult,
  CypherOperationError,
  isCypherAddress,
  type CypherAuthority,
  type CypherOperationOwner,
} from "./operations-contract.js";
import {
  cypherAmountUnits,
  cypherQuantity,
  filledCypherTransaction,
  formatCypherUnits,
  isCypherHash,
  quoteCypherFees,
  sameCypherTransaction,
} from "./transfer.js";
import type {
  CypherNetwork,
  CypherSubmissionReadiness,
  CypherTransferQuote,
  CypherTransferRecord,
  CypherTransferStore,
  CypherWallet,
  CypherWallets,
} from "./types.js";

/** Wallet operations share the node manager's queue, authority, endpoint, and lifetime. */
export class CypherWalletOperations {
  readonly #owner: CypherOperationOwner;
  readonly #storeOption: CypherTransferStore | undefined;
  #transferStore: Promise<CypherTransferStore> | undefined;
  readonly #quotes = new Map<
    string,
    { quote: CypherTransferQuote; nodeKey: string; transaction: CypherTransactionArgs }
  >();
  #trackingTimer: NodeJS.Timeout | undefined;
  #trackingStarted = false;
  #trackingTask: Promise<void> | undefined;
  #trackingOffset = 0;

  constructor(owner: CypherOperationOwner, transferStore?: CypherTransferStore) {
    this.#owner = owner;
    this.#storeOption = transferStore;
  }
  async #store() {
    return await (this.#transferStore ??= this.#storeOption
      ? Promise.resolve(this.#storeOption)
      : import("./transfer-store.js").then(({ createCypherTransferStore }) =>
          createCypherTransferStore(),
        ));
  }
  async #network(authority?: CypherAuthority): Promise<CypherNetwork> {
    const [chainId, block] = await Promise.all([
      this.#owner.call("eth_chainId", [], authority),
      this.#owner.call("eth_getBlockByNumber", ["0x0", false], authority),
    ]);
    if (!isRecord(block) || !isCypherHash(block.hash)) {
      throw new CypherOperationError("ColossusX returned an invalid network identity.");
    }
    return {
      chainId: cypherQuantity(chainId),
      genesisHash: block.hash.toLowerCase(),
      currency: "CLX",
      decimals: 18,
    };
  }
  async #readiness(authority?: CypherAuthority): Promise<CypherSubmissionReadiness> {
    const result = await this.#owner.call("reconfig_fhsStatus", [], authority);
    if (!isRecord(result) || typeof result.enabled !== "boolean") {
      throw new CypherOperationError(
        "ColossusX could not report its transaction admission requirements.",
      );
    }
    if (!result.enabled) {
      return { ready: true, reason: null };
    }
    if (result.role !== "common") {
      return {
        ready: false,
        reason:
          "FHS transfers must be submitted through a Common node. This node is a committee member or its role is unavailable.",
      };
    }
    const accounts = await this.#owner.call("eth_accounts", [], authority);
    if (!Array.isArray(accounts) || !accounts.length) {
      return {
        ready: false,
        reason:
          "Create a wallet and configure this Common node's signing account before sending transfers.",
      };
    }
    if (!isCypherAddress(await this.#owner.call("eth_coinbase", [], authority))) {
      return {
        ready: false,
        reason: "Configure this Common node's signing account before sending transfers.",
      };
    }
    return {
      ready: true,
      reason:
        "This Common node can attempt submission. Its native admission service confirms availability when the transfer is submitted.",
    };
  }
  async #finalitySupported(authority?: CypherAuthority) {
    try {
      return (
        typeof (await this.#owner.call(
          "eth_getTransactionFinality",
          [`0x${"0".repeat(64)}`],
          authority,
        )) === "boolean"
      );
    } catch (error) {
      if (error instanceof CypherIpcError && error.code === -32601) {
        return false;
      }
      throw error;
    }
  }
  wallets(options: { offset?: number; limit?: number } = {}): Promise<CypherWallets> {
    this.startTracking();
    return this.#owner.serialize(async () => {
      if (!this.#owner.isConnected()) {
        throw new CypherOperationError("Connect to ColossusX IPC to view this node's wallets.");
      }
      const [network, value, accounts, readiness, finalitySupported] = await Promise.all([
        this.#network(),
        this.#owner.call("personal_listWallets", []),
        this.#owner.call("eth_accounts", []),
        this.#readiness(),
        this.#finalitySupported(),
      ]);
      if (
        !Array.isArray(value) ||
        value.length > 1024 ||
        !Array.isArray(accounts) ||
        accounts.length > 1024 ||
        !accounts.every(isCypherAddress)
      ) {
        throw new CypherOperationError("ColossusX returned an invalid wallet list.");
      }
      const locks = new Map<string, boolean | null>();
      for (const wallet of value) {
        if (
          !isRecord(wallet) ||
          (wallet.accounts !== undefined &&
            (!Array.isArray(wallet.accounts) || wallet.accounts.length > 1024))
        ) {
          throw new CypherOperationError("ColossusX returned an invalid wallet status.");
        }
        for (const account of wallet.accounts ?? []) {
          if (!isRecord(account) || !isCypherAddress(account.address)) {
            throw new CypherOperationError("ColossusX returned an invalid wallet account.");
          }
          locks.set(
            account.address.toLowerCase(),
            wallet.status === "Locked" ? true : wallet.status === "Unlocked" ? false : null,
          );
        }
      }
      const offset = options.offset ?? 0;
      const limit = options.limit ?? 20;
      const selected = accounts.slice(offset, offset + limit);
      const wallets: CypherWallet[] = [];
      for (let start = 0; start < selected.length; start += 4) {
        wallets.push(
          ...(await Promise.all(
            selected.slice(start, start + 4).map(async (address) => {
              const balanceWei = cypherQuantity(
                await this.#owner.call("eth_getBalance", [address, "latest"]),
              );
              return {
                address,
                balanceWei,
                balance: formatCypherUnits(BigInt(balanceWei)),
                locked: locks.get(address.toLowerCase()) ?? null,
              };
            }),
          )),
        );
      }
      return {
        network,
        wallets,
        total: accounts.length,
        offset,
        limit,
        readiness,
        finalitySupported,
      };
    });
  }
  async #prepareTransaction(
    params: { from: string; to: string; amount: string },
    network: CypherNetwork,
    authority: CypherAuthority,
  ) {
    await this.#owner.requireAccount(params.from, authority);
    const value = `0x${cypherAmountUnits(params.amount).toString(16)}`;
    const transaction = filledCypherTransaction(
      await this.#owner.call(
        "eth_fillTransaction",
        [{ from: params.from, to: params.to, value, chainId: network.chainId }],
        authority,
      ),
      { from: params.from, to: params.to, value, chainId: network.chainId },
    );
    const balance = BigInt(
      cypherQuantity(await this.#owner.call("eth_getBalance", [params.from, "latest"], authority)),
    );
    const fees = quoteCypherFees(transaction);
    if (
      balance <
      BigInt(value) +
        BigInt(transaction.gas!) * BigInt(transaction.gasPrice ?? transaction.maxFeePerGas!)
    ) {
      throw new CypherOperationError(
        "The wallet balance does not cover the amount and maximum transaction fee.",
        "CYPHER_INSUFFICIENT_BALANCE",
      );
    }
    return { transaction, fees };
  }
  prepareTransfer(
    params: { from: string; to: string; amount: string },
    authority: CypherAuthority,
  ): Promise<CypherTransferQuote> {
    this.startTracking();
    return this.#owner.operation(authority, async () => {
      await this.#owner.requireConnected(authority);
      const readiness = await this.#readiness(authority);
      if (!readiness.ready) {
        throw new CypherOperationError(readiness.reason!, "CYPHER_ADMISSION_REQUIRED");
      }
      const network = await this.#network(authority);
      const { transaction, fees } = await this.#prepareTransaction(params, network, authority);
      const quote: CypherTransferQuote = {
        quoteId: randomUUID(),
        network,
        from: params.from,
        to: params.to,
        amount: formatCypherUnits(BigInt(transaction.value)),
        value: transaction.value,
        nonce: transaction.nonce!,
        gas: transaction.gas!,
        ...(transaction.gasPrice ? { gasPrice: transaction.gasPrice } : {}),
        ...(transaction.maxFeePerGas
          ? {
              maxFeePerGas: transaction.maxFeePerGas,
              maxPriorityFeePerGas: transaction.maxPriorityFeePerGas,
            }
          : {}),
        ...fees,
        expiresAt: Date.now() + 120_000,
      };
      const nodeKey = (await this.#owner.resolvePaths()).ipcPath;
      for (const [id, prepared] of this.#quotes) {
        if (prepared.quote.expiresAt <= Date.now()) {
          this.#quotes.delete(id);
        }
      }
      if (this.#quotes.size >= 100) {
        this.#quotes.delete(this.#quotes.keys().next().value!);
      }
      this.#quotes.set(quote.quoteId, { quote, transaction, nodeKey });
      return structuredClone(quote);
    });
  }
  sendTransfer(
    params: { requestId: string; quoteId: string; password: string },
    authority: CypherAuthority,
  ): Promise<CypherTransferRecord> {
    this.startTracking();
    return this.#owner.operation(authority, async () => {
      const store = await this.#store();
      const nodeKey = (await this.#owner.resolvePaths()).ipcPath;
      const existing = await store.get(params.requestId);
      if (existing) {
        if (existing.quoteId !== params.quoteId || existing.nodeKey !== nodeKey) {
          throw new CypherOperationError(
            "This request ID belongs to another confirmed transfer.",
            "CYPHER_TRANSFER_CONFLICT",
          );
        }
        return existing;
      }
      await this.#owner.requireConnected(authority);
      const prepared = this.#quotes.get(params.quoteId);
      if (!prepared || prepared.nodeKey !== nodeKey || prepared.quote.expiresAt <= Date.now()) {
        throw new CypherOperationError(
          "The transfer confirmation expired. Prepare and review the transfer again.",
          "CYPHER_QUOTE_EXPIRED",
        );
      }
      const { quote, transaction } = prepared;
      const network = await this.#network(authority);
      if (
        network.chainId !== quote.network.chainId ||
        network.genesisHash !== quote.network.genesisHash
      ) {
        throw new CypherOperationError(
          "The connected network changed. Prepare and review the transfer again.",
          "CYPHER_NETWORK_CHANGED",
        );
      }
      const readiness = await this.#readiness(authority);
      if (!readiness.ready) {
        throw new CypherOperationError(readiness.reason!, "CYPHER_ADMISSION_REQUIRED");
      }
      const fresh = await this.#prepareTransaction(quote, network, authority);
      if (!sameCypherTransaction(transaction, fresh.transaction) || Date.now() >= quote.expiresAt) {
        throw new CypherOperationError(
          "The nonce or transaction fee changed. Prepare and review the transfer again.",
          "CYPHER_QUOTE_CHANGED",
        );
      }
      const pending = await store.list({ nodeKey, pendingOnly: true, limit: 100 });
      if (pending.length >= 100) {
        throw new CypherOperationError(
          "One hundred transfers are still being confirmed. Check their results before submitting another transfer.",
          "CYPHER_PENDING_LIMIT",
        );
      }
      if (
        pending.some(
          (record) =>
            record.network.chainId === network.chainId &&
            record.network.genesisHash === network.genesisHash &&
            record.from.toLowerCase() === quote.from.toLowerCase() &&
            record.nonce === quote.nonce,
        )
      ) {
        throw new CypherOperationError(
          "Another transfer with this wallet nonce is still being confirmed. Check its original transaction first.",
          "CYPHER_NONCE_PENDING",
        );
      }
      const signed = await this.#owner.call(
        "personal_signTransaction",
        [transaction, params.password],
        authority,
      );
      if (
        !isRecord(signed) ||
        !isRecord(signed.tx) ||
        !isCypherHash(signed.tx.hash) ||
        typeof signed.raw !== "string" ||
        !/^0x(?:[0-9a-fA-F]{2}){1,32768}$/.test(signed.raw) ||
        !sameCypherTransaction(
          transaction,
          filledCypherTransaction(signed, {
            from: quote.from,
            to: quote.to,
            value: quote.value,
            chainId: network.chainId,
          }),
        ) ||
        cypherQuantity(signed.tx.chainId) !== network.chainId
      ) {
        throw new CypherOperationError(
          "ColossusX returned a signed transaction that does not match the confirmed transfer.",
        );
      }
      const latestNetwork = await this.#network(authority);
      if (
        latestNetwork.chainId !== network.chainId ||
        latestNetwork.genesisHash !== network.genesisHash
      ) {
        throw new CypherOperationError(
          "The connected network changed before submission.",
          "CYPHER_NETWORK_CHANGED",
        );
      }
      if (
        Date.now() >= quote.expiresAt ||
        cypherQuantity(
          await this.#owner.call("eth_getTransactionCount", [quote.from, "pending"], authority),
        ) !== quote.nonce
      ) {
        throw new CypherOperationError(
          "The confirmation expired or another application used this nonce. Prepare and review the transfer again.",
          "CYPHER_QUOTE_CHANGED",
        );
      }
      this.#owner.assert(authority);
      const { expiresAt: _expiresAt, total: _total, ...recordQuote } = quote;
      let record: CypherTransferRecord = {
        ...recordQuote,
        requestId: params.requestId,
        nodeKey,
        hash: signed.tx.hash.toLowerCase(),
        status: "unknown",
        finalitySupported: null,
        blockNumber: null,
        actualFee: null,
        errorCode: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      record = await store.insert(record, () => this.#owner.assert(authority));
      this.#quotes.delete(params.quoteId);
      try {
        const hash = await this.#owner.call("eth_sendRawTransaction", [signed.raw], authority);
        if (!isCypherHash(hash) || hash.toLowerCase() !== record.hash) {
          throw new CypherOperationError(
            "ColossusX returned a different transaction hash.",
            "CYPHER_SUBMISSION_UNKNOWN",
          );
        }
        record = { ...record, status: "submitted", updatedAt: Date.now() };
      } catch (error) {
        const errorCode =
          error instanceof CypherIpcError || error instanceof CypherOperationError
            ? String(error.code)
            : "CYPHER_SUBMISSION_UNKNOWN";
        const rejected =
          errorCode === "CYPHER_ADMISSION_REQUIRED" ||
          errorCode === "CYPHER_AUTHORITY_REVOKED" ||
          (error instanceof CypherIpcError && !error.requestSent);
        record = {
          ...record,
          status: rejected ? "failed" : "unknown",
          errorCode,
          updatedAt: Date.now(),
        };
      }
      try {
        record = await store.update(record);
      } catch {
        this.#scheduleTracking();
        throw new CypherOperationError(
          `The original transaction hash ${record.hash} is saved, but its latest submission result could not be saved. Inspect this transfer in history before retrying; do not repeat the payment.`,
          "CYPHER_TRANSFER_TRACKING_UNAVAILABLE",
        );
      }
      this.#scheduleTracking();
      return record;
    });
  }
  async transfers(
    options: { limit?: number } = {},
  ): Promise<{ transfers: CypherTransferRecord[] }> {
    this.startTracking();
    const store = await this.#store();
    const nodeKey = (await this.#owner.resolvePaths()).ipcPath;
    await this.#reconcilePending();
    return { transfers: await store.list({ nodeKey, limit: options.limit ?? 50 }) };
  }
  startTracking() {
    if (this.#trackingStarted || this.#owner.isClosed()) {
      return;
    }
    this.#trackingStarted = true;
    this.#scheduleTracking();
  }
  #scheduleTracking() {
    if (this.#trackingTimer || this.#owner.isClosed()) {
      return;
    }
    this.#trackingTimer = setTimeout(() => {
      this.#trackingTimer = undefined;
      void this.#reconcilePending()
        .catch(() => undefined)
        .finally(() => this.#scheduleTracking());
    }, 15_000);
    this.#trackingTimer.unref();
  }
  #reconcilePending(): Promise<void> {
    return (this.#trackingTask ??= this.#trackPending().finally(() => {
      this.#trackingTask = undefined;
    }));
  }
  async #trackPending() {
    if (this.#owner.isClosed()) {
      return;
    }
    const store = await this.#store();
    const nodeKey = (await this.#owner.resolvePaths()).ipcPath;
    const pending = await store.list({ nodeKey, limit: 100, pendingOnly: true });
    if (!pending.length) {
      return;
    }
    let network: CypherNetwork;
    try {
      network = await this.#network();
    } catch {
      return;
    }
    const start = this.#trackingOffset % pending.length;
    const batch = [...pending.slice(start), ...pending.slice(0, start)].slice(0, 4);
    this.#trackingOffset = (start + batch.length) % pending.length;
    await Promise.all(
      batch.map(async (record) => {
        if (this.#owner.isClosed()) {
          return;
        }
        if (
          record.network.chainId !== network.chainId ||
          record.network.genesisHash !== network.genesisHash
        ) {
          return;
        }
        try {
          let receipt = await this.#owner.call("eth_getTransactionReceipt", [record.hash]);
          let finalitySupported: boolean;
          let finalized = false;
          try {
            finalized = booleanResult(
              await this.#owner.call("eth_getTransactionFinality", [record.hash]),
            );
            finalitySupported = true;
          } catch (error) {
            if (!(error instanceof CypherIpcError) || error.code !== -32601) {
              throw error;
            }
            finalitySupported = false;
          }
          if (finalized) {
            receipt = await this.#owner.call("eth_getTransactionReceipt", [record.hash]);
          }
          let updated = { ...record, finalitySupported, updatedAt: Date.now() };
          if (receipt === null) {
            const tx = await this.#owner.call("eth_getTransactionByHash", [record.hash]);
            updated = {
              ...updated,
              status:
                isRecord(tx) && isCypherHash(tx.hash) && tx.hash.toLowerCase() === record.hash
                  ? "submitted"
                  : "unknown",
              blockNumber: null,
              actualFee: null,
            };
          } else {
            if (
              !isRecord(receipt) ||
              !isCypherHash(receipt.transactionHash) ||
              receipt.transactionHash.toLowerCase() !== record.hash ||
              typeof receipt.from !== "string" ||
              receipt.from.toLowerCase() !== record.from.toLowerCase() ||
              typeof receipt.to !== "string" ||
              receipt.to.toLowerCase() !== record.to.toLowerCase()
            ) {
              throw new CypherOperationError(
                "ColossusX returned an unrelated transaction receipt.",
              );
            }
            const status = cypherQuantity(receipt.status);
            if (status !== "0x0" && status !== "0x1") {
              throw new CypherOperationError("ColossusX returned an invalid transaction outcome.");
            }
            updated = {
              ...updated,
              status: finalized ? (status === "0x1" ? "complete" : "failed") : "included",
              blockNumber: cypherQuantity(receipt.blockNumber),
              actualFee: formatCypherUnits(
                BigInt(cypherQuantity(receipt.gasUsed)) *
                  BigInt(cypherQuantity(receipt.effectiveGasPrice)),
              ),
              errorCode: status === "0x0" ? "CYPHER_EXECUTION_FAILED" : null,
            };
          }
          await this.#owner.serialize(async () => {
            if (this.#owner.isClosed()) {
              return;
            }
            const current = await store.get(record.requestId);
            if (!current || current.status === "complete" || current.status === "failed") {
              return;
            }
            // A concurrent accepted submission must not be overwritten by an earlier absent lookup.
            if (
              updated.status === "unknown" &&
              (current.updatedAt !== record.updatedAt || current.status !== record.status)
            ) {
              return;
            }
            const assertCurrent = () => {
              if (this.#owner.isClosed()) {
                throw new CypherOperationError("The ColossusX Gateway owner has closed.");
              }
            };
            assertCurrent();
            await store.update({ ...current, ...updated }, assertCurrent);
          });
        } catch {
          // An unavailable endpoint leaves the durable original hash pending; recovery never broadcasts.
        }
      }),
    );
  }
  close(): Promise<void> {
    if (this.#trackingTimer) {
      clearTimeout(this.#trackingTimer);
      this.#trackingTimer = undefined;
    }
    this.#quotes.clear();
    return this.#trackingTask ?? Promise.resolve();
  }
}
