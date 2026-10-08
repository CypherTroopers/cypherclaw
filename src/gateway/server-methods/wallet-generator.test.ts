import { beforeEach, describe, expect, it, vi } from "vitest";
import { WalletGeneratorError } from "../../wallet-generator/manager.js";
import {
  listCoreGatewayHandlerMethodNames,
  resolveCoreOperatorGatewayMethodScope,
} from "../methods/core-method-policy.js";
import {
  createCoreGatewayMethodDescriptors,
  createGatewayMethodRegistry,
} from "../methods/registry.js";
import { createGatewayRequestContext } from "../server-request-context.js";
import { makeContextParams } from "../server-request-context.test-support.js";
import { authorizeGatewayRequestPreDispatch } from "./request-authorization.js";
import type { GatewayClient, GatewayRequestHandlerOptions } from "./types.js";
import { walletGeneratorHandlers } from "./wallet-generator.js";

const mocks = vi.hoisted(() => ({
  constructed: vi.fn(),
  status: vi.fn(),
  generate: vi.fn(),
}));

vi.mock("../../wallet-generator/manager.js", async (original) => {
  const actual = await original<typeof import("../../wallet-generator/manager.js")>();
  return {
    ...actual,
    WalletGeneratorManager: class {
      constructor(...args: unknown[]) {
        mocks.constructed(...args);
      }
      status = mocks.status;
      generate = mocks.generate;
    },
  };
});

const wallet = {
  address: "0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf",
  privateKey: "0x" + "0".repeat(63) + "1",
};

function createContext() {
  const context = createGatewayRequestContext(makeContextParams());
  context.getRuntimeConfig = () => ({});
  return context;
}

async function invoke(
  method: string,
  params: Record<string, unknown>,
  overrides: Partial<GatewayRequestHandlerOptions> = {},
) {
  const respond = vi.fn();
  const options: GatewayRequestHandlerOptions = {
    req: { type: "req", id: "wallet-test", method, params },
    params,
    client: null,
    isWebchatConnect: () => false,
    respond,
    context: overrides.context ?? createContext(),
    ...overrides,
  };
  await walletGeneratorHandlers[method]?.(options);
  return { respond, options };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.generate.mockResolvedValue(wallet);
  mocks.status.mockResolvedValue({ available: true });
});

describe("wallet generator RPC boundary", () => {
  it.each(["wallet.generator.status", "wallet.generator.generate"])(
    "rejects arbitrary executable input for %s before creating an owner",
    async (method) => {
      const { respond } = await invoke(method, { command: "/other/binary", args: [] });
      expect(respond).toHaveBeenCalledWith(
        false,
        undefined,
        expect.objectContaining({ code: "INVALID_REQUEST" }),
      );
      expect(mocks.constructed).not.toHaveBeenCalled();
    },
  );

  it("generates without a node manager and sends the result only through the request response", async () => {
    const context = createContext();
    const { respond } = await invoke("wallet.generator.generate", {}, { context });
    expect(respond).toHaveBeenCalledExactlyOnceWith(true, wallet);
    expect(context.cypherNodeManager).toBeUndefined();
    expect(context.broadcast).not.toHaveBeenCalled();
    expect(context.broadcastToConnIds).not.toHaveBeenCalled();
    await invoke("wallet.generator.status", {}, { context });
    expect(mocks.constructed).toHaveBeenCalledOnce();
  });

  it("refuses revoked authority before generation and again before exposing a result", async () => {
    let current = false;
    const hasCurrentClientAuthority = () => current;
    const before = await invoke("wallet.generator.generate", {}, { hasCurrentClientAuthority });
    expect(before.respond).toHaveBeenCalledWith(false, undefined, expect.any(Object));
    expect(mocks.generate).not.toHaveBeenCalled();
    current = true;
    mocks.generate.mockImplementationOnce(async () => {
      current = false;
      return wallet;
    });
    const after = await invoke("wallet.generator.generate", {}, { hasCurrentClientAuthority });
    expect(after.respond).toHaveBeenCalledWith(false, undefined, expect.any(Object));
    expect(after.respond).not.toHaveBeenCalledWith(true, expect.anything());
  });

  it("sanitizes unknown failures and preserves actionable known errors", async () => {
    mocks.generate.mockRejectedValueOnce(new Error(wallet.privateKey));
    const failed = await invoke("wallet.generator.generate", {});
    expect(JSON.stringify(failed.respond.mock.calls)).not.toContain(wallet.privateKey);
    expect(failed.respond).toHaveBeenCalledWith(false, undefined, {
      code: "UNAVAILABLE",
      message: "Wallet generation failed. Reconnect and try again.",
    });
    mocks.generate.mockRejectedValueOnce(new WalletGeneratorError("integrity"));
    const known = await invoke("wallet.generator.generate", {});
    expect(known.respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ details: { code: "integrity" } }),
    );
  });

  it("enforces read-only status and admin-only generation at real dispatch admission", async () => {
    const context = createContext();
    const registry = createGatewayMethodRegistry(
      createCoreGatewayMethodDescriptors(walletGeneratorHandlers),
    );
    const client: GatewayClient = {
      connect: {
        minProtocol: 1,
        maxProtocol: 1,
        client: { id: "openclaw-control-ui", version: "test", platform: "test", mode: "ui" },
        role: "operator",
        scopes: ["operator.read"],
      },
    };
    const admit = (method: string) =>
      authorizeGatewayRequestPreDispatch({
        method,
        requestParams: {},
        client,
        context,
        methodRegistry: registry,
      });
    expect((await admit("wallet.generator.status")).error).toBeNull();
    expect((await admit("wallet.generator.generate")).error).toMatchObject({
      code: "FORBIDDEN",
    });
    expect(mocks.generate).not.toHaveBeenCalled();
    client.connect.scopes = ["operator.admin"];
    expect((await admit("wallet.generator.generate")).error).toBeNull();
    const accepted = await invoke("wallet.generator.generate", {}, { client, context });
    expect(accepted.respond).toHaveBeenCalledWith(true, wallet);
    expect(listCoreGatewayHandlerMethodNames().get("wallet-generator")).toEqual([
      "wallet.generator.status",
      "wallet.generator.generate",
    ]);
    expect(resolveCoreOperatorGatewayMethodScope("wallet.generator.status")).toBe("operator.read");
    expect(resolveCoreOperatorGatewayMethodScope("wallet.generator.generate")).toBe(
      "operator.admin",
    );
  });
});
