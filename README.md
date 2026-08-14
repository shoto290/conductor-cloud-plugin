# Conductor Cloud for Cursor & Grok Bot

Give your coding agent control of [Conductor Cloud](https://www.conductor.build/docs/cloud). The plugin connects Cursor and Grok Bot to the Conductor API, then adds a skill so the agent knows when to spin up a cloud workspace, how to brief it, and how to supervise it until it's done.

Conductor runs each agent in its own Linux sandbox with your repositories pre-installed. Work keeps going after you disconnect, and your team can open the same workspace and pick up the same chat.

## What you get

- **MCP tools** over `https://api.conductor.build/v0` — `list_projects`, `create_workspace` on a named branch, `continue_session`, `get_session_status`, `get_transcript`, `get_workspace` for the deep link, and `cancel_session` to stop a turn.
- **A skill** that teaches the agent the parts that are easy to get wrong: a cloud session shares no context with your chat, so it needs a self-contained brief, and it reports `idle` until a queued turn actually starts.
- **One setting to fill in.** No OAuth dance, no per-repo config.

## Requirements

- A Conductor account on **Pro, Teams, or Enterprise** — cloud workspaces are not on the free plan.
- Your repository connected to Conductor Cloud. **GitHub only**; GitLab and Bitbucket repos need local workspaces.

## Settings

| Name | Description |
| --- | --- |
| `CONDUCTOR_API_KEY` | Bearer token for the Conductor API. Required. |

Create a key at **[app.conductor.build/users/api-keys](https://app.conductor.build/users/api-keys)**.

The key is declared as a plugin variable in `plugin.json` and passed to the MCP server by `mcp.json`, so it is never a tool argument and never lands in your repo.

The key is a live credential for your repositories and compute. Never commit it, never paste it into an agent chat, and give unattended bots their own key — commits are attributed to whoever the key belongs to.

## Install

### Cursor

In Cursor go to **Customize → Plugins → Add Marketplace / Import from Repo** and enter:

```
https://github.com/shoto290/conductor-cloud-plugin
```

Cursor reads `.cursor-plugin/marketplace.json` and imports the plugin. **Conductor Cloud** appears under **Installed** — set `CONDUCTOR_API_KEY` there and the server starts automatically via `npx`.

No clone, no build step, no Node.js version to manage yourself.

### Any MCP client — manual config

Gets you the tools without the skill. Add to `~/.cursor/mcp.json` (global) or `.cursor/mcp.json` (one project):

```json
{
  "mcpServers": {
    "conductor-cloud": {
      "command": "npx",
      "args": ["-y", "conductor-cloud-plugin"],
      "env": {
        "CONDUCTOR_API_KEY": "${env:CONDUCTOR_API_KEY}"
      }
    }
  }
}
```

`${env:CONDUCTOR_API_KEY}` reads the key from your shell environment — export it in your shell profile first:

```bash
export CONDUCTOR_API_KEY=...
```

### Grok Bot

[Grok Bot](https://docs.x.ai/grok-bot/teams-and-enterprises) follows your team's Cursor plugin and MCP policy. A Cursor admin does the work once: enable **conductor-cloud** on the team plugins page, enter `CONDUCTOR_API_KEY` as a plugin variable, and add the server to your MCP allowlist if you run one. Both Cursor and Grok Bot pick it up from there. Give bots a dedicated key — every workspace and commit they create is attributed to that key's Conductor account.

## Verify it works

Ask the agent: *"List my Conductor projects."* It should come back with the repositories you can create workspaces in. If the key is missing or rejected, the tool says so and tells you what to fix.

Then try the whole loop: *"Run this in the cloud on \<repo\>."* The agent should create a named workspace, send it a brief, poll until the session replies, and hand you back a `conductor://` link that opens the workspace in the app.

To check that the server builds, speaks MCP, and calls the API correctly — no key, no network:

```bash
npm run check
```

### End-to-end check against the real API

`npm run check` never leaves localhost. To prove the whole loop against the real API — the MCP handshake, `list_projects`, a workspace, a prompt, the polling, and the deep link — run it once by hand:

```bash
export CONDUCTOR_API_KEY=...
npm run e2e -- --project <projectId> --agent claude --model opus-5-1m
```

> **This creates a real cloud workspace.** It bills against that key's plan and stays there until you delete it, along with the branch it opens. Point it at a repository you keep for testing, never a live one.

Take the project id from `list_projects` — or run the command with a wrong one, which fails before creating anything and prints the ids the key can see.

To check the key on its own:

```bash
curl https://api.conductor.build/me \
  -H "Authorization: Bearer $CONDUCTOR_API_KEY" \
  -H "User-Agent: conductor-cloud-plugin"
```

`401` means the key is wrong or expired. `403` usually means a rejected client signature — the `User-Agent` header is required.

## Good to know

- **Chat from cloud workspaces is stored on Conductor's servers** and visible to your organization. Never put a secret in a prompt.
- **Sandboxes stop.** After 4 hours idle, and at 23h50m no matter what. Files and chat survive; running processes and in-flight turns don't.
- **The API is v0 and in beta.** Shapes may change; `https://api.conductor.build/v0/openapi.json` is the current contract.

## Prior art

Three repos this one is modeled on:

- [lovablelabs/lovable-cursor-plugin](https://github.com/lovablelabs/lovable-cursor-plugin) — the Cursor plugin layout: MCP server, skills, commands, and rules shipped as one repo.
- [firecrawl/firecrawl-mcp-server](https://github.com/firecrawl/firecrawl-mcp-server) — how to document an API-key MCP server across a lot of different clients.
- [upstash/context7](https://github.com/upstash/context7) — install collapsed to a single command, with a manual path for everyone else.

MIT licensed — see [LICENSE](LICENSE).
