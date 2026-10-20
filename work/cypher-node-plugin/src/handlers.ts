import {
  ErrorCodes,
  errorShape,
  type GatewayRequestHandlerOptions,
} from "openclaw/plugin-sdk/gateway-runtime";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import { CypherAuthorityError, createRequestAuthority } from "./authority.js";
import { CypherIpcError } from "./cypher/ipc.js";
import {
  CypherNodeManager,
  CypherOperationError,
  isCypherAddress,
  type CypherAuthority,
} from "./cypher/manager.js";
import { cypherAmountUnits } from "./cypher/transfer.js";
import { NativeSetupError } from "./native/index.js";
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
type WalletListParams = { offset?: number; limit?: number };
type TransferListParams = { limit?: number };
type TransferPrepareParams = { from: string; to: string; amount: string };
type TransferSendParams = PasswordParams & { requestId: string; quoteId: string };

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
const walletListParams: Validator<WalletListParams> = (value): value is WalletListParams =>
  exactParams(value, ["offset", "limit"]) &&
  (value.offset === undefined ||
    (typeof value.offset === "number" &&
      Number.isInteger(value.offset) &&
      value.offset >= 0 &&
      value.offset <= 1024)) &&
  (value.limit === undefined || boundedInteger(value.limit, 50));
const transferListParams: Validator<TransferListParams> = (value): value is TransferListParams =>
  exactParams(value, ["limit"]) && (value.limit === undefined || boundedInteger(value.limit, 100));
const transferPrepareParams: Validator<TransferPrepareParams> = (
  value,
): value is TransferPrepareParams => {
  if (
    !exactParams(value, ["from", "to", "amount"]) ||
    !isCypherAddress(value.from) ||
    !isCypherAddress(value.to)
  ) {
    return false;
  }
  try {
    cypherAmountUnits(value.amount);
    return true;
  } catch {
    return false;
  }
};
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const transferSendParams: Validator<TransferSendParams> = (value): value is TransferSendParams =>
  exactParams(value, ["requestId", "quoteId", "password"]) &&
  typeof value.requestId === "string" &&
  uuidPattern.test(value.requestId) &&
  typeof value.quoteId === "string" &&
  uuidPattern.test(value.quoteId) &&
  validPassword(value.password);

function cypherError(error: unknown) {
  if (
    error instanceof CypherAuthorityError ||
    (error instanceof CypherOperationError && error.code === "CYPHER_AUTHORITY_REVOKED")
  ) {
    return errorShape(ErrorCodes.FORBIDDEN, error.message);
  }
  if (
    error instanceof CypherOperationError ||
    error instanceof WalletGeneratorError ||
    error instanceof CypherIpcError ||
    error instanceof NativeSetupError
  ) {
    return errorShape(ErrorCodes.UNAVAILABLE, error.message, { details: { code: error.code } });
  }
  return errorShape(
    ErrorCodes.UNAVAILABLE,
    "Cypher operation failed. Check the node status and try again.",
  );
}

export function registerCypherMethods(
  api: Pick<OpenClawPluginApi, "registerGatewayMethod">,
  service: CypherPluginService,
): void {
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
      const params = options.params;
      try {
        const owners = service.current();
        const authority = createRequestAuthority(
          options,
          owners.signal,
          scope,
          options.context.requestEntryLifetime?.signal,
        );
        authority.assertCurrent();
        const result =
          scope === "operator.admin"
            ? await service.mutate(owners, authority, () => operation(owners, params, authority))
            : await operation(owners, params, authority);
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
  register("cypher.setup.status", "operator.read", emptyParams, (owners) =>
    owners.installer.status(),
  );
  register("cypher.setup.prepare", "operator.admin", emptyParams, (owners, _params, authority) =>
    service.prepare(owners, authority),
  );
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
  register("cypher.wallets.list", "operator.read", walletListParams, (owners, params) =>
    owners.node.wallets(params),
  );
  mutation("cypher.transfers.prepare", transferPrepareParams, (manager, params, authority) =>
    manager.prepareTransfer(params, authority),
  );
  mutation("cypher.transfers.send", transferSendParams, (manager, params, authority) =>
    manager.sendTransfer(params, authority),
  );
  register("cypher.transfers.list", "operator.read", transferListParams, (owners, params) =>
    owners.node.transfers(params),
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
