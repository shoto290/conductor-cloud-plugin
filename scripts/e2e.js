#!/usr/bin/env node
// The one check that needs a real key. Everything in `npm run check` runs
// against a fake API on localhost; this drives the same built server over MCP
// against api.conductor.build and walks the whole delegation loop —
// initialize, list_projects, create_workspace, continue_session, poll
// get_session_status and get_transcript, then get_workspace.
//
//   CONDUCTOR_API_KEY=... npm run e2e -- --project <id> --agent <id> --model <id>
//
// It is deliberately not part of `npm run check` and must not run in CI: every
// run creates a real workspace on a real plan, which costs money and outlives
// the command. Point it at a repository you keep for testing.
import { randomBytes, randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";

// The rig the contract tests use, reused whole: `startServer` with no apiBase
// spawns dist/index.js against the real API and completes the handshake, which
// is exactly what this needs. A second stdio client here would be a second
// thing to keep correct.
import { startServer, toolText } from "../test/helpers.js";

// Bounds, so a stuck session ends the command instead of the afternoon. Ten
// minutes is generous for the one-line reply below — a run that needs longer is
// a failure worth looking at, not a run worth waiting out.
const POLL_INTERVAL_MS = 5_000;
const DEADLINE_MS = 10 * 60_000;

const API_KEYS_URL = "https://app.conductor.build/users/api-keys";
const USAGE =
  "usage: npm run e2e -- --project <id> --agent <id> --model <id>";

const apiKey = process.env.CONDUCTOR_API_KEY;

// Every line the script prints goes through here, and the key never survives
// it. Nothing printed below is expected to contain the key; this is the net
// under that expectation, because a leak into a terminal is a leak into a
// scrollback, a screenshot, and a CI log.
function say(line = "") {
  console.log(apiKey ? String(line).replaceAll(apiKey, "«redacted»") : line);
}

// One line per step of the loop, so a run reads as the loop it is walking.
function step(tool, detail) {
  say(`${tool.padEnd(17)}${detail}`);
}

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const [flag, inline] = argv[i].split(/=(.*)/s);
    const name = flag.replace(/^--/, "");
    if (!flag.startsWith("--") || !["project", "agent", "model"].includes(name)) {
      throw new Error(`unknown argument "${argv[i]}"\n${USAGE}`);
    }
    const value = inline ?? argv[++i];
    if (!value) throw new Error(`--${name} needs a value\n${USAGE}`);
    options[name] = value;
  }

  const missing = ["project", "agent", "model"].filter((name) => !options[name]);
  if (missing.length) {
    throw new Error(`missing ${missing.map((n) => `--${n}`).join(", ")}\n${USAGE}`);
  }
  return options;
}

// Calls a tool the way a client does, and treats a tool error as fatal. The
// failure text is Conductor's own `userMessage` by the time it gets here, so it
// is passed through untouched — it is the whole diagnosis.
async function call(client, name, args = {}) {
  const result = await client.callTool(name, args);
  const body = toolText(result);
  if (result.isError) throw new Error(`${name} failed — ${body}`);
  return body;
}

