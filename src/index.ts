#!/usr/bin/env node
import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const { version } = createRequire(import.meta.url)("../package.json");

// The two CONDUCTOR_TEST_ variables are the seam the contract tests drive the
// server through: they point it at a local fake API and shorten the timeout so
// the whole suite runs without a key and without the network. Neither is a
// user setting — they are absent from the manifest, mcp.json, and the README.
const API_BASE =
  process.env.CONDUCTOR_TEST_API_BASE ?? "https://api.conductor.build/v0";
// Conductor answers 403 to clients that do not identify themselves.
const USER_AGENT = `conductor-cloud-plugin/${version}`;
const API_KEYS_URL = "https://app.conductor.build/users/api-keys";
// Without this, a hung connection stalls the agent for undici's 5-minute default.
const TIMEOUT_MS = Number(process.env.CONDUCTOR_TEST_TIMEOUT_MS) || 15_000;

// The transcript endpoint pages five events at a time by default, and a single
// turn is dozens of events — ask for a page worth reading, and stop walking
// before a very long session floods the agent with requests.
const PAGE_SIZE = 200;
const MAX_PAGES = 25;
const MAX_TURNS = 30;
// Long enough for a real explanation, short enough to stop a repeated
// validation clause from crowding out the answer.
const MAX_DETAIL = 400;

// The models each agent accepts, as listed by the API spec. They are named here
// because the API's rejection message does not name them: a bad model id comes
// back as "body/model must be equal to constant" repeated once per valid value.
// The spec at https://api.conductor.build/v0/openapi.json stays authoritative.
const MODELS = `claude: fable-5, opus-5-1m, opus-4-8-1m, opus-4-8, opus-4-7-1m, opus-4-7, opus-1m, opus, opus-4-6-1m, sonnet-5-1m, sonnet-4-6-1m, sonnet, haiku; codex: gpt-5.5, gpt-5.4, gpt-5.6-sol, gpt-5.6-terra, gpt-5.6-luna, gpt-5.3-codex-spark, gpt-5.3-codex, gpt-5.2-codex; cursor: auto, composer-2.5, grok-4.6, grok-4.5`;

// Only the shapes this file reads a field out of are declared. Responses that
// are handed back to the agent verbatim stay untyped: a second copy of a beta
// contract that nothing checks is a copy that silently goes stale.
type Project = { id: string; name: string; gitRemote: string };
type ProjectPage = { data: Project[]; hasMore: boolean };
type SessionStatus = {
  workspaceId: string;
  sessionId: string;
  status: "idle" | "working" | "error";
  updatedAt: string;
  errorMessage?: string;
};
type WorkspaceStatus = {
  workspaceId: string;
  status:
    | "initializing"
    | "ready"
    | "sleeping"
    | "archived"
    | "deleted"
    | "updating";
  lifecycleStep?: string;
  updatedAt: string;
  errorMessage?: string;
};
type TranscriptMessage = { id: string; type: string; content: unknown };
type TranscriptPage = { data: TranscriptMessage[]; hasMore: boolean };

function text(value: string) {
  return { content: [{ type: "text" as const, text: value }] };
}

const json = (value: unknown) => text(JSON.stringify(value));

const sessionPath = (id: string, suffix = "") =>
  `/sessions/${encodeURIComponent(id)}${suffix}`;
const workspacePath = (id: string, suffix = "") =>
  `/workspaces/${encodeURIComponent(id)}${suffix}`;

// Throws with a message written for the user: McpServer turns a thrown Error
// into an isError tool result carrying exactly that text, so tools need no
// try/catch of their own.
//
// The key is read per request, from the environment only — never a tool
// argument, never logged, never included in an error message.
async function conductorRequest<T = unknown>(
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<T> {
  const apiKey = process.env.CONDUCTOR_API_KEY;
  if (!apiKey) {
    throw new Error(
      `CONDUCTOR_API_KEY is not set. Create a key at ${API_KEYS_URL} and set it as the plugin variable (or in the MCP server's env), then restart the editor.`,
    );
  }

  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "User-Agent": USER_AGENT,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  }).catch((cause: Error) => {
    throw new Error(`Could not reach the Conductor API: ${cause.message}`);
  });

  if (!response.ok) throw new Error(await describeFailure(response));

  return (await response.json()) as T;
}

const conductorGet = <T = unknown>(path: string) =>
  conductorRequest<T>("GET", path);
const conductorPost = <T = unknown>(path: string, body?: unknown) =>
  conductorRequest<T>("POST", path, body);

