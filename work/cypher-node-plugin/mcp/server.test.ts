import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, expect, test, vi } from "vitest";

// The transport boundary is the external Gateway; MCP parsing and tool dispatch stay real.
const rpc = vi.hoisted(() => vi.fn());
vi.mock("openclaw/plugin-sdk/gateway-runtime", () => ({ callGatewayFromCli: rpc }));
import { createCypherMcpServer } from "./server.js";

const close: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(close.splice(0).map((dispose) => dispose()));
  rpc.mockReset();
});

async function connect() {
  const server = createCypherMcpServer();
  const client = new Client({ name: "cypher-acceptance", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  close.push(
    () => client.close(),
    () => server.close(),
  );
  return client;
}

test("MCP discovery performs no Gateway I/O and exposes only read-only diagnostics", async () => {
  const client = await connect();
  const result = await client.listTools();
  expect(result.tools).toHaveLength(3);
  expect(result.tools.every((tool) => tool.annotations?.readOnlyHint === true)).toBe(true);
  expect(rpc).not.toHaveBeenCalled();
});

test("node diagnostics cross MCP and Gateway boundaries without returning local paths or process logs", async () => {
  const client = await connect();
  rpc.mockResolvedValue({
    state: "running",
    connected: true,
    node: { blockNumber: "0x7", mining: false },
    rootDir: "/private/operator",
    logs: ["private diagnostic"],
  });
  const result = await client.callTool({ name: "cypher_node_status", arguments: {} });
  expect(result.isError).not.toBe(true);
  expect(result.structuredContent).toEqual({
    state: "running",
    connected: true,
    node: { blockNumber: "0x7", mining: false },
  });
  expect(JSON.stringify(result)).not.toContain("private");
  expect(rpc).toHaveBeenCalledWith(
    "cypher.status",
    { json: true, timeout: "30000" },
    {},
    expect.objectContaining({
      scopes: ["operator.read"],
      progress: false,
      signal: expect.any(AbortSignal),
    }),
  );
});

test("a refused Gateway read produces an actionable MCP error without disclosing the upstream error", async () => {
  const client = await connect();
  rpc.mockRejectedValue(new Error("secret-token-in-upstream-url"));
  const result = await client.callTool({ name: "cypher_setup_status", arguments: {} });
  expect(result.isError).toBe(true);
  expect(JSON.stringify(result)).toContain("read permissions");
  expect(JSON.stringify(result)).not.toContain("secret-token");
});
