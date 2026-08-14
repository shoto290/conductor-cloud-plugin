# AGENTS.md

All AI agents working in this repo must follow these instructions.

This repo is **conductor-cloud-plugin**: one Cursor plugin that gives a coding agent (Cursor / Grok Bot) control over [Conductor Cloud](https://www.conductor.build/docs/cloud). It ships two artifacts:

- an **MCP server** that exposes the Conductor API (`https://api.conductor.build/v0`) as tools, published to npm and started by `npx`, and
- a **skill** that teaches the agent when to reach for those tools and how to supervise the sessions it starts.

The platform contract — endpoints, auth, sandbox limits, privacy — lives in the [Conductor API docs](https://www.conductor.build/docs/api) and [Cloud docs](https://www.conductor.build/docs/cloud), with `https://api.conductor.build/v0/openapi.json` as the authoritative spec. Read them before writing anything that calls Conductor.

## Layout

The repository root **is** the plugin. There is no `plugins/` directory and no marketplace manifest: Cursor reads `.cursor-plugin/plugin.json` at the root of the folder you point it at.

| Path | What lives there |
|------|------------------|
| `.cursor-plugin/plugin.json` | Plugin manifest — metadata, the `CONDUCTOR_API_KEY` variable, component paths |
| `mcp.json` | MCP server registration — `npx -y conductor-cloud-plugin`. The filename is fixed; Cursor will not find any other name |
| `src/` | MCP server source (Node + TypeScript), bundled to `dist/index.js` |
| `dist/index.js` | Build output, gitignored. `prepare` rebuilds it at publish time; nothing reads the copy in a checkout |
| `skills/<name>/SKILL.md` | Skill definition (+ supporting files) |
| `scripts/smoke.sh` | Startup check run by `npm run check`. Handshakes the working tree *and* an unpacked `npm pack` tarball |
| `scripts/bump-version.sh` | The only supported way to move the version — see [Releasing](#releasing) |
| `assets/logo.svg` | Logo referenced by the manifest |
| `package.json` | Scripts, deps, and the published entry point |
| `README.md` | User-facing install and configuration |

Keep this table in sync as you add paths.

## Scope

**The MCP server exposes seven tools, covering one loop end to end: `list_projects` → `create_workspace` → `send_prompt` → `get_session_status` → `get_transcript` → `get_workspace`, plus `cancel_session` to stop a turn.** That set is the MVP and is frozen. Renaming, archiving, sleeping, and the PR endpoints are later layers — don't add one without being asked.

## House Rules

- **Simplest thing that works** — no speculative features, no abstractions for single-use code, no options nobody asked for.
- **Surgical diffs** — every changed line traces to the request. Don't refactor or reformat what you happened to open.
- **The API is beta** — request and response shapes may change. Fetch `https://api.conductor.build/v0/openapi.json` for the current contract instead of hardcoding assumptions; that document is also the only authoritative list of accepted `agent` and `model` ids.
- **Don't wrap endpoints one-for-one** — an MCP tool exists to make a task easy for an agent, not to mirror a route table.
- **Surface `userMessage`** — Conductor errors carry a human-readable `userMessage`. Pass it through to the agent rather than swallowing it into a generic failure.
- **Keep the README honest** — when you add a setting, an env var, or an install step, update `README.md` in the same commit.
- **Bump with the change** — touching `src/`, `skills/`, `mcp.json`, or `.cursor-plugin/` means running `scripts/bump-version.sh` in the same commit. See [Releasing](#releasing).

## Checks

One command must pass before a PR, and CI runs the same one:

```bash
npm run check
```

It type-checks, bundles `src/` into `dist/index.js`, then runs `scripts/smoke.sh`, which starts the built server and asserts it answers `tools/list`. The smoke step is not redundant with the build: dropping the `ListTools` handler still type-checks cleanly but breaks every client.

`smoke.sh` runs that handshake twice — once against the working tree, once against an unpacked `npm pack` tarball with no `node_modules`, which is what `npx -y conductor-cloud-plugin` downloads and runs. The second run is what fails if `files`, `bin`, or the bundle's self-containment regresses; the first passes regardless, because `node_modules` is sitting right there.

There is no unit test suite.

## Releasing

`mcp.json` starts the server with `npx -y conductor-cloud-plugin`, so **the published npm package is what users run** — not the checkout Cursor installed. A change to `src/` reaches nobody until it ships. The package is not published yet, so no install works today.

One version number gates both consumers, and it is written down in three files: `.cursor-plugin/plugin.json` (Cursor keys its plugin cache on it), `package.json`, and `package-lock.json`. Move them together:

```bash
scripts/bump-version.sh <major|minor|patch>   # all three, in step
npm publish                                   # "prepare" builds dist/ from src/
git push
```

Unlike `npm version`, the script leaves git alone — no commit, no tag — so the bump lands in the same commit as the change it describes. It refuses to run on files that already disagree, since npm computes the next version from `package.json` alone and would leave the other behind.

Neither consumer fails loudly on a stale version: Cursor keeps serving the plugin it already cached, and npm rejects a publish that reuses a version — the change simply reaches nobody. Prose, `.claude/`, `.github/`, and `scripts/` ship to no one and need no bump.

## Safety

`CONDUCTOR_API_KEY` is a live credential for someone's repositories and compute:

- **Never log it, echo it, print it in an error, or write it to a fixture, test, or commit.** Redact it in debug output.
- Read it from the environment. Never accept it as a tool argument an agent could paste into a transcript.
- When a request fails, log the status and `userMessage` — never the `Authorization` header.
- Never read or modify `.env`, `.env.*`, `secrets/`, `*.pem`, `*.key`, `*.cert`.

Confirm before anything destructive — `git push --force`, `git reset --hard`, `git clean -fd`, `git branch -D`, `rm -rf` — and never push to `main`; work on a feature branch and open a pull request. The same applies to the Conductor API: `POST /v0/workspaces/{id}/archive` and `POST /v0/sessions/{id}/cancel` destroy someone else's in-flight work.

## Naming

| Type | Convention | Example |
|------|------------|---------|
| Files & directories | kebab-case | `session-poller.ts` |
| Skill `name:` | kebab-case, matches its directory | `name: conductor-cloud` |
| MCP tool names | snake_case, verb first | `create_workspace` |
| Headings | Title Case | `## Typical Flow` |
