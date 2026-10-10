import { beforeEach, describe, expect, it, vi } from "vitest";
import { CypherOperationError, type CypherAuthority } from "../../cypher/manager.js";
import {
  listCoreGatewayHandlerMethodNames,
  resolveCoreOperatorGatewayMethodScope,
} from "../methods/core-method-policy.js";
import { cypherHandlers } from "./cypher.js";
import type { GatewayRequestContext, GatewayRequestHandlerOptions } from "./types.js";

const mocks = vi.hoisted(() => ({
  constructed: vi.fn(),
  readAuthority: vi.fn(),
  status: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
  startMining: vi.fn(),
  stopMining: vi.fn(),
  createAccount: vi.fn(),
  selectAccount: vi.fn(),
  unlockAccount: vi.fn(),
  lockAccount: vi.fn(),
  getReward: vi.fn(),
  setReward: vi.fn(),
  wallets: vi.fn(),
  transfers: vi.fn(),
  prepareTransfer: vi.fn(),
  sendTransfer: vi.fn(),
}));

vi.mock("./session-mutation-guards.js", () => ({
  readGatewayRequestMutationAuthority: mocks.readAuthority,
}));

vi.mock("../../cypher/manager.js", async (original) => {
  const actual = await original<typeof import("../../cypher/manager.js")>();
  return {
    CypherOperationError: actual.CypherOperationError,
    isCypherAddress: actual.isCypherAddress,
    CypherNodeManager: class {
      constructor() {
        mocks.constructed();
      }
      status = mocks.status;
      start = mocks.start;
      stop = mocks.stop;
      connect = mocks.connect;
      disconnect = mocks.disconnect;
      startMining = mocks.startMining;
      stopMining = mocks.stopMining;
      createAccount = mocks.createAccount;
      selectAccount = mocks.selectAccount;
      unlockAccount = mocks.unlockAccount;
      lockAccount = mocks.lockAccount;
      getReward = mocks.getReward;
      setReward = mocks.setReward;
      wallets = mocks.wallets;
      transfers = mocks.transfers;
      prepareTransfer = mocks.prepareTransfer;
      sendTransfer = mocks.sendTransfer;
    },
  };
});

const signer = "0x1111111111111111111111111111111111111111";
const recipient = "0x2222222222222222222222222222222222222222";

async function invoke(
  method: string,
  params: Record<string, unknown>,
  overrides: Partial<GatewayRequestHandlerOptions> = {},
) {
  const respond = vi.fn();
  const options: GatewayRequestHandlerOptions = {
    req: { type: "req", id: "cypher-test", method, params },
    params,
    client: null,
    isWebchatConnect: () => false,
    respond,
    context: {} as GatewayRequestContext,
    ...overrides,
  };
  const handler = cypherHandlers[method];
  if (!handler) {
    throw new Error(`Missing Cypher handler ${method}`);
  }
  await handler(options);
  return { respond, options };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.status.mockResolvedValue({ state: "stopped" });
  mocks.readAuthority.mockReturnValue({ assertCurrent: vi.fn() });
});

