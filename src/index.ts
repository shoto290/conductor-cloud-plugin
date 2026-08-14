#!/usr/bin/env node
import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const { version } = createRequire(import.meta.url)("../package.json");

const API_BASE = "https://api.conductor.build/v0";
// Conductor answers 403 to clients that do not identify themselves.
const USER_AGENT = `conductor-cloud-plugin/${version}`;
const API_KEYS_URL = "https://app.conductor.build/users/api-keys";
// Without this, a hung connection stalls the agent for undici's 5-minute default.
const TIMEOUT_MS = 15_000;

type Project = { id: string; name: string; gitRemote: string };
type ProjectPage = { data: Project[]; hasMore: boolean };

function text(value: string) {
  return { content: [{ type: "text" as const, text: value }] };
}

// Throws with a message written for the user: McpServer turns a thrown Error
// into an isError tool result carrying exactly that text, so tools need no
// try/catch of their own.
//
// The key is read per request, from the environment only — never a tool
// argument, never logged, never included in an error message.
async function conductorGet<T>(path: string): Promise<T> {
  const apiKey = process.env.CONDUCTOR_API_KEY;
  if (!apiKey) {
    throw new Error(
      `CONDUCTOR_API_KEY is not set. Create a key at ${API_KEYS_URL} and set it as the plugin variable (or in the MCP server's env), then restart the editor.`,
    );
  }

  const response = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${apiKey}`, "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  }).catch((cause: Error) => {
    throw new Error(`Could not reach the Conductor API: ${cause.message}`);
  });

  if (!response.ok) throw new Error(await describeFailure(response));

  return (await response.json()) as T;
}

async function describeFailure(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as {
    userMessage?: string;
  } | null;
  const detail = body?.userMessage ?? response.statusText;

  if (response.status === 401) {
    return `Conductor rejected the API key (401: ${detail}). Set CONDUCTOR_API_KEY to a valid key from ${API_KEYS_URL}, then restart the editor. Cloud workspaces require a Pro, Teams, or Enterprise plan.`;
  }

  return `Conductor API request failed (${response.status}): ${detail}`;
}

const server = new McpServer({ name: "conductor-cloud", version });

server.registerTool(
  "list_projects",
  {
    title: "List Conductor projects",
    description:
      "List the repositories connected to Conductor Cloud. Returns each project's id — which creating a workspace requires — along with its name and git remote. Start here when the user asks to run something in the cloud.",
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async () => {
    const { data, hasMore } = await conductorGet<ProjectPage>("/projects");

    if (data.length === 0) {
      return text(
        "No projects are connected to Conductor Cloud. Connect a GitHub repository at https://app.conductor.build first.",
      );
    }

    // Say so rather than passing off a first page as the whole list.
    const truncated = hasMore
      ? "\n\nThis is the first page; the account has more projects than are listed here."
      : "";

    return text(JSON.stringify(data) + truncated);
  },
);

await server.connect(new StdioServerTransport());
