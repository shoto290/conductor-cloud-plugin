#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

// Scaffold only: the server starts and advertises an empty tool list. Nothing
// here calls the Conductor API yet. When the first tool lands, read the
// credential from process.env.CONDUCTOR_API_KEY — never from a tool argument,
// and never log it. See CLOUD.md for the API contract.
const server = new Server(
  { name: "conductor-cloud", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [] }));

await server.connect(new StdioServerTransport());
