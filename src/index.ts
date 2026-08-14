#!/usr/bin/env node
import { createRequire } from "node:module";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const { version } = createRequire(import.meta.url)("../package.json");

// Scaffold only: the server starts and advertises an empty tool list. Nothing
// here calls the Conductor API yet. When the first tool lands, read the
// credential from process.env.CONDUCTOR_API_KEY — never from a tool argument,
// and never log it. API contract: https://www.conductor.build/docs/api
//
// Adding that tool means switching to McpServer and deleting the handler below:
// McpServer.registerTool installs its own tools/list, and it throws if this one
// is already registered. The low-level Server exists only because McpServer
// answers tools/list with "Method not found" until a tool is registered.
const server = new Server(
  { name: "conductor-cloud", version },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [] }));

await server.connect(new StdioServerTransport());
