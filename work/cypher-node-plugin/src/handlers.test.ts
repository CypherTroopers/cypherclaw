import {
  ErrorCodes,
  type GatewayRequestHandlerOptions,
  type GatewayRequestHandlers,
} from "openclaw/plugin-sdk/gateway-runtime";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerCypherMethods } from "./handlers.js";
import { CypherPluginService } from "./service.js";

const services: CypherPluginService[] = [];
afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.stop()));
  vi.restoreAllMocks();
});

function fixture(scopes = ["operator.admin"]) {
  const service = new CypherPluginService("/fixture/plugin");
  service.start("/fixture/state");
  services.push(service);
  const handlers = new Map<string, GatewayRequestHandlers[string]>();
  const api: Pick<OpenClawPluginApi, "registerGatewayMethod"> = {
    registerGatewayMethod: (name, handler) => {
      handlers.set(name, handler);
    },
  };
  registerCypherMethods(api, service);
  const connection = new AbortController();
  const client: NonNullable<GatewayRequestHandlerOptions["client"]> = {
    connect: {
      minProtocol: 1,
      maxProtocol: 1,
      client: { id: "openclaw-control-ui", version: "fixture", platform: "fixture", mode: "ui" },
      role: "operator",
      scopes,
    },
    connectionSignal: connection.signal,
  };
  async function invoke(method: string, params: Record<string, unknown> = {}) {
    const respond = vi.fn<GatewayRequestHandlerOptions["respond"]>();
    const handler = handlers.get(method);
    if (!handler) {
      throw new Error(`Missing fixture method ${method}`);
    }
    await handler({
      req: { type: "req", id: "fixture-request", method, params },
      params,
      client,
      respond,
      isWebchatConnect: () => false,
      hasCurrentClientAuthority: () => !connection.signal.aborted,
      // Independent plugin handlers consume no profile/session context in this host fixture.
      context: {} as GatewayRequestHandlerOptions["context"],
    });
    return respond;
  }
  return { service, invoke, client, connection };
}

describe("Cypher public Gateway method boundary", () => {
  it("lets a read operator inspect setup while refusing native preparation before its owner is called", async () => {
    const { service, invoke } = fixture(["operator.read"]);
    const installer = service.current().installer;
    const current = await installer.status();
    const prepare = vi.spyOn(installer, "prepare").mockResolvedValue(current);
    const read = await invoke("cypher.setup.status");
    expect(read).toHaveBeenCalledWith(true, current);
    const denied = await invoke("cypher.setup.prepare");
    expect(denied).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ code: ErrorCodes.FORBIDDEN }),
    );
    expect(prepare).not.toHaveBeenCalled();
  });

  it.each([
    [
      "cypher.transfers.prepare",
      { from: `0x${"1".repeat(40)}`, to: `0x${"2".repeat(40)}`, amount: 0.1 },
    ],
    [
      "cypher.transfers.prepare",
      { from: `0x${"1".repeat(40)}`, to: `0x${"2".repeat(40)}`, amount: "0.0000000000000000001" },
    ],
    [
      "cypher.transfers.send",
      { requestId: "invalid", quoteId: "invalid", password: "fixture-secret" },
    ],
    ["cypher.wallets.list", { limit: 51 }],
  ] as const)("rejects invalid %s input through the registered method", async (method, params) => {
    const { invoke } = fixture();
    const respond = await invoke(method, params);
    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ code: ErrorCodes.INVALID_REQUEST }),
    );
    expect(JSON.stringify(respond.mock.calls)).not.toContain("fixture-secret");
  });
});
