import { getAdmittedSqliteSchemaFacts } from "../infra/sqlite-schema-facts.js";
import { extractSqliteTableSchema } from "../infra/sqlite-schema-sql.js";
import type { SqliteWorkerCommand } from "../infra/sqlite-worker-contract.js";
import { requestSqliteWorkerOperationAdmission } from "../infra/sqlite-worker-operation-admission.js";
import type { OpenClawStateDatabaseOptions } from "../state/openclaw-state-db-contract.js";
import { runOpenClawStateWriteTransaction } from "../state/openclaw-state-db.js";
import { OPENCLAW_STATE_SCHEMA_SQL } from "../state/openclaw-state-schema.js";
import type { CypherTransferWriteOperations } from "./transfer-store.contract.js";
import { writeCypherTransferInDatabase } from "./transfer-store.kernel.js";
import type { CypherTransferRecord } from "./types.js";

export function executeCypherTransferCommand(
  command: SqliteWorkerCommand<CypherTransferWriteOperations>,
  options: OpenClawStateDatabaseOptions,
): CypherTransferRecord {
  return runOpenClawStateWriteTransaction(
    ({ db }) => {
      requestSqliteWorkerOperationAdmission({ stage: "transaction", facts: undefined });
      const facts = getAdmittedSqliteSchemaFacts(db);
      if (!facts) {
        throw new Error("Cypher transfer writes require an admitted state database");
      }
      if (!facts.tables.has("cypher_transfers")) {
        // sqlite-allow-raw: Canonical feature-local first-use DDL; row access uses Kysely.
        db.exec(
          extractSqliteTableSchema(OPENCLAW_STATE_SCHEMA_SQL, "cypher_transfers", {
            endMarker: "ON cypher_transfers(node_key, created_at_ms DESC, request_id);",
          }),
        );
      }
      const record = writeCypherTransferInDatabase(
        db,
        command.input,
        command.type === "cypherTransfers.insert" ? "insert" : "update",
      );
      requestSqliteWorkerOperationAdmission({ stage: "commit", facts: undefined });
      return record;
    },
    options,
    { operationLabel: command.type },
  );
}
