// get_transcript turns a raw event stream into the two sides of a conversation.
// What it drops, what it keeps, and where it stops are the whole tool.
import assert from "node:assert/strict";
import test from "node:test";

import { connect, toolText } from "./helpers.js";

const userMessage = (id, message) => ({
  id,
  type: "userMessage",
  content: { message },
});

const assistantMessage = (id, said) => ({
  id,
  type: "assistantMessage",
  content: {
    rawPayload: {
      type: "assistant",
      message: {
        content: [
          { type: "thinking", thinking: "the user wants the login bug fixed" },
          { type: "text", text: said },
        ],
      },
    },
  },
});

const toolCall = (id) => ({
  id,
  type: "assistantMessage",
  content: {
    rawPayload: {
      type: "assistant",
      message: { content: [{ type: "tool_use", name: "Read", input: {} }] },
    },
  },
});

const lifecycleEvent = (id) => ({
  id,
  type: "workspaceStatus",
  content: { status: "ready" },
});

const page = (data, hasMore = false) => ({ body: { data, hasMore } });

test("only what the two sides said survives, oldest first", async (t) => {
  const { client, api } = await connect(t, {
    handle: () =>
      page([
        userMessage("e1", "fix the login bug"),
        toolCall("e2"),
        assistantMessage("e3", "Fixed it — the session cookie was unset."),
        lifecycleEvent("e4"),
      ]),
  });

  const transcript = toolText(await client.callTool("get_transcript", { sessionId: "s1" }));

  assert.equal(
    transcript.split("\n\n[")[0],
    "user: fix the login bug\n\nassistant: Fixed it — the session cookie was unset.",
  );
  // Reasoning, tool calls, and lifecycle events are noise in an agent's context.
  assert.ok(!transcript.includes("thinking"), "no reasoning");
  assert.ok(!transcript.includes("tool_use"), "no tool calls");

  const [request] = api.requests;
  assert.equal(request.path, "/v0/sessions/s1/messages");
  assert.equal(request.query.get("limit"), "200");
  assert.equal(request.query.get("after"), null, "the first read starts at the beginning");
});

test("the cursor is the last event id, so a poll resumes past what it skipped", async (t) => {
  const { client } = await connect(t, {
    handle: () =>
      page([userMessage("e1", "go"), assistantMessage("e2", "done"), lifecycleEvent("e3")]),
  });

  const transcript = toolText(await client.callTool("get_transcript", { sessionId: "s1" }));

  // e3 was dropped from the reading but still moves the cursor — otherwise the
  // next poll re-reads it forever.
  assert.match(transcript, /\[cursor: e3 — pass as "after" to read only what follows\]/);
});

test("`after` is forwarded, and an empty page says so rather than looking finished", async (t) => {
  const { client, api } = await connect(t, { handle: () => page([]) });

  const transcript = toolText(
    await client.callTool("get_transcript", { sessionId: "s1", after: "e3" }),
  );

  assert.equal(api.requests[0].query.get("after"), "e3");
  assert.match(transcript, /Nothing said since that cursor yet/);
  assert.match(transcript, /get_session_status/);
});

test("a session read from the start with nothing in it says that instead", async (t) => {
  const { client } = await connect(t, { handle: () => page([]) });

  const transcript = toolText(await client.callTool("get_transcript", { sessionId: "s1" }));

  assert.match(transcript, /Nothing said in this session yet/);
});

test("paging walks forward from the cursor until the API runs out", async (t) => {
  const pages = [
    page([userMessage("e1", "first"), assistantMessage("e2", "ack")], true),
    page([userMessage("e3", "second"), assistantMessage("e4", "ack again")]),
  ];
  let next = 0;

  const { client, api } = await connect(t, { handle: () => pages[next++] });

  const transcript = toolText(await client.callTool("get_transcript", { sessionId: "s1" }));

  assert.equal(api.requests.length, 2);
  assert.equal(api.requests[0].query.get("after"), null);
  assert.equal(api.requests[1].query.get("after"), "e2", "resumes after the last event seen");

  assert.deepEqual(transcript.split("\n\n[")[0].split("\n\n"), [
    "user: first",
    "assistant: ack",
    "user: second",
    "assistant: ack again",
  ]);
});

test("a long session is trimmed to the newest turns, and the trim is stated", async (t) => {
  const messages = Array.from({ length: 35 }, (_, index) =>
    userMessage(`e${index + 1}`, `turn ${index + 1}`),
  );

  const { client } = await connect(t, { handle: () => page(messages) });

  const transcript = toolText(await client.callTool("get_transcript", { sessionId: "s1" }));

  assert.match(transcript, /\[showing the last 30 of 35 turns\]/);
  assert.ok(transcript.startsWith("user: turn 6"), "keeps the newest, drops the oldest");
  assert.match(transcript, /user: turn 35/);
  assert.ok(!transcript.includes("turn 5\n"), "turn 5 was dropped");
});

test("a session that never ends stops after the page cap and says where it stopped", async (t) => {
  let served = 0;

  const { client, api } = await connect(t, {
    handle: () => {
      served++;
      return page([userMessage(`e${served}`, `turn ${served}`)], true);
    },
  });

  const transcript = toolText(await client.callTool("get_transcript", { sessionId: "s1" }));

  // Without the cap, one endless session would hold the agent in a request loop.
  assert.equal(api.requests.length, 25);
  assert.match(transcript, /stopped after 25 pages; call again with that cursor to keep reading/);
  assert.match(transcript, /\[cursor: e25/);
});
