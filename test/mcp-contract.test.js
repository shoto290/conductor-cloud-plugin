// What a client sees before it ever reaches Conductor: the handshake, the seven
// tools, their schemas, and the failure a missing key produces.
import assert from "node:assert/strict";
import test from "node:test";

import { TEST_API_KEY, connect, errorText, version } from "./helpers.js";

// The frozen MVP: seven tools, and the arguments each one cannot work without.
// Adding a tool here without being asked is out of scope; dropping a required
// field is a breaking change for every agent already calling it.
const TOOLS = {
  list_projects: { required: [], optional: [] },
  create_workspace: {
    required: ["projectId", "name", "agent", "model"],
    optional: ["effort", "branch"],
  },
  continue_session: { required: ["sessionId", "message"], optional: [] },
  get_session_status: { required: ["sessionId"], optional: [] },
  get_transcript: { required: ["sessionId"], optional: ["after"] },
  get_workspace: { required: ["workspaceId"], optional: [] },
  cancel_session: { required: ["sessionId"], optional: [] },
};

test("initialize identifies the server and its version", async (t) => {
  const { client } = await connect(t);

  assert.deepEqual(client.initializeResult.serverInfo, {
    name: "conductor-cloud",
    version,
  });
  assert.ok(client.initializeResult.capabilities.tools, "advertises tools");
});

test("tools/list advertises exactly the seven MVP tools", async (t) => {
  const { client } = await connect(t);
  const { tools } = await client.listTools();

  assert.deepEqual(
    tools.map((tool) => tool.name).sort(),
    Object.keys(TOOLS).sort(),
  );
});

test("every tool carries the fields a client renders and validates against", async (t) => {
  const { client } = await connect(t);
  const { tools } = await client.listTools();

  for (const tool of tools) {
    const expected = TOOLS[tool.name];

    assert.ok(tool.title, `${tool.name} has a title`);
    assert.ok(
      tool.description && tool.description.length > 40,
      `${tool.name} tells the agent when to reach for it`,
    );
    assert.equal(tool.inputSchema.type, "object", `${tool.name} takes an object`);

    assert.deepEqual(
      (tool.inputSchema.required ?? []).sort(),
      [...expected.required].sort(),
      `${tool.name} required arguments`,
    );
    assert.deepEqual(
      Object.keys(tool.inputSchema.properties ?? {}).sort(),
      [...expected.required, ...expected.optional].sort(),
      `${tool.name} accepted arguments`,
    );

    for (const [name, schema] of Object.entries(
      tool.inputSchema.properties ?? {},
    )) {
      assert.ok(schema.description, `${tool.name}.${name} is described`);
    }
  }
});

test("cancel_session is annotated destructive, and the read-only tools are not", async (t) => {
  const { client } = await connect(t);
  const { tools } = await client.listTools();
  const byName = Object.fromEntries(tools.map((tool) => [tool.name, tool]));

  // The one tool that throws away someone's in-flight work. A client that hides
  // confirmation prompts reads this flag and nothing else.
  assert.equal(byName.cancel_session.annotations.destructiveHint, true);

  for (const name of ["list_projects", "get_session_status", "get_transcript", "get_workspace"]) {
    assert.equal(byName[name].annotations.readOnlyHint, true, `${name} is read-only`);
    assert.notEqual(byName[name].annotations.destructiveHint, true);
  }

  for (const name of ["create_workspace", "continue_session"]) {
    assert.notEqual(byName[name].annotations?.readOnlyHint, true, `${name} writes`);
  }
});

test("no tool accepts a credential as an argument", async (t) => {
  const { client } = await connect(t);
  const { tools } = await client.listTools();

  // The key is read from the environment. A tool argument would put it in the
  // transcript, where the agent — and anyone reading the chat — can see it.
  for (const tool of tools) {
    for (const name of Object.keys(tool.inputSchema.properties ?? {})) {
      assert.doesNotMatch(
        name,
        /key|token|secret|auth|credential/i,
        `${tool.name}.${name} looks like a credential argument`,
      );
    }
  }

  assert.ok(!JSON.stringify(tools).includes(TEST_API_KEY), "no key in schemas");
});

test("a missing key fails with instructions, before any request goes out", async (t) => {
  const { client, api } = await connect(t, { apiKey: null });

  const message = errorText(await client.callTool("list_projects"));

  assert.match(message, /CONDUCTOR_API_KEY is not set/);
  assert.match(message, /https:\/\/app\.conductor\.build\/users\/api-keys/);
  assert.equal(api.requests.length, 0, "no unauthenticated request was sent");
});

test("every tool refuses to run without a key, rather than half of them", async (t) => {
  const { client, api } = await connect(t, { apiKey: null });

  const calls = {
    list_projects: {},
    create_workspace: {
      projectId: "p1",
      name: "job",
      agent: "claude",
      model: "opus",
    },
    continue_session: { sessionId: "s1", message: "go" },
    get_session_status: { sessionId: "s1" },
    get_transcript: { sessionId: "s1" },
    get_workspace: { workspaceId: "w1" },
    cancel_session: { sessionId: "s1" },
  };

  for (const [name, args] of Object.entries(calls)) {
    const message = errorText(await client.callTool(name, args));
    assert.match(message, /CONDUCTOR_API_KEY is not set/, `${name} says why`);
  }

  assert.equal(api.requests.length, 0);
});

test("the key never reaches stdout, stderr, or an error message", async (t) => {
  const { client } = await connect(t, {
    handle: (request) =>
      request.path === "/projects"
        ? { body: { data: [{ id: "p1", name: "app", gitRemote: "git@x:app.git" }], hasMore: false } }
        : { status: 401, body: { userMessage: "Invalid API key" } },
  });

  await client.listTools();
  await client.callTool("list_projects");
  const failure = errorText(await client.callTool("get_workspace", { workspaceId: "w1" }));

  assert.match(failure, /Conductor rejected the API key/);
  assert.ok(!failure.includes(TEST_API_KEY), "the key is not echoed back on failure");

  // stdout is the protocol stream, so this covers every reply the server sent.
  assert.ok(!client.stdout.includes(TEST_API_KEY), "the key is not on stdout");
  assert.ok(!client.stderr.includes(TEST_API_KEY), "the key is not on stderr");
});
