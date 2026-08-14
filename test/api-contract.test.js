// What each tool sends to Conductor, and what it makes of the answer —
// including the answers that are failures.
import assert from "node:assert/strict";
import test from "node:test";

import {
  TEST_API_KEY,
  USER_AGENT,
  connect,
  errorText,
  startFakeApi,
  startServer,
  toolText,
} from "./helpers.js";

const json = (result) => JSON.parse(toolText(result));

test("requests authenticate with the key and identify the client", async (t) => {
  const { client, api } = await connect(t, {
    handle: () => ({ body: { data: [], hasMore: false } }),
  });

  await client.callTool("list_projects");
  const [request] = api.requests;

  assert.equal(request.headers.authorization, `Bearer ${TEST_API_KEY}`);
  // Conductor answers 403 to clients that do not identify themselves.
  assert.equal(request.headers["user-agent"], USER_AGENT);
  assert.equal(request.method, "GET");
  assert.equal(request.path, "/v0/projects");
});

test("a POST sends JSON, and a POST with no body sends no content type", async (t) => {
  const { client, api } = await connect(t, { handle: () => ({ body: { ok: true } }) });

  await client.callTool("continue_session", { sessionId: "s1", message: "ship it" });
  await client.callTool("cancel_session", { sessionId: "s1" });

  const [prompt, cancel] = api.requests;

  assert.equal(prompt.method, "POST");
  assert.equal(prompt.headers["content-type"], "application/json");
  assert.deepEqual(prompt.body, { message: "ship it" });
  assert.equal(prompt.headers.authorization, `Bearer ${TEST_API_KEY}`);

  assert.equal(cancel.method, "POST");
  assert.equal(cancel.headers["content-type"], undefined);
  assert.equal(cancel.body, undefined);
});

test("each tool hits its own endpoint and hands the answer back whole", async (t) => {
  // deepLink is the field the real API sends, on both of these.
  const created = {
    workspaceId: "w1",
    sessionId: "s1",
    deepLink: "conductor://workspace?id=w1",
  };
  const workspace = {
    id: "w1",
    name: "fix-login",
    deepLink: "conductor://workspace?id=w1",
  };

  const { client, api } = await connect(t, {
    handle: (request) => {
      if (request.path === "/v0/workspaces" && request.method === "POST") {
        return { body: created };
      }
      if (request.path === "/v0/workspaces/w1") return { body: workspace };
      if (request.path === "/v0/sessions/s1/cancel") return { body: { cancelled: true } };
      return null;
    },
  });

  const create = await client.callTool("create_workspace", {
    projectId: "p1",
    name: "fix-login",
    agent: "claude",
    model: "opus-5-1m",
    effort: "high",
  });

  assert.deepEqual(json(create), created);
  assert.deepEqual(api.requests[0].body, {
    projectId: "p1",
    name: "fix-login",
    agent: "claude",
    model: "opus-5-1m",
    effort: "high",
  });
  // An omitted optional stays omitted rather than going out as null.
  assert.ok(!("branch" in api.requests[0].body));

  assert.deepEqual(json(await client.callTool("get_workspace", { workspaceId: "w1" })), workspace);
  assert.deepEqual(json(await client.callTool("cancel_session", { sessionId: "s1" })), {
    cancelled: true,
  });
});

test("an id goes into the path escaped, not pasted in", async (t) => {
  const { client, api } = await connect(t, { handle: () => ({ body: {} }) });

  // A client that forwarded this raw would aim the request at another route.
  await client.callTool("cancel_session", { sessionId: "s 1/../admin" });

  assert.equal(api.requests[0].rawUrl, "/v0/sessions/s%201%2F..%2Fadmin/cancel");
});

test("list_projects says when the account has no projects", async (t) => {
  const { client } = await connect(t, {
    handle: () => ({ body: { data: [], hasMore: false } }),
  });

  const message = toolText(await client.callTool("list_projects"));

  assert.match(message, /No projects are connected/);
  assert.match(message, /app\.conductor\.build/);
});

test("list_projects admits when it is showing only the first page", async (t) => {
  const projects = [{ id: "p1", name: "app", gitRemote: "git@github.com:x/app.git" }];
  const { client } = await connect(t, {
    handle: () => ({ body: { data: projects, hasMore: true } }),
  });

  const message = toolText(await client.callTool("list_projects"));

  assert.match(message, /"id":"p1"/);
  assert.match(message, /first page/);
});