// get_transcript answers in text rather than JSON: turns prefixed "user: " or
// "assistant: ", a blank line between them, and any notes as [bracketed] lines
// at the end. The cursor lives in one of those notes, so this reads it back the
// same way an agent has to — if the shape is unparseable here, it is
// unparseable there too.
function readTranscript(body) {
  const lines = body.split("\n");
  const notes = [];
  while (lines.length && /^\[.+\]$/.test(lines.at(-1))) notes.unshift(lines.pop());

  // Splitting on the role markers rather than on blank lines keeps a multi-line
  // reply whole, which matters because the token can land on any line of it.
  const parts = lines.join("\n").split(/^(user|assistant): /m);
  const said = [];
  for (let i = 1; i < parts.length; i += 2) {
    if (parts[i] === "assistant") said.push(parts[i + 1].trim());
  }

  const cursor = notes
    .map((note) => note.match(/^\[cursor: (\S+)/))
    .find(Boolean)?.[1];

  return { said, cursor };
}

// A name nobody mistakes for real work, and that no two runs share — it becomes
// a git branch on the project, and those pile up.
function workspaceName() {
  const stamp = new Date()
    .toISOString()
    .replace(/[:-]/g, "")
    .replace(/\..+/, "")
    .replace("T", "-");
  return `plugin-e2e-${stamp}-${randomBytes(2).toString("hex")}`;
}

// Where the run got to, so a failure after the workspace exists can still say
// which one to go look at.
let created = null;

async function run() {
  const options = parseArgs(process.argv.slice(2));

  if (!apiKey) {
    throw new Error(
      `CONDUCTOR_API_KEY is not set. Create a key at ${API_KEYS_URL} and export it, then run this again.`,
    );
  }

  say("This creates a REAL Conductor Cloud workspace.");
  say("It bills against the key's plan, and it persists until you delete it.");
  say("Run it against a repository you keep for testing, never a live one.");
  say();
  say(`project ${options.project} · agent ${options.agent} · model ${options.model}`);
  say();

  // No apiBase means the real API. Passing the contract tests' localhost seam
  // through — and nothing else — is what lets this script be rehearsed against
  // the fake API before it is trusted with a key and a bill. It stays what it
  // is there: a test variable, undocumented for users.
  const client = await startServer({
    apiKey,
    apiBase: process.env.CONDUCTOR_TEST_API_BASE,
  });
  try {
    const server = client.initializeResult.serverInfo;
    step("initialize", `${server.name} ${server.version}`);

    // Fail on a project id the key cannot see before creating anything, rather
    // than reading it back out of a 400.
    const listed = await call(client, "list_projects");
    const [head] = listed.split("\n\n");
    let projects;
    try {
      projects = JSON.parse(head);
    } catch {
      throw new Error(`list_projects did not return projects — ${listed}`);
    }
    if (!projects.some((project) => project.id === options.project)) {
      const known = projects.map((p) => `  ${p.id}  ${p.name}`).join("\n");
      throw new Error(
        `--project ${options.project} is not in this key's projects:\n${known}${
          listed.includes("first page") ? "\n(this is only the first page)" : ""
        }`,
      );
    }
    step("list_projects", `${projects.length} project(s), including the one asked for`);

    const name = workspaceName();
    created = JSON.parse(
      await call(client, "create_workspace", {
        projectId: options.project,
        name,
        agent: options.agent,
        model: options.model,
      }),
    );
    step("create_workspace", name);
    say(`  workspaceId ${created.workspaceId}`);
    say(`  sessionId   ${created.sessionId}`);

    // The whole job: say one line back. It touches no file, runs no command,
    // and opens no pull request, so the only trace it leaves is the branch the
    // workspace was created on. The token makes the reply unmistakably this
    // run's, and not a stray line from the agent's own preamble.
    const token = randomUUID().slice(0, 8);
    const message = [
      "This is an automated end-to-end check of the conductor-cloud-plugin MCP server.",
      "",
      `Reply with exactly this line and nothing else: E2E-OK ${token}`,
      "",
      "Change nothing: create no files, edit no files, run no commands, open no pull request.",
    ].join("\n");

    const sent = JSON.parse(
      await call(client, "continue_session", { sessionId: created.sessionId, message }),
    );
    step("continue_session", `state ${sent.state ?? "sent"}, expecting "E2E-OK ${token}"`);

    // Poll the way the skill tells an agent to: status for the sandbox's
    // progress, transcript from the cursor for what has actually been said.
    // The reply is what ends the loop — 'idle' alone is ambiguous, since a
    // session reads idle before its first turn starts.
    const started = Date.now();
    let cursor;
    let reply;

    while (!reply) {
      await sleep(POLL_INTERVAL_MS);
      const elapsed = Math.round((Date.now() - started) / 1000);

      const status = JSON.parse(
        await call(client, "get_session_status", { sessionId: created.sessionId }),
      );
      const transcript = readTranscript(
        await call(client, "get_transcript", {
          sessionId: created.sessionId,
          ...(cursor ? { after: cursor } : {}),
        }),
      );
      cursor = transcript.cursor ?? cursor;

      const step = status.lifecycleStep ? ` (${status.lifecycleStep})` : "";
      say(
        `  ${String(elapsed).padStart(4)}s  session ${status.session} · workspace ${status.workspace}${step}`,
      );

      if (status.errorMessage) throw new Error(`session reported: ${status.errorMessage}`);

      reply = transcript.said.find((said) => said.includes(token));

      if (!reply && Date.now() - started > DEADLINE_MS) {
        throw new Error(
          `no reply carrying the token after ${Math.round(DEADLINE_MS / 60_000)} minutes (session ${status.session}, workspace ${status.workspace})`,
        );
      }
    }

    step("get_transcript", `the session replied: ${reply.split("\n")[0]}`);

    const workspace = JSON.parse(
      await call(client, "get_workspace", { workspaceId: created.workspaceId }),
    );

    say();
    say("E2E passed — the loop works end to end through MCP.");
    say(`  workspaceId  ${created.workspaceId}`);
    say(`  sessionId    ${created.sessionId}`);
    say(`  cursor       ${cursor ?? "(none)"}`);
    // deepLink, not url: both create_workspace and get_workspace name it that.
    say(`  deep link    ${workspace.deepLink ?? created.deepLink}`);
    say();
    say("That workspace is real and still there. Open the link to check it, then delete it.");
  } finally {
    await client.close();
  }
}

try {
  await run();
} catch (error) {
  say();
  say(`E2E failed — ${error.message}`);
  if (created) {
    say(`  workspaceId  ${created.workspaceId}`);
    if (created.deepLink) say(`  deep link    ${created.deepLink}`);
    say("  it was created before the failure — open it, then delete it.");
  }
  process.exit(1);
}
