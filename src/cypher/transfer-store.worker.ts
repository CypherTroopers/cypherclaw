import { requestSqliteWorkerOperationAdmission } from "../infra/sqlite-worker-operation-admission.js";
import { createOpenClawStateSchemaEnsurer } from "../state/openclaw-state-feature-schema-ensure.js";
import type { WorkerWriteOperationContext } from "../state/worker-operation-registry.js";
import { writeCypherTransferInDatabase } from "./transfer-store.kernel.js";
import type { CypherTransferRecord } from "./types.js";

const ensureSchema = createOpenClawStateSchemaEnsurer({
  table: "cypher_transfers",
  indexes: ["idx_cypher_transfers_node_created"],
  endMarker: "ON cypher_transfers(node_key, created_at_ms DESC, request_id);\n",
  operationLabel: "cypherTransfers.schema.ensure",
});

function writeCypherTransfer(
  type: "cypherTransfers.insert" | "cypherTransfers.update",
  record: CypherTransferRecord,
  context: WorkerWriteOperationContext,
): CypherTransferRecord {
  ensureSchema({ ...context.stateOptions(), database: context.open() });
  return context.write(
    ({ db }) => {
      requestSqliteWorkerOperationAdmission({ stage: "transaction", facts: undefined });
      const written = writeCypherTransferInDatabase(
        db,
        record,
        type === "cypherTransfers.insert" ? "insert" : "update",
      );
      requestSqliteWorkerOperationAdmission({ stage: "commit", facts: undefined });
      return written;
    },
    { operationLabel: type },
  );
}

export const cypherTransferOperations = {
  "cypherTransfers.insert": (input: CypherTransferRecord, context: WorkerWriteOperationContext) =>
    writeCypherTransfer("cypherTransfers.insert", input, context),
  "cypherTransfers.update": (input: CypherTransferRecord, context: WorkerWriteOperationContext) =>
    writeCypherTransfer("cypherTransfers.update", input, context),
};
