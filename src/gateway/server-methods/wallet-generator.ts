import { isRecord } from "@openclaw/normalization-core/record-coerce";
import { ErrorCodes, errorShape } from "../../../packages/gateway-protocol/src/index.js";
import { WalletGeneratorError, WalletGeneratorManager } from "../../wallet-generator/manager.js";
import { readGatewayRequestMutationAuthority } from "./session-mutation-guards.js";
import type { GatewayRequestContext, GatewayRequestHandlers } from "./types.js";
import { defineValidatedGatewayHandler, type Validator } from "./validation.js";

const emptyParams: Validator<Record<string, never>> = (value): value is Record<string, never> =>
  isRecord(value) && Object.keys(value).length === 0;

function managerFor(context: GatewayRequestContext): WalletGeneratorManager {
  return (context.walletGenerator ??= new WalletGeneratorManager(
    context.requestEntryLifetime?.signal,
  ));
}

function walletError(error: unknown) {
  return error instanceof WalletGeneratorError
    ? errorShape(ErrorCodes.UNAVAILABLE, error.message, { details: { code: error.code } })
    : errorShape(ErrorCodes.UNAVAILABLE, "Wallet generation failed. Reconnect and try again.");
}

export const walletGeneratorHandlers: GatewayRequestHandlers = {
  "wallet.generator.status": defineValidatedGatewayHandler(
    "wallet.generator.status",
    emptyParams,
    async ({ context, respond }) => respond(true, await managerFor(context).status()),
    walletError,
  ),
  "wallet.generator.generate": defineValidatedGatewayHandler(
    "wallet.generator.generate",
    emptyParams,
    async (options) => {
      const authority = readGatewayRequestMutationAuthority(options);
      authority.assertCurrent();
      const result = await managerFor(options.context).generate({
        assertCurrent: authority.assertCurrent,
        signal: options.signal,
      });
      authority.assertCurrent();
      options.respond(true, result);
    },
    walletError,
  ),
};
