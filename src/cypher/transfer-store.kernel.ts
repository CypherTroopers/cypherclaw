import type { DatabaseSync } from "node:sqlite";
import type { Insertable, Selectable } from "kysely";
import {
  executeSqliteQuerySync,
  executeSqliteQueryTakeFirstSync,
  getNodeSqliteKysely,
} from "../infra/kysely-sync.js";
import { getAdmittedSqliteSchemaFacts } from "../infra/sqlite-schema-facts.js";
import type { DB, CypherTransfers } from "../state/openclaw-state-db.generated.js";
import type { CypherTransferListOptions } from "./transfer-store.contract.js";
import type { CypherTransferRecord, CypherTransferStatus } from "./types.js";

const table = "cypher_transfers";
const query = (db: DatabaseSync) => getNodeSqliteKysely<Pick<DB, typeof table>>(db);
const statuses: readonly CypherTransferStatus[] = [
  "unknown",
  "submitted",
  "included",
  "complete",
  "failed",
];

function available(db: DatabaseSync): boolean {
  const facts = getAdmittedSqliteSchemaFacts(db);
  if (!facts) {
    throw new Error("Cypher transfer reads require an admitted state database");
  }
  return facts.tables.has(table);
}

function project(row: Selectable<CypherTransfers>): CypherTransferRecord {
  const status = statuses.find((candidate) => candidate === row.status);
  if (!status) {
    throw new Error("Cypher transfer record has an invalid outcome");
  }
  return {
    requestId: row.request_id,
    quoteId: row.quote_id,
    nodeKey: row.node_key,
    network: {
      chainId: row.chain_id,
      genesisHash: row.genesis_hash,
      currency: "CLX",
      decimals: 18,
    },
    from: row.from_address,
    to: row.to_address,
    amount: row.amount,
    value: row.value_hex,
    nonce: row.nonce_hex,
    gas: row.gas_hex,
    ...(row.gas_price_hex === null ? {} : { gasPrice: row.gas_price_hex }),
    ...(row.max_fee_per_gas_hex === null ? {} : { maxFeePerGas: row.max_fee_per_gas_hex }),
    ...(row.max_priority_fee_per_gas_hex === null
      ? {}
      : { maxPriorityFeePerGas: row.max_priority_fee_per_gas_hex }),
    estimatedFee: row.estimated_fee,
    hash: row.tx_hash,
    status,
    finalitySupported: row.finality_supported === null ? null : row.finality_supported === 1,
    blockNumber: row.block_number,
    actualFee: row.actual_fee,
    errorCode: row.error_code,
    createdAt: row.created_at_ms,
    updatedAt: row.updated_at_ms,
  };
}

function serialize(record: CypherTransferRecord): Insertable<CypherTransfers> {
  // Explicit columns keep caller extras, including signing credentials, out of the durable record.
  return {
    request_id: record.requestId,
    quote_id: record.quoteId,
    node_key: record.nodeKey,
    chain_id: record.network.chainId,
    genesis_hash: record.network.genesisHash,
    from_address: record.from,
    to_address: record.to,
    amount: record.amount,
    value_hex: record.value,
    nonce_hex: record.nonce,
    gas_hex: record.gas,
    gas_price_hex: record.gasPrice ?? null,
    max_fee_per_gas_hex: record.maxFeePerGas ?? null,
    max_priority_fee_per_gas_hex: record.maxPriorityFeePerGas ?? null,
    estimated_fee: record.estimatedFee,
    tx_hash: record.hash,
    status: record.status,
    finality_supported: record.finalitySupported === null ? null : record.finalitySupported ? 1 : 0,
    block_number: record.blockNumber,
    actual_fee: record.actualFee,
    error_code: record.errorCode,
    created_at_ms: record.createdAt,
    updated_at_ms: record.updatedAt,
  };
}

function sameBinding(left: CypherTransferRecord, right: CypherTransferRecord): boolean {
  return (
    left.requestId === right.requestId &&
    left.quoteId === right.quoteId &&
    left.nodeKey === right.nodeKey &&
    left.network.chainId === right.network.chainId &&
    left.network.genesisHash === right.network.genesisHash &&
    left.from === right.from &&
    left.to === right.to &&
    left.amount === right.amount &&
    left.value === right.value &&
    left.nonce === right.nonce &&
    left.gas === right.gas &&
    left.gasPrice === right.gasPrice &&
    left.maxFeePerGas === right.maxFeePerGas &&
    left.maxPriorityFeePerGas === right.maxPriorityFeePerGas &&
    left.estimatedFee === right.estimatedFee &&
    left.hash === right.hash &&
    left.createdAt === right.createdAt
  );
}

export function readCypherTransferInDatabase(
  db: DatabaseSync,
  requestId: string,
): CypherTransferRecord | null {
  if (!available(db)) {
    return null;
  }
  const row = executeSqliteQueryTakeFirstSync(
    db,
    query(db).selectFrom(table).selectAll().where("request_id", "=", requestId),
  );
  return row ? project(row) : null;
}

export function listCypherTransfersInDatabase(
  db: DatabaseSync,
  options: CypherTransferListOptions,
): CypherTransferRecord[] {
  if (!available(db)) {
    return [];
  }
  let select = query(db).selectFrom(table).selectAll();
  if (options.nodeKey !== undefined) {
    select = select.where("node_key", "=", options.nodeKey);
  }
  if (options.pendingOnly) {
    select = select.where("status", "not in", ["complete", "failed"]);
  }
  return executeSqliteQuerySync(
    db,
    select
      .orderBy("created_at_ms", "desc")
      .orderBy("request_id", "desc")
      .limit(Math.min(100, Math.max(1, options.limit ?? 100))),
  ).rows.map(project);
}

/** Called inside the canonical writer's synchronous transaction after first-use admission. */
export function writeCypherTransferInDatabase(
  db: DatabaseSync,
  record: CypherTransferRecord,
  mode: "insert" | "update",
): CypherTransferRecord {
  const current = readCypherTransferInDatabase(db, record.requestId);
  if (current) {
    if (!sameBinding(current, record)) {
      throw new Error("Cypher transfer request belongs to a different signed transaction");
    }
    // A delayed response cannot regress a confirmed result or replace a newer observation.
    if (
      mode === "insert" ||
      current.updatedAt > record.updatedAt ||
      current.status === "complete" ||
      current.status === "failed"
    ) {
      return current;
    }
    const updated = executeSqliteQueryTakeFirstSync(
      db,
      query(db)
        .updateTable(table)
        .set(serialize(record))
        .where("request_id", "=", record.requestId)
        .returningAll(),
    );
    if (!updated) {
      throw new Error("Cypher transfer outcome update did not settle");
    }
    return project(updated);
  }
  if (mode === "update") {
    throw new Error("The original Cypher transfer record is missing");
  }
  const inserted = executeSqliteQueryTakeFirstSync(
    db,
    query(db).insertInto(table).values(serialize(record)).returningAll(),
  );
  if (!inserted) {
    throw new Error("Cypher transfer record was not saved before broadcast");
  }
  return project(inserted);
}
