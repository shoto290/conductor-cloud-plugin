# conductor-cloud-plugin

A Cursor plugin that hands a job to a [Conductor Cloud](https://www.conductor.build/docs/cloud) agent — create a cloud workspace, brief it, and supervise it without leaving your editor.

**This is a scaffold.** The plugin installs, and its MCP server starts and advertises an **empty tool list**. Nothing calls the Conductor API yet.

## Install Locally

```bash
git clone https://github.com/shoto290/conductor-cloud-plugin.git
cd conductor-cloud-plugin
npm install   # also builds dist/ via the prepare script

mkdir -p ~/.cursor/plugins/local
ln -s "$PWD" ~/.cursor/plugins/local/conductor-cloud
```

Then run **Developer: Reload Window** in Cursor. `npm install` is required — the MCP server runs from `dist/`, which is not committed.

## Setting

| Name | Description |
| --- | --- |
| `CONDUCTOR_API_KEY` | API key used to authenticate with Conductor. Required. |

Declared as a plugin variable in `.cursor-plugin/plugin.json` and passed to the MCP server as an environment variable by `mcp.json`. Create a key at https://app.conductor.build/users/api-keys (requires a Conductor Pro, Teams, or Enterprise plan), then set it in Cursor's plugin settings — or export it in your shell to run the server by hand:

```bash
export CONDUCTOR_API_KEY=...
```

**Never commit the key.** Keep it in your shell profile or a local `.env` file — both are ignored by `.gitignore`.

## What Ships

| Path | Component |
| --- | --- |
| `.cursor-plugin/plugin.json` | Plugin manifest — metadata, the `CONDUCTOR_API_KEY` variable, component paths |
| `skills/conductor-cloud/SKILL.md` | Skill: when to hand a job to a cloud agent, and how to brief and supervise it |
| `mcp.json` | Registers the `conductor-cloud` stdio MCP server |
| `src/` | MCP server source (TypeScript) — no tools yet |

## Verify

```bash
npm run build

printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"probe","version":"0.0.0"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
  | node dist/index.js
```

Expect `{"result":{"tools":[]},...}`.

MIT licensed — see [LICENSE](LICENSE).
