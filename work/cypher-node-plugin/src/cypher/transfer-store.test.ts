import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { CypherIpcError } from "./ipc.js";
import {
  A,
  B,
  HASH,
  REQUEST_ID,
  authority,
  createCypherManagerFixtures,
} from "./manager.test-support.js";
import { CypherSqliteTransferStore } from "./transfer-store.js";
import type { CypherTransferRecord } from "./types.js";

const original: CypherTransferRecord = {
  requestId: "transfer-one",
  quoteId: "quote-one",
  nodeKey: "fixture-node.ipc",
  network: {
    chainId: "0x9a249f",
    genesisHash: `0x${"a".repeat(64)}`,
    currency: "CLX",
    decimals: 18,
  },
  from: A,
  to: B,
  amount: "0.000000000000000001",
  value: "0x1",
  nonce: "0x0",
  gas: "0x5208",
  gasPrice: "0x1",
  estimatedFee: "0.000000000000021",
  hash: HASH,
  status: "unknown",
  finalitySupported: null,
  blockNumber: null,
  actualFee: null,
  errorCode: null,
  createdAt: 100,
  updatedAt: 100,
};

describe("Plugin transfer persistence across worker lifetimes", () => {
  let directory: string;
  const stores: CypherSqliteTransferStore[] = [];
  const { fixture, cleanup } = createCypherManagerFixtures();
  const open = (name: string) => {
    const store = new CypherSqliteTransferStore(path.join(directory, name));
    stores.push(store);
    return store;
  };
  beforeAll(async () => {
    // Standalone plugin fixtures cannot import host-internal test helpers; this suite owns its directory.
    directory = await mkdtemp(path.join(os.tmpdir(), "cypher-plugin-transfers-"));
  });
  afterEach(async () => {
    await cleanup();
    await Promise.all(stores.splice(0).map((store) => store.close()));
    vi.restoreAllMocks();
    vi.useRealTimers();
  });
  afterAll(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("keeps empty history noncreating and saves only the canonical transfer fields", async () => {
    const store = open("discovery.sqlite");
    expect(await store.get(original.requestId)).toBeNull();
    expect(await store.list({})).toEqual([]);
    expect(existsSync(store.filename)).toBe(false);
    const input = {
      ...original,
      password: "fixture-private-password",
      raw: "fixture-private-signed-bytes",
    };
    expect(await store.insert(input)).toEqual(original);
    expect(await store.insert(input)).toEqual(original);
    await store.close();
    const bytes = await readFile(store.filename);
    expect(bytes.includes(Buffer.from(input.password))).toBe(false);
    expect(bytes.includes(Buffer.from(input.raw))).toBe(false);
    const reopened = open("discovery.sqlite");
    expect(await reopened.get(original.requestId)).toEqual(original);
    expect(await reopened.list({ nodeKey: "another-node" })).toEqual([]);
  });

  it("refuses request rebinding and cannot regress a terminal payment", async () => {
    const store = open("binding.sqlite");
    await store.insert(original);
    await expect(store.insert({ ...original, to: A })).rejects.toThrow(
      "different signed transaction",
    );
    const complete = {
      ...original,
      status: "complete",
      finalitySupported: true,
      updatedAt: 200,
    } as const;
    expect(await store.update(complete)).toEqual(complete);
    expect(await store.update({ ...original, updatedAt: 300 })).toEqual(complete);
    expect(await store.list({ pendingOnly: true })).toEqual([]);
  });

  it("rechecks live authority after handing a write to the worker", async () => {
    const store = open("revoked.sqlite");
    let current = true;
    const inserting = store.insert(original, () => {
      if (!current) {
        throw new Error("revoked");
      }
    });
    current = false;
    await expect(inserting).rejects.toThrow("not authorized");
    expect(await store.get(original.requestId)).toBeNull();
  });

  it("recovers a durable uncertain send through the node owner without signing or broadcasting again", async () => {
    vi.useFakeTimers();
    const store = open("payment.sqlite");
    const first = fixture({ transferStore: store });
    await first.manager.connect(authority);
    const quote = await first.manager.prepareTransfer({ from: A, to: B, amount: "0.1" }, authority);
    const invoke = first.rpc.getMockImplementation()!;
    first.rpc.mockImplementation(async (endpoint, method, params, options) => {
      if (method === "eth_sendRawTransaction") {
        expect(await store.get(REQUEST_ID)).toMatchObject({ hash: HASH, status: "unknown" });
        throw new CypherIpcError("Fixture timeout", "IPC_TIMEOUT", true);
      }
      return invoke(endpoint, method, params, options);
    });
    const params = { requestId: REQUEST_ID, quoteId: quote.quoteId, password: "fixture-password" };
    await expect(first.manager.sendTransfer(params, authority)).resolves.toMatchObject({
      hash: HASH,
      status: "unknown",
    });
    await first.manager.close();
    await store.close();
    const recovered = fixture({ transferStore: open("payment.sqlite") });
    recovered.values.eth_getTransactionFinality = true;
    recovered.values.eth_getTransactionReceipt = {
      transactionHash: HASH,
      from: A,
      to: B,
      status: "0x1",
      blockNumber: "0x10",
      gasUsed: "0x5208",
      effectiveGasPrice: "0x3b9aca00",
    };
    await expect(recovered.manager.transfers()).resolves.toMatchObject({
      transfers: [{ hash: HASH, status: "complete", actualFee: "0.000021" }],
    });
    await expect(recovered.manager.sendTransfer(params, authority)).resolves.toMatchObject({
      hash: HASH,
      status: "complete",
    });
    expect(
      recovered.rpc.mock.calls.some(
        ([, method]) =>
          method === "personal_signTransaction" || method === "eth_sendRawTransaction",
      ),
    ).toBe(false);
  });
});
