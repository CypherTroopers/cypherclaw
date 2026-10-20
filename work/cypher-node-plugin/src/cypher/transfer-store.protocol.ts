import type { CypherTransferListOptions } from "./transfer-store.contract.js";
import type { CypherTransferRecord } from "./types.js";

export type TransferStoreCommand =
  | { type: "get"; requestId: string }
  | { type: "list"; options: CypherTransferListOptions }
  | { type: "insert" | "update"; record: CypherTransferRecord }
  | { type: "close" };

export type TransferStoreRequest = {
  id: number;
  command: TransferStoreCommand;
};
export type TransferStoreResult = { type: "result"; id: number } & (
  | { command: "get"; result: CypherTransferRecord | null }
  | { command: "list"; result: CypherTransferRecord[] }
  | { command: "insert" | "update"; result: CypherTransferRecord }
  | { command: "close"; result: null }
);
export type TransferStoreResponse =
  | { type: "admission"; id: number; gate: SharedArrayBuffer }
  | TransferStoreResult
  | { type: "error"; id: number; message: string };