async function describeFailure(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as {
    userMessage?: string;
  } | null;
  // Validation failures repeat one clause per accepted value — 25 of them for a
  // bad model id. Everything past the first clause is noise in the transcript,
  // but say where the cut is: a message trimmed in silence reads as the whole.
  const message = body?.userMessage ?? response.statusText;
  const detail =
    message.length > MAX_DETAIL ? `${message.slice(0, MAX_DETAIL)}…` : message;

  if (response.status === 401) {
    return `Conductor rejected the API key (401: ${detail}). Set CONDUCTOR_API_KEY to a valid key from ${API_KEYS_URL}, then restart the editor. Cloud workspaces require a Pro, Teams, or Enterprise plan.`;
  }

  return `Conductor API request failed (${response.status}): ${detail}`;
}

// A transcript entry is a raw event: one per tool call, thinking block, and
// lifecycle change. Only what the two sides actually said is worth an agent's
// context, so everything else is dropped.
function spokenText(message: TranscriptMessage): string | null {
  const content = message.content as {
    message?: unknown;
    rawPayload?: { type?: string; message?: { content?: unknown } };
  } | null;

  if (message.type === "userMessage") {
    return typeof content?.message === "string"
      ? `user: ${content.message}`
      : null;
  }

  const payload = content?.rawPayload;
  if (payload?.type !== "assistant") return null;

  const blocks = payload.message?.content;
  if (!Array.isArray(blocks)) return null;

  const said = blocks
    .filter((block) => block?.type === "text" && typeof block.text === "string")
    .map((block) => block.text as string)
    .join("\n");

  return said ? `assistant: ${said}` : null;
}

