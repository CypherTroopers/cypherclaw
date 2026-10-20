import type { DatabaseSync } from "node:sqlite";
import { parentPort, workerData } from "node:worker_threads";
import { openTransferDatabase } from "./transfer-store.database.js";
import {
  listCypherTransfersInDatabase,
  readCypherTransferInDatabase,
  writeCypherTransferInDatabase,
} from "./transfer-store.kernel.js";
import type { TransferStoreRequest, TransferStoreResponse } from "./transfer-store.protocol.js";

if (!parentPort) {
  throw new Error("Cypher transfer storage requires a worker thread.");
}
const port = parentPort;
const filename: string = workerData.filename;
let database: DatabaseSync | undefined;
function reply(message: TransferStoreResponse) {
  port.postMessage(message);
}
function admit(id: number) {
  const buffer = new SharedArrayBuffer(4);
  const gate = new Int32Array(buffer);
  reply({ type: "admission", id, gate: buffer });
  Atomics.wait(gate, 0, 0, 10_000);
  if (Atomics.load(gate, 0) !== 1) {
    throw new Error(
      "Cypher transfer persistence was not authorized. Check transfer history before retrying.",
    );
  }
}

port.on("message", ({ id, command }: TransferStoreRequest) => {
  try {
    if (command.type === "close") {
      database?.close();
      database = undefined;
      reply({ type: "result", command: "close", id, result: null });
      port.close();
      return;
    }
    const write = command.type === "insert" || command.type === "update";
    if (write) {
      admit(id);
    }
    database ??= openTransferDatabase(filename, write);
    if (!database) {
      if (command.type === "list") {
        reply({ type: "result", command: "list", id, result: [] });
      } else if (command.type === "get") {
        reply({ type: "result", command: "get", id, result: null });
      } else {
        throw new Error("Cypher transfer database creation failed.");
      }
      return;
    }
    if (command.type === "get") {
      reply({
        type: "result",
        command: "get",
        id,
        result: readCypherTransferInDatabase(database, command.requestId),
      });
    } else if (command.type === "list") {
      reply({
        type: "result",
        command: "list",
        id,
        result: listCypherTransfersInDatabase(database, command.options),
      });
    } else {
      database.exec("BEGIN IMMEDIATE");
      try {
        admit(id);
        const result = writeCypherTransferInDatabase(database, command.record, command.type);
        // The host rechecks live request/service authority immediately before durable commit.
        admit(id);
        database.exec("COMMIT");
        reply({ type: "result", command: command.type, id, result });
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    }
  } catch (error) {
    reply({
      type: "error",
      id,
      message: error instanceof Error ? error.message : "Cypher transfer storage failed.",
    });
  }
});
