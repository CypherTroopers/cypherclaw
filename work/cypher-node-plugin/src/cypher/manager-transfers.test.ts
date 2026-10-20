import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CypherIpcError } from "./ipc.js";
import {
  A,
  B,
  HASH,
  REQUEST_ID,
  authority,
  deferred,
  createCypherManagerFixtures,
} from "./manager.test-support.js";

describe("Cypher wallet and transfer node owner", () => {
  const { fixture, cleanup } = createCypherManagerFixtures();
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubEnv("CYPHER_DATADIR", "/state/chaindbname");
  });
  afterEach(async () => {
    await cleanup();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("shows exact balances and authoritative lock state without changing the mining signer", async () => {
    const { manager, values, rpc } = fixture();
    values.eth_accounts = [A, B];
    values.personal_listWallets = [
      { status: "Locked", accounts: [{ address: A }] },
      { status: "Unlocked", accounts: [{ address: B }] },
      { status: "Closed" },
    ];
    values.eth_getBalance = "0xde0b6b3a7640001";
    await manager.connect(authority);
    await expect(manager.wallets({ offset: 1, limit: 1 })).resolves.toMatchObject({
      total: 2,
      wallets: [{ address: B, balance: "1.000000000000000001", locked: false }],
      finalitySupported: true,
    });
    expect(rpc.mock.calls.filter(([, method]) => method === "eth_getBalance")).toHaveLength(1);
    expect(rpc.mock.calls.some(([, method]) => method === "miner_setEtherbase")).toBe(false);
  });

  it("shows an empty wallet view without requesting an unavailable fresh-node etherbase", async () => {
    const { manager, values, rpc } = fixture();
    values.eth_accounts = [];
    values.personal_listWallets = [];
    await manager.connect(authority);
    const invoke = rpc.getMockImplementation()!;
    rpc.mockImplementation(async (endpoint, method, params, options) => {
      if (method === "eth_coinbase") {
        throw new CypherIpcError("No configured etherbase", -32000, true);
      }
      return invoke(endpoint, method, params, options);
    });
    await expect(manager.wallets()).resolves.toMatchObject({
      wallets: [],
      total: 0,
      readiness: { ready: false },
    });
    expect(rpc.mock.calls.some(([, method]) => method === "eth_coinbase")).toBe(false);
    await expect(manager.createAccount("fixture", authority)).resolves.toEqual({ address: A });
  });

  it("persists the confirmed hash before broadcasting, keeps precision, and replays without another send", async () => {
    const { manager, rpc, store, records } = fixture();
    await manager.connect(authority);
    const quote = await manager.prepareTransfer(
      { from: A, to: B, amount: "0.000000000000000001" },
      authority,
    );
    expect(quote).toMatchObject({
      value: "0x1",
      estimatedFee: "0.000021",
      total: "0.000021000000000001",
    });
    const invoke = rpc.getMockImplementation()!;
    rpc.mockImplementation(async (endpoint, method, params, options) => {
      if (method === "eth_sendRawTransaction") {
        expect(records.get(REQUEST_ID)).toMatchObject({
          hash: HASH,
          status: "unknown",
          from: A,
          to: B,
        });
      }
      return invoke(endpoint, method, params, options);
    });
    const params = { requestId: REQUEST_ID, quoteId: quote.quoteId, password: "fixture-password" };
    const sent = await manager.sendTransfer(params, authority);
    await expect(manager.sendTransfer(params, authority)).resolves.toEqual(sent);
    await expect(
      manager.sendTransfer(
        { ...params, quoteId: "22222222-2222-4222-8222-222222222222" },
        authority,
      ),
    ).rejects.toMatchObject({ code: "CYPHER_TRANSFER_CONFLICT" });
    expect(rpc.mock.calls.filter(([, method]) => method === "eth_sendRawTransaction")).toHaveLength(
      1,
    );
    expect(store.insert).toHaveBeenCalledOnce();
    expect(JSON.stringify([...records.values()])).not.toContain("fixture-password");
    expect(JSON.stringify([...records.values()])).not.toContain("0xabcd");
  });

  it.each(["nonce", "fees", "network"] as const)(
    "requires a fresh confirmation when %s changes",
    async (change) => {
      const { manager, values, rpc, records } = fixture();
      await manager.connect(authority);
      const quote = await manager.prepareTransfer({ from: A, to: B, amount: "0.1" }, authority);
      if (change === "network") {
        values.eth_getBlockByNumber = { hash: `0x${"c".repeat(64)}` };
      } else {
        values.eth_fillTransaction = {
          tx: {
            type: "0x0",
            to: B,
            value: quote.value,
            input: "0x",
            nonce: change === "nonce" ? "0x1" : "0x0",
            gas: "0x5208",
            gasPrice: change === "fees" ? "0x77359400" : "0x3b9aca00",
          },
        };
      }
      await expect(
        manager.sendTransfer(
          { requestId: REQUEST_ID, quoteId: quote.quoteId, password: "fixture" },
          authority,
        ),
      ).rejects.toMatchObject({
        code: change === "network" ? "CYPHER_NETWORK_CHANGED" : "CYPHER_QUOTE_CHANGED",
      });
      expect(
        rpc.mock.calls.some(
          ([, method]) =>
            method === "personal_signTransaction" || method === "eth_sendRawTransaction",
        ),
      ).toBe(false);
      expect(records.size).toBe(0);
    },
  );

  it.each([false, true])(
    "keeps an execution failure pending until finalized=%s",
    async (finalized) => {
      const { manager, values } = fixture();
      await manager.connect(authority);
      const quote = await manager.prepareTransfer({ from: A, to: B, amount: "0.1" }, authority);
      await manager.sendTransfer(
        { requestId: REQUEST_ID, quoteId: quote.quoteId, password: "fixture" },
        authority,
      );
      values.eth_getTransactionReceipt = {
        transactionHash: HASH,
        from: A,
        to: B,
        status: "0x0",
        blockNumber: "0x10",
        gasUsed: "0x5208",
        effectiveGasPrice: "0x3b9aca00",
      };
      values.eth_getTransactionFinality = finalized;
      await expect(manager.transfers()).resolves.toMatchObject({
        transfers: [
          {
            status: finalized ? "failed" : "included",
            errorCode: "CYPHER_EXECUTION_FAILED",
            actualFee: "0.000021",
          },
        ],
      });
    },
  );

  it("recovers a timed-out original hash after owner restart and never broadcasts during recovery", async () => {
    const first = fixture();
    await first.manager.connect(authority);
    const quote = await first.manager.prepareTransfer({ from: A, to: B, amount: "0.1" }, authority);
    const invoke = first.rpc.getMockImplementation()!;
    first.rpc.mockImplementation(async (endpoint, method, params, options) => {
      if (method === "eth_sendRawTransaction") {
        throw new CypherIpcError("Fixture timed out", "IPC_TIMEOUT", true);
      }
      return invoke(endpoint, method, params, options);
    });
    await expect(
      first.manager.sendTransfer(
        { requestId: REQUEST_ID, quoteId: quote.quoteId, password: "fixture" },
        authority,
      ),
    ).resolves.toMatchObject({ status: "unknown", hash: HASH });
    await first.manager.close();
    const recovered = fixture({ transferStore: first.store });
    recovered.values.eth_getTransactionReceipt = {
      transactionHash: HASH,
      from: A,
      to: B,
      status: "0x1",
      blockNumber: "0x10",
      gasUsed: "0x5208",
      effectiveGasPrice: "0x3b9aca00",
    };
    recovered.values.eth_getTransactionFinality = true;
    await expect(recovered.manager.transfers()).resolves.toMatchObject({
      transfers: [{ status: "complete", hash: HASH }],
    });
    expect(
      recovered.rpc.mock.calls.some(
        ([, method]) =>
          method === "eth_sendRawTransaction" || method === "personal_signTransaction",
      ),
    ).toBe(false);
  });

  it.each([
    ["IPC_CONNECTION", false],
    ["IPC_TIMEOUT", true],
  ] as const)("classifies %s with requestSent=%s without resending", async (code, requestSent) => {
    const { manager, rpc } = fixture();
    await manager.connect(authority);
    const quote = await manager.prepareTransfer({ from: A, to: B, amount: "0.1" }, authority);
    const invoke = rpc.getMockImplementation()!;
    rpc.mockImplementation(async (endpoint, method, params, options) => {
      if (method === "eth_sendRawTransaction") {
        throw new CypherIpcError("Fixture transport failure", code, requestSent);
      }
      return invoke(endpoint, method, params, options);
    });
    const params = { requestId: REQUEST_ID, quoteId: quote.quoteId, password: "fixture" };
    await expect(manager.sendTransfer(params, authority)).resolves.toMatchObject({
      status: requestSent ? "unknown" : "failed",
      errorCode: code,
    });
    await manager.sendTransfer(params, authority);
    expect(rpc.mock.calls.filter(([, method]) => method === "eth_sendRawTransaction")).toHaveLength(
      1,
    );
  });

  it("retains the original hash when outcome persistence fails after broadcast and replay does not repeat payment", async () => {
    const { manager, rpc, store, records } = fixture();
    await manager.connect(authority);
    const quote = await manager.prepareTransfer({ from: A, to: B, amount: "0.1" }, authority);
    const params = { requestId: REQUEST_ID, quoteId: quote.quoteId, password: "fixture" };
    store.update.mockRejectedValueOnce(new Error("fixture private disk error"));
    await expect(manager.sendTransfer(params, authority)).rejects.toMatchObject({
      code: "CYPHER_TRANSFER_TRACKING_UNAVAILABLE",
      message: expect.stringContaining(HASH),
    });
    expect(records.get(REQUEST_ID)).toMatchObject({ hash: HASH, status: "unknown" });
    await expect(manager.sendTransfer(params, authority)).resolves.toMatchObject({
      hash: HASH,
      status: "unknown",
    });
    expect(rpc.mock.calls.filter(([, method]) => method === "eth_sendRawTransaction")).toHaveLength(
      1,
    );
  });

  it("does not infer completion from a receipt when an older node has no finality API", async () => {
    const { manager, rpc, values } = fixture();
    await manager.connect(authority);
    const quote = await manager.prepareTransfer({ from: A, to: B, amount: "0.1" }, authority);
    await manager.sendTransfer(
      { requestId: REQUEST_ID, quoteId: quote.quoteId, password: "fixture" },
      authority,
    );
    values.eth_getTransactionReceipt = {
      transactionHash: HASH,
      from: A,
      to: B,
      status: "0x1",
      blockNumber: "0x10",
      gasUsed: "0x5208",
      effectiveGasPrice: "0x3b9aca00",
    };
    const invoke = rpc.getMockImplementation()!;
    rpc.mockImplementation(async (endpoint, method, params, options) => {
      if (method === "eth_getTransactionFinality") {
        throw new CypherIpcError("Unsupported", -32601, true);
      }
      return invoke(endpoint, method, params, options);
    });
    await expect(manager.transfers()).resolves.toMatchObject({
      transfers: [{ status: "included", finalitySupported: false }],
    });
  });

  it("rechecks caller authority after durable preparation before broadcasting", async () => {
    let current = true;
    const requestAuthority = {
      assertCurrent: () => {
        if (!current) {
          throw new Error("revoked");
        }
      },
    };
    const { manager, store, rpc } = fixture();
    await manager.connect(authority);
    const quote = await manager.prepareTransfer(
      { from: A, to: B, amount: "0.1" },
      requestAuthority,
    );
    const insert = store.insert.getMockImplementation()!;
    store.insert.mockImplementation(async (record, assertCurrent) => {
      const saved = await insert(record, assertCurrent);
      current = false;
      return saved;
    });
    await expect(
      manager.sendTransfer(
        { requestId: REQUEST_ID, quoteId: quote.quoteId, password: "fixture" },
        requestAuthority,
      ),
    ).resolves.toMatchObject({ status: "failed", errorCode: "CYPHER_AUTHORITY_REVOKED" });
    expect(rpc.mock.calls.some(([, method]) => method === "eth_sendRawTransaction")).toBe(false);
  });

  it("does not publish a recovered outcome after its owner closes during an awaited history read", async () => {
    const { manager, values, store, records } = fixture();
    await manager.connect(authority);
    const quote = await manager.prepareTransfer({ from: A, to: B, amount: "0.1" }, authority);
    await manager.sendTransfer(
      { requestId: REQUEST_ID, quoteId: quote.quoteId, password: "fixture" },
      authority,
    );
    values.eth_getTransactionReceipt = {
      transactionHash: HASH,
      from: A,
      to: B,
      status: "0x1",
      blockNumber: "0x10",
      gasUsed: "0x5208",
      effectiveGasPrice: "0x3b9aca00",
    };
    values.eth_getTransactionFinality = true;
    const entered = deferred<void>();
    const gate = deferred<void>();
    const get = store.get;
    store.get = async (requestId) => {
      entered.resolve();
      await gate.promise;
      return get(requestId);
    };
    store.update.mockClear();
    const tracking = manager.transfers();
    await entered.promise;
    const closed = manager.close();
    gate.resolve();
    await Promise.all([tracking, closed]);
    expect(store.update).not.toHaveBeenCalled();
    expect(records.get(REQUEST_ID)).toMatchObject({ status: "submitted" });
  });

  it("joins a blocked tracker before reporting a managed stop failure", async () => {
    const { manager, process, store } = fixture();
    await manager.start(authority);
    await manager.status();
    const quote = await manager.prepareTransfer({ from: A, to: B, amount: "0.1" }, authority);
    await manager.sendTransfer(
      { requestId: REQUEST_ID, quoteId: quote.quoteId, password: "fixture" },
      authority,
    );
    process.interrupt.mockImplementation(() => {});
    const entered = deferred<void>();
    const gate = deferred<void>();
    const list = store.list;
    store.list = async (options) => {
      if (options.pendingOnly) {
        entered.resolve();
        await gate.promise;
      }
      return list(options);
    };
    const tracking = manager.transfers();
    await entered.promise;
    let closed = false;
    const closing = manager.close();
    const failed = expect(closing).rejects.toThrow("left running");
    void closing.catch(() => {
      closed = true;
    });
    await vi.advanceTimersByTimeAsync(50);
    expect(closed).toBe(false);
    gate.resolve();
    await Promise.all([tracking, failed]);
    expect(closed).toBe(true);
  });
});