// Walks forward from `after` (or from the start of the session) to the newest
// event, keeping only the last MAX_TURNS of spoken text — the API pages from
// the front and cannot seek to the end, so reaching the newest turn means
// walking past the older ones, but it does not mean holding on to them.
//
// The cursor returned is an event id, which is what the API's `after` accepts
// — not the message id send_prompt hands back.
async function readTranscript(sessionId: string, after?: string) {
  const turns: string[] = [];
  let total = 0;
  let cursor = after;

  for (let page = 0; page < MAX_PAGES; page++) {
    const query = new URLSearchParams({ limit: String(PAGE_SIZE) });
    if (cursor) query.set("after", cursor);

    const { data, hasMore } = await conductorGet<TranscriptPage>(
      sessionPath(sessionId, `/messages?${query}`),
    );

    for (const message of data) {
      const said = spokenText(message);
      if (!said) continue;
      total++;
      if (turns.push(said) > MAX_TURNS) turns.shift();
    }
    if (data.length > 0) cursor = data[data.length - 1].id;

    if (!hasMore) return { turns, total, cursor, hasMore: false };
  }

  return { turns, total, cursor, hasMore: true };
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

server.registerTool(
  "create_workspace",
  {
    title: "Create a Conductor Cloud workspace",
    description:
      "Create a cloud workspace — a sandbox on its own git branch — and its first session, then return the workspaceId, sessionId, and a deep link that opens it in the Conductor desktop app. The workspace starts with the repository and nothing else, so follow this with send_prompt to hand over the brief.\n\n" +
      `Model ids by agent — ${MODELS}. Effort by agent — claude: low, medium, high, xhigh, max; codex: none, low, medium, high, xhigh, max, ultra, where max needs a GPT-5.6 model and ultra needs Sol or Terra. Omit effort for the agent's default of high.`,
    inputSchema: {
      projectId: z
        .string()
        .describe(
          "Project id from list_projects. Never guess one — call that tool first.",
        ),
      name: z
        .string()
        .min(1)
        .describe(
          "Workspace name. It becomes the git branch, so name it after the job.",
        ),
      agent: z
        .string()
        .describe("Coding agent to run: claude, codex, or cursor."),
      model: z
        .string()
        .describe(
          "Model id, which must belong to the chosen agent — see the tool description for the list.",
        ),
      effort: z
        .string()
        .optional()
        .describe("Reasoning effort. Omit for the agent's default."),
      branch: z
        .string()
        .optional()
        .describe(
          "Branch to start the work from. Omit for the repository's default branch.",
        ),
    },
    annotations: { openWorldHint: true },
  },
  async (args) => json(await conductorPost("/workspaces", args)),
);

server.registerTool(
  "send_prompt",
  {
    title: "Send a prompt to a cloud session",
    description:
      "Send a message to a cloud session — the opening brief, or a follow-up once it has replied. The session shares no context with this conversation: it has the repository and nothing else, so the brief must name the files or area to touch, the approach and any constraint, and the definition of done. Never put a secret in a prompt; cloud chat is stored on Conductor's servers and readable by the whole organization. The reply's state is 'sent', or 'queued' while the workspace is still starting — a queued message has not begun a turn yet.",
    inputSchema: {
      sessionId: z.string().describe("Session id from create_workspace."),
      message: z
        .string()
        .min(1)
        .describe("The brief. Self-contained: the session cannot see this chat."),
    },
    annotations: { openWorldHint: true },
  },
  async ({ sessionId, message }) =>
    json(await conductorPost(sessionPath(sessionId, "/messages"), { message })),
);

server.registerTool(
  "get_session_status",
  {
    title: "Check a cloud session",
    description:
      "Report whether a cloud session is working, along with the state of the workspace it runs in. A turn is done when this reports 'idle' and get_transcript returns new content after your cursor — 'idle' on its own is ambiguous, because a session also reads 'idle' before its first turn starts. Seeing 'working' confirms a turn began but is not required: a short turn can start and finish between two polls, so do not block waiting for it. Expect a workspace that is still 'initializing', or one that has gone 'sleeping' after four idle hours.",
    inputSchema: {
      sessionId: z.string().describe("Session id to check."),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ sessionId }) => {
    const session = await conductorGet<SessionStatus>(
      sessionPath(sessionId, "/status"),
    );
    const workspace = await conductorGet<WorkspaceStatus>(
      workspacePath(session.workspaceId, "/status"),
    );

    return json({
      sessionId: session.sessionId,
      workspaceId: session.workspaceId,
      session: session.status,
      workspace: workspace.status,
      lifecycleStep: workspace.lifecycleStep,
      updatedAt: session.updatedAt,
      errorMessage: session.errorMessage ?? workspace.errorMessage,
    });
  },
);

server.registerTool(
  "get_transcript",
  {
    title: "Read a cloud session's transcript",
    description:
      "Read what a cloud session has said: the user messages and the agent's replies, oldest first. Tool calls, reasoning, and lifecycle events are left out. Every call ends with a cursor — pass it back as `after` on the next poll to fetch only what has arrived since, instead of re-reading the whole session.",
    inputSchema: {
      sessionId: z.string().describe("Session id to read."),
      after: z
        .string()
        .optional()
        .describe(
          "Cursor from a previous call to this tool. Omit to read from the start of the session.",
        ),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ sessionId, after }) => {
    const { turns, total, cursor, hasMore } = await readTranscript(
      sessionId,
      after,
    );

    const notes = [];
    if (total > turns.length) {
      notes.push(`showing the last ${turns.length} of ${total} turns`);
    }
    if (cursor) {
      notes.push(`cursor: ${cursor} — pass as "after" to read only what follows`);
    }
    // Only reachable by exhausting MAX_PAGES, so the newest turns are missing.
    if (hasMore) {
      notes.push(
        `stopped after ${MAX_PAGES} pages; call again with that cursor to keep reading`,
      );
    }

    const body = turns.length
      ? turns.join("\n\n")
      : `Nothing said ${after ? "since that cursor" : "in this session"} yet. Check get_session_status, then poll again.`;
    const footer = notes.map((note) => `[${note}]`).join("\n");

    return text(footer ? `${body}\n\n${footer}` : body);
  },
);

server.registerTool(
  "get_workspace",
  {
    title: "Get a Conductor workspace",
    description:
      "Look up a cloud workspace by id. Returns its name and the deep link that opens it in the Conductor desktop app — hand that link to the user so they can watch the session or take it over themselves.",
    inputSchema: {
      workspaceId: z.string().describe("Workspace id from create_workspace."),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ workspaceId }) => json(await conductorGet(workspacePath(workspaceId))),
);

server.registerTool(
  "cancel_session",
  {
    title: "Cancel a running cloud session",
    description:
      "Stop a cloud session's in-progress turn and drop any messages still queued for it. This destroys work in flight — ask the user before calling it, and be especially careful with a session you did not start. The workspace and the chat history survive. Cancelling is idempotent and finishes asynchronously: poll get_session_status until the session reads 'idle' to confirm.",
    inputSchema: {
      sessionId: z.string().describe("Session id to stop."),
    },
    annotations: { destructiveHint: true, openWorldHint: true },
  },
  async ({ sessionId }) =>
    json(await conductorPost(sessionPath(sessionId, "/cancel"))),
);

await server.connect(new StdioServerTransport());
