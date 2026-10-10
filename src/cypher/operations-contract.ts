import type { CypherRpcMethod, CypherRpcParams } from "./ipc.js";

export type CypherAuthority = { assertCurrent: () => void; signal?: AbortSignal };
export class CypherOperationError extends Error {
  constructor(
    message: string,
    readonly code = "CYPHER_OPERATION",
  ) {
    super(message);
    this.name = "CypherOperationError";
  }
}

const addressPattern = /^0x[0-9a-fA-F]{40}$/;
export function isCypherAddress(value: unknown): value is string {
  return typeof value === "string" && addressPattern.test(value) && !/^0x0{40}$/i.test(value);
}

export function booleanResult(value: unknown): boolean {
  if (typeof value !== "boolean") {
    throw new CypherOperationError("ColossusX returned an invalid result.");
  }
  return value;
}

/** The node manager owns every queue, authority check, connection fact, and endpoint. */
export type CypherOperationOwner = {
  call<M extends CypherRpcMethod>(
    method: M,
    params: CypherRpcParams[M],
    authority?: CypherAuthority,
  ): Promise<unknown>;
  serialize<T>(task: () => Promise<T>): Promise<T>;
  operation<T>(authority: CypherAuthority, task: () => Promise<T>): Promise<T>;
  assert(authority: CypherAuthority): void;
  requireAccount(address: string, authority: CypherAuthority): Promise<void>;
  requireConnected(authority: CypherAuthority): Promise<void>;
  resolvePaths(): Promise<{ rootDir: string; dataDir: string; ipcPath: string }>;
  isConnected(): boolean;
  isClosed(): boolean;
};