test("get_session_status reports the session and the workspace it runs in", async (t) => {
  const { client, api } = await connect(t, {
    handle: (request) => {
      if (request.path === "/v0/sessions/s1/status") {
        return {
          body: {
            sessionId: "s1",
            workspaceId: "w1",
            status: "working",
            updatedAt: "2026-08-14T10:00:00.000Z",
          },
        };
      }
      if (request.path === "/v0/workspaces/w1/status") {
        return {
          body: {
            workspaceId: "w1",
            status: "initializing",
            lifecycleStep: "cloning",
            updatedAt: "2026-08-14T09:59:00.000Z",
          },
        };
      }
      return null;
    },
  });

  const status = json(await client.callTool("get_session_status", { sessionId: "s1" }));

  // The workspace is looked up from the session's own workspaceId, so an agent
  // holding a session id alone still learns the sandbox is not up yet.
  assert.deepEqual(api.requests.map((request) => request.path), [
    "/v0/sessions/s1/status",
    "/v0/workspaces/w1/status",
  ]);
  assert.deepEqual(status, {
    sessionId: "s1",
    workspaceId: "w1",
    session: "working",
    workspace: "initializing",
    lifecycleStep: "cloning",
    updatedAt: "2026-08-14T10:00:00.000Z",
  });
});

test("get_session_status surfaces the workspace's error when the session has none", async (t) => {
  const { client } = await connect(t, {
    handle: (request) =>
      request.path === "/v0/sessions/s1/status"
        ? {
            body: {
              sessionId: "s1",
              workspaceId: "w1",
              status: "idle",
              updatedAt: "2026-08-14T10:00:00.000Z",
            },
          }
        : {
            body: {
              workspaceId: "w1",
              status: "error",
              updatedAt: "2026-08-14T10:00:00.000Z",
              errorMessage: "clone failed: repository not found",
            },
          },
  });

  const status = json(await client.callTool("get_session_status", { sessionId: "s1" }));

  assert.equal(status.errorMessage, "clone failed: repository not found");
});

test("an API failure arrives with Conductor's own userMessage", async (t) => {
  const { client } = await connect(t, {
    handle: () => ({
      status: 400,
      body: { userMessage: "body/model must be equal to constant" },
    }),
  });

  const message = errorText(
    await client.callTool("create_workspace", {
      projectId: "p1",
      name: "job",
      agent: "claude",
      model: "gpt-5.6-sol",
    }),
  );

  assert.match(message, /Conductor API request failed \(400\)/);
  assert.match(message, /body\/model must be equal to constant/);
});

test("a rejected key explains how to replace it, without quoting it", async (t) => {
  const { client } = await connect(t, {
    handle: () => ({ status: 401, body: { userMessage: "Invalid API key" } }),
  });

  const message = errorText(await client.callTool("list_projects"));

  assert.match(message, /Conductor rejected the API key \(401: Invalid API key\)/);
  assert.match(message, /https:\/\/app\.conductor\.build\/users\/api-keys/);
  assert.match(message, /Pro, Teams, or Enterprise/);
  assert.ok(!message.includes(TEST_API_KEY));
});

test("a runaway userMessage is cut short, and says so", async (t) => {
  const { client } = await connect(t, {
    handle: () => ({ status: 400, body: { userMessage: `${"x".repeat(450)}TAIL` } }),
  });

  const message = errorText(await client.callTool("list_projects"));

  // Validation failures repeat one clause per accepted value; the tail of one
  // would crowd the agent's context out for nothing.
  assert.match(message, /…/);
  assert.ok(!message.includes("TAIL"), "the overflow is dropped");
  assert.ok(message.length < 500, `error stayed short (${message.length} chars)`);
});

test("a failure with no JSON body still reports its status", async (t) => {
  const { client } = await connect(t, {
    handle: () => ({ status: 502, raw: "<html>Bad Gateway</html>" }),
  });

  const message = errorText(await client.callTool("list_projects"));

  assert.match(message, /Conductor API request failed \(502\)/);
  assert.ok(!message.includes("<html>"), "no HTML page in the transcript");
});

test("an unreachable API fails as a connection problem, not a crash", async (t) => {
  // A port that was listening a moment ago and is not any more, so the address
  // is free but nothing answers.
  const closed = await startFakeApi(() => ({ body: {} }));
  await closed.close();

  const client = await startServer({ apiBase: closed.url });
  t.after(() => client.close());

  const message = errorText(await client.callTool("list_projects"));

  assert.match(message, /Could not reach the Conductor API/);
});

test("a hung request gives up instead of stalling the agent", async (t) => {
  const { client } = await connect(t, {
    handle: () => "hang",
    timeoutMs: 300,
  });

  const message = errorText(await client.callTool("list_projects"));

  assert.match(message, /Could not reach the Conductor API/);
});
