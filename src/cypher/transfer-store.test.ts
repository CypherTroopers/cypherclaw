import { existsSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeOpenClawStateDatabaseAsync } from "../state/openclaw-state-db-cache.js";
import {
  createOpenClawTestState,
  type OpenClawTestState,
} from "../test-utils/openclaw-test-state.js";
import { createCypherTransferStore } from "./transfer-store.js";
import type { CypherTransferRecord } from "./types.js";

const original: CypherTransferRecord = {
  requestId: "transfer-fixture-one",
  quoteId: "quote-fixture-one",
  nodeKey: "fixture-node.ipc",
  network: {
    chainId: "0x9a249f",
    genesisHash: `0x${"a".repeat(64)}`,
    currency: "CLX",
    decimals: 18,
  },
  from: `0x${"1".repeat(40)}`,
  to: `0x${"2".repeat(40)}`,
  amount: "0.000000000000000001",
  value: "0x1",
  nonce: "0x0",
  gas: "0x5208",
  gasPrice: "0x1",
  estimatedFee: "0.000000000000021",
  hash: `0x${"3".repeat(64)}`,
  status: "unknown",
  finalitySupported: null,
  blockNumber: null,
  actualFee: null,
  errorCode: null,
  createdAt: 100,
  updatedAt: 100,
};

describe("Cypher transfer durable custody", () => {
  let state: OpenClawTestState;
  let databasePath: string;
  beforeAll(async () => {
    state = await createOpenClawTestState({ prefix: "cypher-transfer-store-", applyEnv: true });
    databasePath = state.statePath("state", "openclaw.sqlite");
  });
  afterAll(async () => {
    await closeOpenClawStateDatabaseAsync();
    await state.cleanup();
  });

  it("keeps discovery noncreating and recovers the original send after reopening", async () => {
    const store = createCypherTransferStore({ path: databasePath, env: state.env });
    expect(await store.get(original.requestId)).toBeNull();
    expect(await store.list({ pendingOnly: true })).toEqual([]);
    expect(existsSync(databasePath)).toBe(false);
    expect(await store.insert(original)).toEqual(original);
    expect(await store.insert(original)).toEqual(original);
    await closeOpenClawStateDatabaseAsync();
    const reopened = createCypherTransferStore({ path: databasePath, env: state.env });
    expect(await reopened.get(original.requestId)).toEqual(original);
    expect(await reopened.list({ nodeKey: original.nodeKey, pendingOnly: true })).toEqual([
      original,
    ]);
    expect(await reopened.list({ nodeKey: "another-node.ipc" })).toEqual([]);
  });

  it("refuses rebinding a request and cannot regress a completed payment", async () => {
    const store = createCypherTransferStore({ path: databasePath, env: state.env });
    const payment = { ...original, requestId: "completed-payment", quoteId: "completed-quote" };
    await store.insert(payment);
    await expect(store.insert({ ...payment, to: `0x${"4".repeat(40)}` })).rejects.toThrow(
      "different signed transaction",
    );
    const completed: CypherTransferRecord = {
      ...payment,
      status: "complete",
      finalitySupported: true,
      blockNumber: "0x2a",
      actualFee: original.estimatedFee,
      updatedAt: 200,
    };
    expect(await store.update(completed)).toEqual(completed);
    expect(await store.update({ ...payment, updatedAt: 300 })).toEqual(completed);
    expect(
      (await store.list({ pendingOnly: true })).some((row) => row.requestId === payment.requestId),
    ).toBe(false);
    expect(await store.get(payment.requestId)).toEqual(completed);
  });

  it("revoked write authority leaves no signed-send record", async () => {
    const store = createCypherTransferStore({ path: databasePath, env: state.env });
    const denied = { ...original, requestId: "revoked-send", quoteId: "revoked-quote" };
    await expect(
      store.insert(denied, () => {
        throw new Error("caller revoked");
      }),
    ).rejects.toThrow("caller revoked");
    expect(await store.get(denied.requestId)).toBeNull();
  });
});
