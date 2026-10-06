import { isRecord } from "@openclaw/normalization-core/record-coerce";
import { ErrorCodes, errorShape } from "../../../packages/gateway-protocol/src/index.js";
import {
  CypherNodeManager,
  CypherOperationError,
  isCypherAddress,
  type CypherAuthority,
} from "../../cypher/manager.js";
import { readGatewayRequestMutationAuthority } from "./session-mutation-guards.js";
import type {
  GatewayRequestContext,
  GatewayRequestHandler,
  GatewayRequestHandlers,
} from "./types.js";
import { defineValidatedGatewayHandler, type Validator } from "./validation.js";

type EmptyParams = Record<string, never>;
type AddressParams = { address: string };
type PasswordParams = { password: string };
type MiningParams = { threads: number; signer: string; password: string };
type UnlockParams = AddressParams & PasswordParams & { duration: number };
type SignerParams = { signer: string };
type RewardParams = SignerParams & PasswordParams & { recipient: string };

function exactParams(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return isRecord(value) && Object.keys(value).every((key) => keys.includes(key));
}

function validPassword(value: unknown): value is string {
  return typeof value === "string" && value.length <= 4096;
}

function boundedInteger(value: unknown, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= max;
}

const emptyParams: Validator<EmptyParams> = (value): value is EmptyParams => exactParams(value, []);
const addressParams: Validator<AddressParams> = (value): value is AddressParams =>
  exactParams(value, ["address"]) && isCypherAddress(value.address);
const passwordParams: Validator<PasswordParams> = (value): value is PasswordParams =>
  exactParams(value, ["password"]) && validPassword(value.password);
const miningParams: Validator<MiningParams> = (value): value is MiningParams =>
  exactParams(value, ["threads", "signer", "password"]) &&
  boundedInteger(value.threads, 256) &&
  isCypherAddress(value.signer) &&
  validPassword(value.password);
const unlockParams: Validator<UnlockParams> = (value): value is UnlockParams =>
  exactParams(value, ["address", "password", "duration"]) &&
  isCypherAddress(value.address) &&
  validPassword(value.password) &&
  boundedInteger(value.duration, 86_400);
const signerParams: Validator<SignerParams> = (value): value is SignerParams =>
  exactParams(value, ["signer"]) && isCypherAddress(value.signer);
const rewardParams: Validator<RewardParams> = (value): value is RewardParams =>
  exactParams(value, ["signer", "recipient", "password"]) &&
  isCypherAddress(value.signer) &&
  isCypherAddress(value.recipient) &&
  value.signer.toLowerCase() !== value.recipient.toLowerCase() &&
  validPassword(value.password);

function managerFor(context: GatewayRequestContext): CypherNodeManager {
  return (context.cypherNodeManager ??= new CypherNodeManager());
}

function cypherError(error: unknown) {
  if (error instanceof CypherOperationError) {
    return errorShape(ErrorCodes.UNAVAILABLE, error.message, { details: { code: error.code } });
  }
  return errorShape(
    ErrorCodes.UNAVAILABLE,
    "Cypher operation failed. Check the node status and try again.",
  );
}

function mutation<T>(
  method: string,
  validate: Validator<T>,
  operation: (
    manager: CypherNodeManager,
    params: T,
    authority: CypherAuthority,
  ) => Promise<unknown>,
): GatewayRequestHandler {
  return defineValidatedGatewayHandler(
    method,
    validate,
    async (options) => {
      const requestAuthority = readGatewayRequestMutationAuthority(options);
      requestAuthority.assertCurrent();
      const authority: CypherAuthority = {
        assertCurrent: requestAuthority.assertCurrent,
        signal: options.signal,
      };
      const result = await operation(managerFor(options.context), options.params, authority);
      options.respond(true, result);
    },
    cypherError,
  );
}

export const cypherHandlers: GatewayRequestHandlers = {
  "cypher.status": defineValidatedGatewayHandler(
    "cypher.status",
    emptyParams,
    async ({ context, respond }) => respond(true, await managerFor(context).status()),
    cypherError,
  ),
  "cypher.start": mutation("cypher.start", emptyParams, (manager, _params, authority) =>
    manager.start(authority),
  ),
  "cypher.stop": mutation("cypher.stop", emptyParams, (manager, _params, authority) =>
    manager.stop(authority),
  ),
  "cypher.connect": mutation("cypher.connect", emptyParams, (manager, _params, authority) =>
    manager.connect(authority),
  ),
  "cypher.disconnect": mutation("cypher.disconnect", emptyParams, (manager, _params, authority) =>
    manager.disconnect(authority),
  ),
  "cypher.mining.start": mutation(
    "cypher.mining.start",
    miningParams,
    (manager, params, authority) => manager.startMining(params, authority),
  ),
  "cypher.mining.stop": mutation("cypher.mining.stop", emptyParams, (manager, _params, authority) =>
    manager.stopMining(authority),
  ),
  "cypher.accounts.create": mutation(
    "cypher.accounts.create",
    passwordParams,
    (manager, params, authority) => manager.createAccount(params.password, authority),
  ),
  "cypher.accounts.select": mutation(
    "cypher.accounts.select",
    addressParams,
    (manager, params, authority) => manager.selectAccount(params.address, authority),
  ),
  "cypher.accounts.unlock": mutation(
    "cypher.accounts.unlock",
    unlockParams,
    (manager, params, authority) => manager.unlockAccount(params, authority),
  ),
  "cypher.accounts.lock": mutation(
    "cypher.accounts.lock",
    addressParams,
    (manager, params, authority) => manager.lockAccount(params.address, authority),
  ),
  "cypher.reward.get": mutation("cypher.reward.get", signerParams, (manager, params, authority) =>
    manager.getReward(params.signer, authority),
  ),
  "cypher.reward.set": mutation("cypher.reward.set", rewardParams, (manager, params, authority) =>
    manager.setReward(params, authority),
  ),
};
