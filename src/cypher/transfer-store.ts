import { createSqliteWorkerOperationAdmission } from "../infra/sqlite-worker-operation-admission.js";
import type { OpenClawStateDatabaseOptions } from "../state/openclaw-state-db-contract.js";
import { executeExistingOpenClawStateRead } from "../state/openclaw-state-db-readonly.js";
import { captureOpenClawStateWorkerContext } from "../state/openclaw-state-worker-context.js";
import { runOpenClawStateWorkerOperation } from "../state/openclaw-state-worker-store.js";
import type { CypherTransferWriteOperations } from "./transfer-store.contract.js";
import type { CypherTransferRecord, CypherTransferStore } from "./types.js";

/** The profile's existing SQLite owner retains send outcomes across UI/Gateway restarts. */
export function createCypherTransferStore(
  options: Pick<OpenClawStateDatabaseOptions, "path" | "env"> = {},
): CypherTransferStore {
  async function write(
    type: keyof CypherTransferWriteOperations,
    record: CypherTransferRecord,
    assertCurrent?: () => void,
  ): Promise<CypherTransferRecord> {
    const context = captureOpenClawStateWorkerContext(options);
    return runOpenClawStateWorkerOperation(
      context,
      (scope) => scope.execute({ type, input: record }),
      {
        assertCurrent,
        createAdmission: () => ({
          admission: createSqliteWorkerOperationAdmission((_request, grant) => {
            context.admission.assertCurrent();
            assertCurrent?.();
            grant();
          }),
          nativeLocations: [context.admission.databasePath],
        }),
      },
    );
  }
  return {
    async get(requestId) {
      const reply = await executeExistingOpenClawStateRead(options, {
        type: "cypherTransfers.get",
        requestId,
      });
      if (!reply) {
        return null;
      }
      if (!reply.ok || reply.type !== "cypherTransfers.get") {
        throw new Error("Could not read the original Cypher transfer record");
      }
      return reply.record;
    },
    insert: (record, assertCurrent) => write("cypherTransfers.insert", record, assertCurrent),
    update: (record, assertCurrent) => write("cypherTransfers.update", record, assertCurrent),
    async list(input) {
      const reply = await executeExistingOpenClawStateRead(options, {
        type: "cypherTransfers.list",
        options: { ...input, limit: Math.min(100, Math.max(1, input.limit ?? 100)) },
      });
      if (!reply) {
        return [];
      }
      if (!reply.ok || reply.type !== "cypherTransfers.list") {
        throw new Error("Could not read Cypher transfer history");
      }
      return reply.records;
    },
  };
}
