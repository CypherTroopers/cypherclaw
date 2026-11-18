import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeOpenClawStateDatabaseAsync } from "../state/openclaw-state-db-cache.js";
import { createOpenClawStateSchemaEnsurer } from "../state/openclaw-state-feature-schema-ensure.js";
import { openOpenClawStateDatabase } from "../state/openclaw-state-db.js";
import {
  createOpenClawTestState,
  type OpenClawTestState,
} from "../test-utils/openclaw-test-state.js";
import {
  listCypherTransfersInDatabase,
  readCypherTransferInDatabase,
  writeCypherTransferInDatabase,
} from "./transfer-store.kernel.js";
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
  const ensureSchema = createOpenClawStateSchemaEnsurer({
    table: "cypher_transfers",
    indexes: ["idx_cypher_transfers_node_created"],
    endMarker: "ON cypher_transfers(node_key, created_at_ms DESC, request_id);\n",
    operationLabel: "cypherTransfers.schema.ensure",
  });

  beforeAll(async () => {
    state = await createOpenClawTestState({ prefix: "cypher-transfer-store-", applyEnv: true });
  });

  afterAll(async () => {
    await closeOpenClawStateDatabaseAsync();
    await state.cleanup();
  });

  it("keeps discovery noncreating and recovers the original send after reopening", async () => {
    ensureSchema({ env: state.env });
    const { db } = openOpenClawStateDatabase({ env: state.env });
    expect(readCypherTransferInDatabase(db, original.requestId)).toBeNull();
    expect(listCypherTransfersInDatabase(db, { pendingOnly: true })).toEqual([]);
    expect(writeCypherTransferInDatabase(db, original, "insert")).toEqual(original);
    expect(writeCypherTransferInDatabase(db, original, "insert")).toEqual(original);
    await closeOpenClawStateDatabaseAsync();
    const reopened = openOpenClawStateDatabase({ env: state.env });
    expect(readCypherTransferInDatabase(reopened.db, original.requestId)).toEqual(original);
    expect(
      listCypherTransfersInDatabase(reopened.db, {
        nodeKey: original.nodeKey,
        pendingOnly: true,
      }),
    ).toEqual([original]);
    expect(listCypherTransfersInDatabase(reopened.db, { nodeKey: "another-node.ipc" })).toEqual([]);
  });

  it("refuses rebinding a request and cannot regress a completed payment", () => {
    ensureSchema({ env: state.env });
    const { db } = openOpenClawStateDatabase({ env: state.env });
    const payment = { ...original, requestId: "completed-payment", quoteId: "completed-quote" };
    writeCypherTransferInDatabase(db, payment, "insert");
    expect(() =>
      writeCypherTransferInDatabase(db, { ...payment, to: `0x${"4".repeat(40)}` }, "insert"),
    ).toThrow("different signed transaction");
    const completed: CypherTransferRecord = {
      ...payment,
      status: "complete",
      finalitySupported: true,
      blockNumber: "0x2a",
      actualFee: original.estimatedFee,
      updatedAt: 200,
    };
    expect(writeCypherTransferInDatabase(db, completed, "update")).toEqual(completed);
    expect(writeCypherTransferInDatabase(db, { ...payment, updatedAt: 300 }, "update")).toEqual(
      completed,
    );
    expect(
      listCypherTransfersInDatabase(db, { pendingOnly: true }).some(
        (row) => row.requestId === payment.requestId,
      ),
    ).toBe(false);
    expect(readCypherTransferInDatabase(db, payment.requestId)).toEqual(completed);
  });
});
