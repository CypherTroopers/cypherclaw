import type { CypherTransferRecord } from "./types.js";

export type CypherTransferListOptions = {
  nodeKey?: string;
  limit?: number;
  pendingOnly?: boolean;
};

export type CypherTransferWriteOperations = {
  "cypherTransfers.insert": { input: CypherTransferRecord; output: CypherTransferRecord };
  "cypherTransfers.update": { input: CypherTransferRecord; output: CypherTransferRecord };
};

export type CypherTransferReadCommand =
  | { type: "cypherTransfers.get"; requestId: string }
  | { type: "cypherTransfers.list"; options: CypherTransferListOptions };

export type CypherTransferReadResult =
  | { type: "cypherTransfers.get"; record: CypherTransferRecord | null }
  | { type: "cypherTransfers.list"; records: CypherTransferRecord[] };
