import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { callGatewayFromCli } from "openclaw/plugin-sdk/gateway-runtime";

const diagnostics = [
  {
    name: "cypher_setup_status",
    description: "Read Cypher native setup readiness. Does not download or start anything.",
    method: "cypher.setup.status",
    fields: ["state", "target", "node", "wallet", "error", "progress"],
  },
  {
    name: "cypher_node_status",
    description:
      "Read Cypher node connection, synchronization, and mining status. No node mutation.",
    method: "cypher.status",
    fields: ["supported", "platform", "arch", "state", "connected", "node", "error"],
  },
  {
    name: "cypher_wallet_balances",
    description:
      "Read the first page of Cypher wallet addresses and balances. Never returns private keys.",
    method: "cypher.wallets.list",
    fields: ["wallets", "total", "offset", "limit", "network", "readiness", "finalitySupported"],
  },
] as const;

/** The existing authenticated Gateway owns all node state and authorizes every read. */
export function createCypherMcpServer(): McpServer {
  const server = new McpServer(
    { name: "cypher", version: "0.1.0" },
    {
      instructions:
        "Cypher diagnostics are read-only. Use the Cypher management page for setup, node operations, sending funds, mining, and private wallet generation.",
      maxToolInputElements: 16,
    },
  );
  for (const tool of diagnostics) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: {},
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async (_params, extra) => {
        try {
          const value = await callGatewayFromCli(
            tool.method,
            { json: true, timeout: "30000" },
            {},
            { signal: extra.signal, progress: false, scopes: ["operator.read"] },
          );
          // Local paths and process logs belong to the operator UI, not model context.
          const result = Object.fromEntries(
            tool.fields.flatMap((field) =>
              Object.hasOwn(value, field) ? [[field, value[field]]] : [],
            ),
          );
          return {
            content: [{ type: "text", text: JSON.stringify(result) }],
            structuredContent: result,
          };
        } catch {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: "Cypher diagnostics are unavailable. Open the management page and check the Gateway connection and your read permissions.",
              },
            ],
          };
        }
      },
    );
  }
  return server;
}
