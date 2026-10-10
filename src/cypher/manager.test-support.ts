import { vi } from "vitest";
import { callCypherIpc, CypherIpcError, type CypherRpcMethod } from "./ipc.js";
import { CypherNodeManager, type CypherAuthority, type CypherProcess } from "./manager.js";
import type { CypherTransferRecord, CypherTransferStore } from "./types.js";

export const A = `0x${"1".repeat(40)}`;
export const B = `0x${"2".repeat(40)}`;
export const GENESIS = `0x${"a".repeat(64)}`;
export const HASH = `0x${"b".repeat(64)}`;
export const REQUEST_ID = "11111111-1111-4111-8111-111111111111";
export const authority: CypherAuthority = { assertCurrent: () => {} };
type Options = NonNullable<ConstructorParameters<typeof CypherNodeManager>[0]>;
type StoreWrite = (
  record: CypherTransferRecord,
  assertCurrent?: () => void,
) => Promise<CypherTransferRecord>;

export function deferred<T>() {
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

export function createCypherManagerFixtures() {
  const fixtures: Array<{ manager: CypherNodeManager; process: FakeProcess }> = [];

  function fixture(options: Options = {}) {
    const process = new FakeProcess();
    const records = new Map<string, CypherTransferRecord>();
    const store = {
      get: async (id: string) => structuredClone(records.get(id) ?? null),
      insert: vi.fn<StoreWrite>(async (record, assertCurrent) => {
        assertCurrent?.();
        if (records.has(record.requestId)) {
          throw new Error("duplicate fixture request");
        }
        records.set(record.requestId, structuredClone(record));
        return structuredClone(record);
      }),
      update: vi.fn<StoreWrite>(async (record, assertCurrent) => {
        assertCurrent?.();
        records.set(record.requestId, structuredClone(record));
        return structuredClone(record);
      }),
      list: async ({
        nodeKey,
        limit = 100,
        pendingOnly,
      }: Parameters<CypherTransferStore["list"]>[0]) =>
        structuredClone(
          [...records.values()]
            .filter(
              (record) =>
                (!nodeKey || record.nodeKey === nodeKey) &&
                (!pendingOnly || (record.status !== "complete" && record.status !== "failed")),
            )
            .slice(0, limit),
        ),
    } satisfies CypherTransferStore;
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
      personal_listWallets: [{ status: "Locked", accounts: [{ address: A }] }],
      eth_getBalance: "0xde0b6b3a7640000",
      eth_getBlockByNumber: { hash: GENESIS },
      eth_getTransactionCount: "0x0",
      reconfig_fhsStatus: { enabled: true, role: "common" },
      eth_getTransactionFinality: false,
      eth_getTransactionReceipt: null,
      eth_getTransactionByHash: null,
      eth_sendRawTransaction: HASH,
      personal_getCommonRPCRewardAddress: {
        configured: true,
        signer: A,
        rewardRecipient: B,
        chainId: "0x9a24df",
        genesisHash: GENESIS,
      },
    };
    const rpc = vi.fn<typeof callCypherIpc>();
    rpc.mockImplementation(async (_endpoint, method, params, callOptions) => {
      callOptions?.assertCurrent?.();
      if (options.platform === "win32" && process.exited) {
        throw new CypherIpcError("IPC endpoint absent.", "ENOENT");
      }
      if (
        (method === "eth_fillTransaction" || method === "personal_signTransaction") &&
        values[method] === undefined
      ) {
        const transaction = params[0];
        if (!transaction || typeof transaction !== "object") {
          throw new Error("Invalid fixture transaction");
        }
        return {
          raw: "0xabcd",
          tx: {
            type: "0x0",
            nonce: "0x0",
            gas: "0x5208",
            gasPrice: "0x3b9aca00",
            input: "0x",
            hash: HASH,
            ...transaction,
          },
        };
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
      platform: "linux",
      arch: "x64",
      rootDir: "/bundled/cypher",
      rpc,
      launch,
      preflight,
      endpointExists,
      stopTimeoutMs: 50,
      transferStore: store,
      ...options,
    });
    fixtures.push({ manager, process });
    return { manager, process, rpc, values, launch, preflight, endpointExists, records, store };
  }

  async function cleanup() {
    for (const entry of fixtures.splice(0)) {
      if (!entry.process.exited) {
        entry.process.exit(0);
      }
      await entry.manager.close().catch(() => {});
    }
  }
  return { fixture, cleanup };
}
