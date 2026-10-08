import {
  ErrorCodes,
  errorShape,
  type GatewayRequestHandlerOptions,
} from "openclaw/plugin-sdk/gateway-runtime";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import { CypherAuthorityError, createRequestAuthority } from "./authority.js";
import {
  CypherNodeManager,
  CypherOperationError,
  isCypherAddress,
  type CypherAuthority,
} from "./cypher/manager.js";
import { CypherPluginService } from "./service.js";
import { WalletGeneratorError } from "./wallet-generator/manager.js";
type Validator<T> = (value: unknown) => value is T;
type GatewayRequestHandler = (options: GatewayRequestHandlerOptions) => Promise<void>;

type EmptyParams = Record<string, never>;
type AddressParams = { address: string };
type PasswordParams = { password: string };
type MiningParams = { threads: number; signer: string; password: string };
type UnlockParams = AddressParams & PasswordParams & { duration: number };
type SignerParams = { signer: string };
type RewardParams = SignerParams & PasswordParams & { recipient: string };

function exactParams(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).every((key) => keys.includes(key))
  );
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

function cypherError(error: unknown) {
  if (error instanceof CypherAuthorityError) {
    return errorShape(ErrorCodes.FORBIDDEN, error.message);
  }
  if (error instanceof CypherOperationError || error instanceof WalletGeneratorError) {
    return errorShape(ErrorCodes.UNAVAILABLE, error.message, { details: { code: error.code } });
  }
  return errorShape(
    ErrorCodes.UNAVAILABLE,
    "Cypher operation failed. Check the node status and try again.",
  );
}

export function registerCypherMethods(api: OpenClawPluginApi, service: CypherPluginService): void {
  function register<T>(
    method: string,
    scope: "operator.read" | "operator.admin",
    validate: Validator<T>,
    operation: (
      owners: ReturnType<CypherPluginService["current"]>,
      params: T,
      authority: CypherAuthority,
    ) => Promise<unknown>,
  ) {
    const handler: GatewayRequestHandler = async (options) => {
      if (!validate(options.params)) {
        options.respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "Invalid Cypher operation parameters."),
        );
        return;
      }
      try {
        const owners = service.current();
        const authority = createRequestAuthority(
          options,
          owners.signal,
          scope,
          options.context.requestEntryLifetime?.signal,
        );
        authority.assertCurrent();
        const result = await operation(owners, options.params, authority);
        authority.assertCurrent();
        options.respond(true, result);
      } catch (error) {
        options.respond(false, undefined, cypherError(error));
      }
    };
    // These owners manage native node resources and transient generation, not OpenClaw profiles or sessions.
    api.registerGatewayMethod(method, handler, { scope, profileAccess: "independent" });
  }

  function mutation<T>(
    method: string,
    validate: Validator<T>,
    operation: (
      manager: CypherNodeManager,
      params: T,
      authority: CypherAuthority,
    ) => Promise<unknown>,
  ) {
    register(method, "operator.admin", validate, (owners, params, authority) =>
      operation(owners.node, params, authority),
    );
  }

  register("cypher.status", "operator.read", emptyParams, (owners) => owners.node.status());
  mutation("cypher.start", emptyParams, (manager, _params, authority) => manager.start(authority));
  mutation("cypher.stop", emptyParams, (manager, _params, authority) => manager.stop(authority));
  mutation("cypher.connect", emptyParams, (manager, _params, authority) =>
    manager.connect(authority),
  );
  mutation("cypher.disconnect", emptyParams, (manager, _params, authority) =>
    manager.disconnect(authority),
  );
  mutation("cypher.mining.start", miningParams, (manager, params, authority) =>
    manager.startMining(params, authority),
  );
  mutation("cypher.mining.stop", emptyParams, (manager, _params, authority) =>
    manager.stopMining(authority),
  );
  mutation("cypher.accounts.create", passwordParams, (manager, params, authority) =>
    manager.createAccount(params.password, authority),
  );
  mutation("cypher.accounts.select", addressParams, (manager, params, authority) =>
    manager.selectAccount(params.address, authority),
  );
  mutation("cypher.accounts.unlock", unlockParams, (manager, params, authority) =>
    manager.unlockAccount(params, authority),
  );
  mutation("cypher.accounts.lock", addressParams, (manager, params, authority) =>
    manager.lockAccount(params.address, authority),
  );
  mutation("cypher.reward.get", signerParams, (manager, params, authority) =>
    manager.getReward(params.signer, authority),
  );
  mutation("cypher.reward.set", rewardParams, (manager, params, authority) =>
    manager.setReward(params, authority),
  );
  register("cypher.wallet.generator.status", "operator.read", emptyParams, (owners) =>
    owners.wallet.status(),
  );
  register(
    "cypher.wallet.generator.generate",
    "operator.admin",
    emptyParams,
    (owners, _params, authority) => owners.wallet.generate(authority),
  );
}
