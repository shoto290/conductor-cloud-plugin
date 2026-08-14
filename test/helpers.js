// Test rig for the built server: a fake Conductor API on localhost, and a
// client that speaks the real protocol to `dist/index.js` over stdio.
//
// The tests drive the shipped bundle as a child process rather than importing
// its internals, because what a client sees — the handshake, the tool list, the
// text a tool call comes back with — is the whole contract this plugin has.
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

export const { version } = require("../package.json");
export const USER_AGENT = `conductor-cloud-plugin/${version}`;

// A stand-in shaped like a real key, so a leak into stdout or an error message
// is unmistakable. It authenticates nothing: every request goes to localhost.
export const TEST_API_KEY = "sk-cond-test-000000000000000000000000";

const SERVER = fileURLToPath(new URL("../dist/index.js", import.meta.url));

// Starts a fake API. `handle` receives one request and returns
// `{ status, body }`, `{ status, raw }` for a body that is not JSON, or the
// string "hang" to answer never — which is how the timeout is tested.
export async function startFakeApi(handle) {
  const requests = [];

  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString();
    const url = new URL(req.url, "http://fake.invalid");

    const request = {
      method: req.method,
      // Undecoded, so a test can prove an id was escaped rather than pasted in.
      rawUrl: req.url,
      path: decodeURIComponent(url.pathname),
      query: url.searchParams,
      headers: req.headers,
      body: raw ? JSON.parse(raw) : undefined,
    };
    requests.push(request);

    let reply;
    try {
      reply = await handle(request);
    } catch (error) {
      reply = { status: 500, body: { userMessage: String(error) } };
    }

    if (reply === "hang") return;

    if (!reply) {
      reply = {
        status: 404,
        body: { userMessage: `fake API has no route for ${req.method} ${request.path}` },
      };
    }

    const isJson = reply.raw === undefined;
    res.writeHead(reply.status ?? 200, {
      "Content-Type": isJson ? "application/json" : "text/html",
    });
    res.end(isJson ? JSON.stringify(reply.body ?? {}) : reply.raw);
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

  return {
    url: `http://127.0.0.1:${server.address().port}`,
    requests,
    async close() {
      // A hung request holds a socket open, and close() alone waits for it.
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

// Spawns the built server and completes the MCP handshake. Pass `apiKey: null`
// to start it with no key at all — the environment is built from scratch, so a
// real CONDUCTOR_API_KEY in the shell cannot leak into a run.
export async function startServer({
  apiBase,
  apiKey = TEST_API_KEY,
  timeoutMs,
} = {}) {
  const child = spawn(process.execPath, [SERVER], {
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      PATH: process.env.PATH,
      ...(apiKey === null ? {} : { CONDUCTOR_API_KEY: apiKey }),
      ...(apiBase === undefined ? {} : { CONDUCTOR_TEST_API_BASE: apiBase }),
      ...(timeoutMs === undefined
        ? {}
        : { CONDUCTOR_TEST_TIMEOUT_MS: String(timeoutMs) }),
    },
  });

  const client = new StdioClient(child);
  client.initializeResult = await client.initialize();
  return client;
}

// Starts a fake API and a server pointed at it, and shuts both down when the
// test ends. `handle` is the fake API's route table; the rest goes to
// startServer.
export async function connect(
  t,
  { handle = () => ({ body: {} }), ...options } = {},
) {
  const api = await startFakeApi(handle);
  // Keeping the /v0 prefix means the fake sees the paths the real API does.
  const client = await startServer({ apiBase: `${api.url}/v0`, ...options });

  t.after(async () => {
    await client.close();
    await api.close();
  });

  return { client, api };
}

class StdioClient {
  // Everything the server wrote, kept whole so a test can scan it for the key.
  stdout = "";
  stderr = "";

  #child;
  #pending = new Map();
  #nextId = 1;
  #buffer = "";
  #exit;

  constructor(child) {
    this.#child = child;

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      this.stdout += chunk;
      this.#buffer += chunk;

      const lines = this.#buffer.split("\n");
      this.#buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        const message = JSON.parse(line);
        const pending = this.#pending.get(message.id);
        if (!pending) continue;
        this.#pending.delete(message.id);
        pending(message);
      }
    });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => (this.stderr += chunk));

    this.#exit = new Promise((resolve) => child.on("exit", resolve));
    child.on("exit", () => {
      for (const pending of this.#pending.values()) {
        pending({ error: { message: `server exited: ${this.stderr}` } });
      }
      this.#pending.clear();
    });
  }

  request(method, params = {}) {
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, (message) => {
        if (message.error) reject(new Error(JSON.stringify(message.error)));
        else resolve(message.result);
      });
      this.#send({ jsonrpc: "2.0", id, method, params });
    });
  }

  notify(method, params = {}) {
    this.#send({ jsonrpc: "2.0", method, params });
  }

  async initialize() {
    const result = await this.request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "contract-tests", version: "0.0.0" },
    });
    this.notify("notifications/initialized");
    return result;
  }

  listTools() {
    return this.request("tools/list");
  }

  callTool(name, args = {}) {
    return this.request("tools/call", { name, arguments: args });
  }

  async close() {
    this.#child.kill();
    await this.#exit;
  }

  #send(message) {
    this.#child.stdin.write(`${JSON.stringify(message)}\n`);
  }
}

// The text a tool call returns, which is where every tool puts its answer —
// including the failures, which arrive as isError results rather than as
// JSON-RPC errors.
export function toolText(result) {
  return result.content.map((block) => block.text).join("\n");
}

// Fails the test if a tool call did not error, so an assertion about an error
// message can never quietly pass against a successful call.
export function errorText(result) {
  if (!result.isError) {
    throw new Error(`expected a tool error, got: ${toolText(result)}`);
  }
  return toolText(result);
}