describe("Cypher Gateway boundary", () => {
  it.each([
    ["cypher.start", { script: "arbitrary.exe" }],
    ["cypher.connect", { ipcPath: "/other/node.ipc" }],
    ["cypher.mining.start", { threads: 0, signer, password: "fixture" }],
    ["cypher.mining.start", { threads: 257, signer, password: "fixture" }],
    ["cypher.mining.start", { threads: 1.5, signer, password: "fixture" }],
    ["cypher.accounts.create", { password: "x".repeat(4097) }],
    ["cypher.accounts.select", { address: "0x" + "0".repeat(40) }],
    ["cypher.accounts.unlock", { address: signer, password: "fixture", duration: 86_401 }],
    ["cypher.accounts.lock", { address: "personal.newAccount('fixture')" }],
    ["cypher.wallets.list", { limit: 51 }],
    ["cypher.wallets.list", { offset: -1 }],
    ["cypher.transfers.list", { limit: 101 }],
    ["cypher.transfers.prepare", { from: signer, to: recipient, amount: 0.1 }],
    ["cypher.transfers.prepare", { from: signer, to: recipient, amount: "0" }],
    ["cypher.transfers.prepare", { from: signer, to: recipient, amount: "0.0000000000000000001" }],
    ["cypher.transfers.send", { requestId: "invalid", quoteId: "invalid", password: "fixture" }],
    [
      "cypher.reward.set",
      { signer, recipient: signer.toUpperCase().replace("0X", "0x"), password: "fixture" },
    ],
    [
      "cypher.reward.set",
      { signer, recipient, password: "fixture", rpcMethod: "eth_sendTransaction" },
    ],
  ])("rejects unsafe %s input before constructing a node manager", async (method, params) => {
    const { respond } = await invoke(method, params);
    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ code: "INVALID_REQUEST" }),
    );
    expect(mocks.constructed).not.toHaveBeenCalled();
  });

  it("rejects a revoked caller before starting the node", async () => {
    mocks.readAuthority.mockReturnValue({
      assertCurrent: () => {
        throw new Error("Fixture caller revoked");
      },
    });
    const { respond } = await invoke("cypher.start", {});
    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ code: "UNAVAILABLE" }),
    );
    expect(mocks.constructed).not.toHaveBeenCalled();
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it("passes the live authority and cancellation signal through awaited preparation", async () => {
    let current = true;
    const controller = new AbortController();
    const assertCurrent = () => {
      if (!current) {
        throw new Error("Fixture caller revoked");
      }
    };
    mocks.readAuthority.mockReturnValue({ assertCurrent });
    mocks.startMining.mockImplementationOnce(
      async (_params: unknown, authority: CypherAuthority) => {
        expect(authority.signal).toBe(controller.signal);
        expect(authority.assertCurrent).toBe(assertCurrent);
        authority.assertCurrent();
        await Promise.resolve();
        current = false;
        authority.assertCurrent();
      },
    );
    const { respond } = await invoke(
      "cypher.mining.start",
      { threads: 2, signer, password: "fixture" },
      {
        signal: controller.signal,
      },
    );
    expect(mocks.startMining).toHaveBeenCalledWith(
      { threads: 2, signer, password: "fixture" },
      expect.objectContaining({ assertCurrent: expect.any(Function), signal: controller.signal }),
    );
    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ code: "UNAVAILABLE" }),
    );
  });

  it("keeps one node manager per Gateway context", async () => {
    const context = {} as GatewayRequestContext;
    await invoke("cypher.status", {}, { context });
    const firstManager = context.cypherNodeManager;
    await invoke("cypher.status", {}, { context });
    expect(context.cypherNodeManager).toBe(firstManager);
    expect(mocks.constructed).toHaveBeenCalledOnce();
    const other = await invoke("cypher.status", {});
    expect(other.options.context.cypherNodeManager).not.toBe(firstManager);
    expect(mocks.constructed).toHaveBeenCalledTimes(2);
  });

  it("returns only safe operation errors and never raw node errors", async () => {
    mocks.createAccount.mockRejectedValueOnce(new Error("fixture private password"));
    const failed = await invoke("cypher.accounts.create", { password: "fixture private password" });
    expect(failed.respond).toHaveBeenCalledWith(false, undefined, {
      code: "UNAVAILABLE",
      message: "ColossusX operation failed. Check the node status and try again.",
    });
    mocks.stop.mockRejectedValueOnce(
      new CypherOperationError("This Gateway does not own this node."),
    );
    const safe = await invoke("cypher.stop", {});
    expect(safe.respond).toHaveBeenCalledWith(false, undefined, {
      code: "UNAVAILABLE",
      message: "This Gateway does not own this node.",
      details: { code: "CYPHER_OPERATION" },
    });
  });

  it("advertises only bounded Cypher methods with admin authority for operations", () => {
    const methods = Object.keys(cypherHandlers);
    expect(listCoreGatewayHandlerMethodNames().get("cypher")).toEqual(methods);
    for (const method of methods) {
      expect(resolveCoreOperatorGatewayMethodScope(method)).toBe(
        ["cypher.status", "cypher.wallets.list", "cypher.transfers.list"].includes(method)
          ? "operator.read"
          : "operator.admin",
      );
    }
    expect(methods).not.toContain("cypher.rpc");
    expect(methods).not.toContain("cypher.execute");
  });
});
