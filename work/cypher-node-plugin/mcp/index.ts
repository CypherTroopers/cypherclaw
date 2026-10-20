import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createCypherMcpServer } from "./server.js";

const server = createCypherMcpServer();
server.server.onerror = () =>
  process.stderr.write("Cypher MCP transport error. Check the client connection.\n");
await server.connect(new StdioServerTransport());
process.once("SIGINT", () => void server.close());
process.once("SIGTERM", () => void server.close());
