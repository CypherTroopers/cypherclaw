import { randomUUID } from "node:crypto";
import { Socket } from "node:net";
import { homedir } from "node:os";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import { resolveEnvironmentValue } from "../environment.js";

function expandNativePath(value: string, env: Record<string, string>, platform: NodeJS.Platform) {
  // Cypher's DirectoryFlag expands HOME/environment, then uses POSIX cleaning on every OS.
  const withHome = /^~[/\\]/.test(value)
    ? (resolveEnvironmentValue(env, "HOME", platform) || homedir()) + value.slice(1)
    : value;
  const expanded = withHome.replace(
    /\$(?:\{([^}]*)\}|([*#$@!?0-9-]|[A-Za-z_][A-Za-z0-9_]*)|(\{))/g,
    (_match, braced: string | undefined, plain: string | undefined) =>
      resolveEnvironmentValue(env, braced ?? plain ?? "", platform) ?? "",
  );
  return path.posix.normalize(expanded).replace(/(.)\/$/, "$1");
}

/** Infer native paths from the resolved launcher directory and its inherited environment. */
export function resolveCypherIpcPaths(
  rootDir: string,
  env: Record<string, string>,
  platform: NodeJS.Platform,
) {
  const pathApi = platform === "win32" ? path.win32 : path;
  const envValue = (name: string) => resolveEnvironmentValue(env, name, platform);
  // Bash and the Unix launchers set these before Cypher expands its path flags.
  const nativeEnv = platform === "win32" ? env : { ...env, PWD: rootDir, OLDPWD: rootDir };
  let dataDir = envValue("CYPHER_DATADIR") || "chaindbname";
  let ipcPath = envValue("CYPHER_IPC_PATH") || "cypher.ipc";
  if (platform === "win32") {
    dataDir = dataDir.trim() ? dataDir : "chaindbname";
    if (!pathApi.parse(dataDir).root) {
      dataDir = pathApi.join(rootDir, dataDir);
    }
    ipcPath = ipcPath.trim() ? ipcPath : "cypher.ipc";
  }
  dataDir = pathApi.resolve(rootDir, expandNativePath(dataDir, nativeEnv, platform));
  ipcPath = expandNativePath(ipcPath, nativeEnv, platform);
  ipcPath =
    platform === "win32"
      ? ipcPath.startsWith("\\\\.\\pipe\\")
        ? ipcPath
        : "\\\\.\\pipe\\" + ipcPath
      : pathApi.resolve(pathApi.basename(ipcPath) === ipcPath ? dataDir : rootDir, ipcPath);
  return { rootDir, dataDir, ipcPath };
}

export type CypherRpcParams = {
  web3_clientVersion: [];
  eth_chainId: [];
  eth_blockNumber: [];
  eth_keyBlockNumber: [];
  eth_mining: [];
  eth_hashrate: [];
  eth_accounts: [];
  eth_coinbase: [];
  eth_syncing: [];
  net_peerCount: [];
  eth_getBalance: [address: string, block: "latest"];
  eth_getBlockByNumber: [block: "latest", fullTransactions: boolean];
  miner_start: [threads: number | null, signer: string, password: string];
  miner_stop: [];
  miner_status: [];
  miner_setEtherbase: [signer: string];
  personal_newAccount: [password: string];
  personal_unlockAccount: [signer: string, password: string, durationSeconds: number | null];
  personal_lockAccount: [signer: string];
  personal_setCommonRPCRewardAddress: [signer: string, recipient: string, password: string];
  personal_getCommonRPCRewardAddress: [signer: string];
};

export type CypherRpcMethod = keyof CypherRpcParams;

const parameterCounts = {
  web3_clientVersion: 0,
  eth_chainId: 0,
  eth_blockNumber: 0,
  eth_keyBlockNumber: 0,
  eth_mining: 0,
  eth_hashrate: 0,
  eth_accounts: 0,
  eth_coinbase: 0,
  eth_syncing: 0,
  net_peerCount: 0,
  eth_getBalance: 2,
  eth_getBlockByNumber: 2,
  miner_start: 3,
  miner_stop: 0,
  miner_status: 0,
  miner_setEtherbase: 1,
  personal_newAccount: 1,
  personal_unlockAccount: 3,
  personal_lockAccount: 1,
  personal_setCommonRPCRewardAddress: 3,
  personal_getCommonRPCRewardAddress: 1,
} satisfies Record<CypherRpcMethod, number>;

const connectionCodes = new Set([
  "ENOENT",
  "ECONNREFUSED",
  "EACCES",
  "EPERM",
  "EBUSY",
  "ETIMEDOUT",
  "ECONNRESET",
  "EPIPE",
]);

const MAX_RESPONSE_BYTES = 128 * 1024;

export class CypherIpcError extends Error {
  constructor(
    message: string,
    readonly code: string | number,
  ) {
    super(message);
    this.name = "CypherIpcError";
  }
}

function protocolError(): CypherIpcError {
  return new CypherIpcError("Cypher returned an invalid IPC response.", "IPC_PROTOCOL");
}

export async function callCypherIpc<M extends CypherRpcMethod>(
  endpoint: string,
  method: M,
  params: CypherRpcParams[M],
  options: { signal?: AbortSignal; timeoutMs?: number; assertCurrent?: () => void } = {},
): Promise<unknown> {
  if (
    !Object.hasOwn(parameterCounts, method) ||
    !Array.isArray(params) ||
    params.length !== parameterCounts[method]
  ) {
    throw new CypherIpcError("The Cypher IPC operation is not supported.", "IPC_PROTOCOL");
  }
  const timeoutMs = options.timeoutMs ?? 10_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new CypherIpcError("The Cypher IPC timeout is invalid.", "IPC_PROTOCOL");
  }
  if (options.signal?.aborted) {
    throw new CypherIpcError("The Cypher IPC operation was canceled.", "IPC_CANCELLED");
  }

  const id = randomUUID();
  const request = `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`;
  return await new Promise((resolve, reject) => {
    const socket = new Socket();
    const decoder = new StringDecoder("utf8");
    let responseBytes = 0;
    let responseText = "";
    let settled = false;

    const finish = (error: CypherIpcError | null, result?: unknown) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      socket.removeListener("connect", onConnect);
      socket.removeListener("data", onData);
      socket.removeListener("end", onEnd);
      socket.destroy();
      if (error) {
        reject(error);
      } else {
        resolve(result);
      }
    };

    const consumeResponse = (text: string) => {
      let response: unknown;
      try {
        response = JSON.parse(text);
      } catch {
        finish(protocolError());
        return;
      }
      if (
        !response ||
        typeof response !== "object" ||
        Array.isArray(response) ||
        !("jsonrpc" in response) ||
        response.jsonrpc !== "2.0" ||
        !("id" in response) ||
        response.id !== id ||
        Object.hasOwn(response, "result") === Object.hasOwn(response, "error")
      ) {
        finish(protocolError());
        return;
      }
      if ("error" in response) {
        const error = response.error;
        if (
          !error ||
          typeof error !== "object" ||
          !("code" in error) ||
          typeof error.code !== "number" ||
          !Number.isSafeInteger(error.code)
        ) {
          finish(protocolError());
          return;
        }
        // Node error messages/data can echo credentials from the request.
        finish(
          new CypherIpcError(
            `Cypher rejected the operation (RPC ${error.code}). Check the operation settings and node log.`,
            error.code,
          ),
        );
        return;
      }
      if ("result" in response) {
        finish(null, response.result);
      }
    };

    const onConnect = () => {
      try {
        options.signal?.throwIfAborted();
        options.assertCurrent?.();
      } catch {
        finish(new CypherIpcError("The Cypher IPC operation was canceled.", "IPC_CANCELLED"));
        return;
      }
      try {
        socket.write(request);
      } catch {
        finish(new CypherIpcError("Could not send the Cypher IPC operation.", "IPC_CONNECTION"));
      }
    };
    const onData = (chunk: Buffer) => {
      responseBytes += chunk.length;
      if (responseBytes > MAX_RESPONSE_BYTES) {
        finish(new CypherIpcError("Cypher IPC response exceeded 128 KiB.", "IPC_PROTOCOL"));
        return;
      }
      responseText += decoder.write(chunk);
      const newline = responseText.indexOf("\n");
      if (newline >= 0) {
        consumeResponse(responseText.slice(0, newline));
      }
    };
    const onEnd = () => {
      responseText += decoder.end();
      if (responseText.trim()) {
        consumeResponse(responseText);
      } else {
        finish(
          new CypherIpcError("Cypher IPC closed before a response arrived.", "IPC_CONNECTION"),
        );
      }
    };
    const onError = (error: NodeJS.ErrnoException) => {
      finish(
        new CypherIpcError(
          "Could not communicate with Cypher IPC. Check the node status and IPC access.",
          error.code && connectionCodes.has(error.code) ? error.code : "IPC_CONNECTION",
        ),
      );
    };
    const onClose = () => {
      finish(new CypherIpcError("Cypher IPC closed before a response arrived.", "IPC_CONNECTION"));
      socket.removeListener("error", onError);
      socket.removeListener("close", onClose);
    };
    const onAbort = () => {
      finish(new CypherIpcError("The Cypher IPC operation was canceled.", "IPC_CANCELLED"));
    };
    const timer = setTimeout(() => {
      finish(
        new CypherIpcError(
          "Cypher IPC timed out. Check the node status before trying the operation again.",
          "IPC_TIMEOUT",
        ),
      );
    }, timeoutMs);
    timer.unref();

    socket.once("connect", onConnect);
    socket.on("data", onData);
    socket.once("end", onEnd);
    // Retain the error listener until close to consume a queued connection failure after cancellation.
    socket.on("error", onError);
    socket.once("close", onClose);
    options.signal?.addEventListener("abort", onAbort, { once: true });
    try {
      socket.connect(endpoint);
    } catch {
      finish(new CypherIpcError("Could not open the Cypher IPC endpoint.", "IPC_CONNECTION"));
    }
  });
}
