import type { GatewayRequestHandlerOptions } from "openclaw/plugin-sdk/gateway-runtime";

export class CypherAuthorityError extends Error {
  constructor(unsupportedHost = false) {
    super(
      unsupportedHost
        ? "This OpenClaw host does not provide live request authority. Update OpenClaw before using Cypher."
        : "The request is no longer authorized. Reconnect to OpenClaw and try again.",
    );
    this.name = "CypherAuthorityError";
  }
}

/** Compose host-owned request authority with the plugin service generation. */
export function createRequestAuthority(
  options: Pick<
    GatewayRequestHandlerOptions,
    "client" | "signal" | "hasCurrentClientAuthority" | "sessionMutationCommitGuard"
  >,
  serviceSignal: AbortSignal,
  scope: "operator.read" | "operator.admin",
  gatewaySignal?: AbortSignal,
) {
  const client = options.client;
  const signal = AbortSignal.any([
    serviceSignal,
    ...(gatewaySignal ? [gatewaySignal] : []),
    ...(options.signal ? [options.signal] : []),
    ...(client?.connectionSignal ? [client.connectionSignal] : []),
  ]);
  const assertCurrent = () => {
    if (!client?.connectionSignal || !options.hasCurrentClientAuthority) {
      throw new CypherAuthorityError(true);
    }
    const scopes = client?.connect.scopes ?? [];
    if (
      signal.aborted ||
      !client ||
      client.invalidated ||
      options.hasCurrentClientAuthority?.() !== true ||
      !(scopes.includes("operator.admin") || (scope === "operator.read" && scopes.includes(scope)))
    ) {
      throw new CypherAuthorityError();
    }
    options.sessionMutationCommitGuard?.();
  };
  return { signal, assertCurrent };
}
