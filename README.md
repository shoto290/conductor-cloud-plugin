# Conductor Cloud for Cursor & Grok Bot

Give your coding agent control of [Conductor Cloud](https://www.conductor.build/docs/cloud). The plugin connects Cursor and Grok Bot to the Conductor API, then adds a skill so the agent knows when to spin up a cloud workspace, how to brief it, and how to supervise it until it's done.

> **Status: early, and not installable yet.** The delegation loop is built — list your projects, create a workspace, prompt it, watch it, read the reply — but the [npm package](https://www.npmjs.com/package/conductor-cloud-plugin) it runs from is unpublished, so **no install works today**. See [Install](#install). Renaming, archiving, and the PR endpoints are not built.

Conductor runs each agent in its own Linux sandbox with your repositories pre-installed. Work keeps going after you disconnect, and your team can open the same workspace and pick up the same chat.

## What you get

- **MCP tools** over `https://api.conductor.build/v0` — `list_projects`, `create_workspace` on a named branch, `send_prompt`, `get_session_status`, `get_transcript`, `get_workspace` for the deep link, and `cancel_session` to stop a turn.
- **A skill** that teaches the agent the parts that are easy to get wrong: a cloud session shares no context with your chat, so it needs a self-contained brief, and it reports `idle` until a queued turn actually starts.
- **One setting to fill in.** No OAuth dance, no per-repo config.

## How it fits together

One architecture, one way to run the server:

- **The clone is the plugin.** The repository root carries `.cursor-plugin/plugin.json` (the manifest), `skills/` (the skill), and `mcp.json` (the server registration). That is everything Cursor reads.
- **The server comes from npm.** `mcp.json` runs `npx -y conductor-cloud-plugin`, so npm fetches and starts the server. Nothing is built or vendored in the clone, and editing `src/` there changes nothing you can see in Cursor.

That second point is also why nothing installs yet: until the package is published, `npx` has nothing to resolve. To try a local build in the meantime, point a project-level `.cursor/mcp.json` at `node /absolute/path/to/dist/index.js` and run `npm run build` first.

## Requirements

- A Conductor account on **Pro, Teams, or Enterprise** — cloud workspaces are not on the free plan.
- Your repository connected to Conductor Cloud. **GitHub only**; GitLab and Bitbucket repos need local workspaces.
- **Node.js 18 or newer**, with `npx` available.

## Settings

| Name | Description |
| --- | --- |
| `CONDUCTOR_API_KEY` | Bearer token for the Conductor API. Required. |

Create a key at **[app.conductor.build/users/api-keys](https://app.conductor.build/users/api-keys)**.

It is declared as a plugin variable in `.cursor-plugin/plugin.json` and handed to the MCP server as an environment variable by `mcp.json`, so it is never a tool argument and never lands in your repo.

The key is a live credential for your repositories and compute. Never commit it, never paste it into an agent chat, and give unattended bots their own key — commits are attributed to whoever the key belongs to.

## Install

> **Blocked until the npm package ships.** Every path below starts the server with `npx -y conductor-cloud-plugin`. That package is not published, so the server fails to start no matter how you install the plugin. The steps are what you will do once it is.

### Cursor

Clone the repo:

```bash
git clone https://github.com/shoto290/conductor-cloud-plugin.git
```

Then in Cursor go to **Customize → Plugins → + Add** and select the cloned folder. **Conductor Cloud** appears under **Installed**; set `CONDUCTOR_API_KEY` there and the server starts. No install or build step in the clone — it only supplies the manifest and the skill.

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

`${env:CONDUCTOR_API_KEY}` reads the key from your shell, so it stays out of the file. Export it in your shell profile first:

```bash
export CONDUCTOR_API_KEY=...
```

The server command is identical to the one the plugin uses; only the key differs. `${env:CONDUCTOR_API_KEY}` reads it from the environment your editor was launched with, which for an editor started from the Dock is a minimal one — so this can come back empty where the plugin install, which passes the key as a plugin variable, would not.

### Grok Bot

[Grok Bot](https://docs.x.ai/grok-bot/teams-and-enterprises) has no plugin controls of its own — it follows your team's Cursor plugin and MCP policy, and MCP authentication is shared between the two. So a Cursor admin does the work once: enable **conductor-cloud** on the team plugins page, enter `CONDUCTOR_API_KEY` as a plugin variable, and add the server to your MCP allowlist if you run one.

Both Cursor and Grok Bot pick it up. Individual members can't enable it for Grok Bot themselves; if the tools don't appear, ask an admin. Give bots a dedicated key — they work unattended, and every workspace and commit they create is attributed to that key's Conductor account.

## Verify it works

Ask the agent: *"List my Conductor projects."* It should come back with the repositories you can create workspaces in. If the key is missing or rejected, the tool says so and tells you what to fix.

Then try the whole loop: *"Run this in the cloud on <repo>."* The agent should create a named workspace, send it a brief, poll until the session replies, and hand you back a `conductor://` link that opens the workspace on your Mac.

To check that the server builds, speaks MCP, and calls the API correctly — no key, no network:

```bash
npm run check
```

To check the key on its own, without the agent:

```bash
curl https://api.conductor.build/me \
  -H "Authorization: Bearer $CONDUCTOR_API_KEY" \
  -H "User-Agent: conductor-cloud-plugin"
```

`401` means the key is wrong or expired. `403` usually means a rejected client signature — send a `User-Agent`. Errors carry a human-readable `userMessage`; read it.

If the server fails to start, Cursor's MCP log carries the reason. To reproduce whatever it shows, outside Cursor:

```bash
CONDUCTOR_API_KEY=... npx -y conductor-cloud-plugin
```

It should sit and wait on stdin. Anything else — a resolution failure, an npm error, a stack trace — is the same thing Cursor hit. Today it is a resolution failure: the package is not published.

## Good to know

- **Chat from cloud workspaces is stored on Conductor's servers** and visible to your organization. This is the one place Cloud differs from local Conductor on privacy. Never put a secret in a prompt.
- **Sandboxes stop.** After 4 hours idle, and at 23h50m no matter what. Files and chat survive; running processes and in-flight turns don't.
- **The API is v0 and in beta.** Shapes may change; `https://api.conductor.build/v0/openapi.json` is the current contract.

## Prior art

Three repos this one is modeled on, all worth reading if you're packaging something similar:

- [lovablelabs/lovable-cursor-plugin](https://github.com/lovablelabs/lovable-cursor-plugin) — the Cursor plugin layout: MCP server, skills, commands, and rules shipped as one repo.
- [firecrawl/firecrawl-mcp-server](https://github.com/firecrawl/firecrawl-mcp-server) — how to document an API-key MCP server across a lot of different clients.
- [upstash/context7](https://github.com/upstash/context7) — install collapsed to a single command, with a manual path for everyone else.

MIT licensed — see [LICENSE](LICENSE).
