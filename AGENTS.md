# AGENTS.md

All AI agents working in this repo must follow these instructions.

This repo is **conductor-cloud-plugin**: one Cursor plugin that gives a coding agent (Cursor / Grok Bot) control over [Conductor Cloud](https://www.conductor.build/docs/cloud). It ships two artifacts:

- an **MCP server** that exposes the Conductor API (`https://api.conductor.build/v0`) as tools, published to npm and started by `npx`, and
- a **skill** that teaches the agent when to reach for those tools and how to supervise the sessions it starts.

The platform contract — endpoints, auth, sandbox limits, privacy — lives in the [Conductor API docs](https://www.conductor.build/docs/api) and [Cloud docs](https://www.conductor.build/docs/cloud), with `https://api.conductor.build/v0/openapi.json` as the authoritative spec. Read them before writing anything that calls Conductor.

## Layout

The repository root **is** the plugin. There is no `plugins/` directory: `.cursor-plugin/marketplace.json` lists one entry whose `source` is `.`, pointing back at the root, where Cursor finds `.cursor-plugin/plugin.json`.

| Path | What lives there |
|------|------------------|
| `.cursor-plugin/plugin.json` | Plugin manifest — metadata, the `CONDUCTOR_API_KEY` variable, component paths |
| `.cursor-plugin/marketplace.json` | One-entry marketplace so **Add Marketplace / Import from Repo** installs this folder. Its `source` is `.`, and it carries a fourth copy of the version |
| `mcp.json` | MCP server registration — `npx -y conductor-cloud-plugin`. The filename is fixed; Cursor will not find any other name |
| `src/` | MCP server source (Node + TypeScript), bundled to `dist/index.js` |
| `dist/index.js` | Build output, gitignored. `prepare` rebuilds it at publish time; nothing reads the copy in a checkout |
| `skills/<name>/SKILL.md` | Skill definition (+ supporting files) |
| `test/*.test.js` | Contract tests (`node:test`) — drive `dist/index.js` over stdio against a fake API on localhost |
| `test/helpers.js` | The rig those tests share: the fake API, and a client that speaks MCP to the built server. `scripts/e2e.js` reuses it |
| `scripts/smoke.sh` | Startup check run by `npm run check`. Handshakes the working tree *and* an unpacked `npm pack` tarball |
| `scripts/e2e.js` | The opt-in `npm run e2e` — the whole loop against the real API. Needs a key, creates a real workspace, never runs in CI |
| `scripts/bump-version.sh` | The only supported way to move the version — see [Releasing](#releasing) |
| `.github/workflows/ci.yml` | The whole CI: `npm ci` then `npm run check`, on every pull request and on `main` |
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

It type-checks, bundles `src/` into `dist/index.js`, runs the contract tests, then runs `scripts/smoke.sh`. The steps after the build are not redundant with it: dropping the `ListTools` handler, or the `Authorization` header, still type-checks cleanly but breaks every client.

`.github/workflows/ci.yml` runs `npm ci` and that same command on every pull request and on `main`, on Node 24 — one supported version, not the `>=18` floor. It is the entire CI on purpose: a check worth running in CI belongs inside `npm run check`, where it also runs locally, rather than beside it in the workflow.

The contract tests (`npm test`) spawn the built server as a child process and speak real `initialize` / `tools/list` / `tools/call` to it, with `CONDUCTOR_TEST_API_BASE` pointing at a fake Conductor API on localhost. They cover the seven tool names and their required arguments, the headers each request carries, the missing-key and rejected-key failures, `userMessage` passthrough, connection failures and the timeout, the status merge, and the transcript's filtering, paging, and cursor. **No test needs a key or the network**, and one of them asserts the key never reaches stdout, stderr, or an error message — keep it that way.

One check is deliberately outside that command, because it cannot be free:

```bash
npm run e2e -- --project <id> --agent <id> --model <id>   # needs CONDUCTOR_API_KEY
```

`scripts/e2e.js` drives the built server over MCP against `api.conductor.build` and walks the loop for real — `list_projects`, `create_workspace`, `send_prompt`, polling `get_session_status` and `get_transcript` until the reply carries a token it generated, then `get_workspace` for the deep link. It bounds itself (5-second polls, 10 minutes total), names the workspace `plugin-e2e-<timestamp>-<random>`, sends a job that changes nothing, and scrubs the key from every line it prints. **Never wire it into `npm run check` or CI**: each run bills a real plan and leaves a real workspace behind. Run it by hand against a test repository when the loop changes, and say in the PR that you did.

`CONDUCTOR_TEST_API_BASE` and `CONDUCTOR_TEST_TIMEOUT_MS` exist for the checks alone — `scripts/e2e.js` passes the first one through so the E2E can be rehearsed against that same fake before it is trusted with a key and a bill. They are not user settings: don't document them, don't add them to `mcp.json` or the manifest, and don't grow the list — a real option belongs in the manifest's `variables`.

`smoke.sh` runs a handshake twice — once against the working tree, once against an unpacked `npm pack` tarball with no `node_modules`, which is what `npx -y conductor-cloud-plugin` downloads and runs. The second run is what fails if `files`, `bin`, or the bundle's self-containment regresses; the first passes regardless, because `node_modules` is sitting right there.

## Releasing

`mcp.json` starts the server with `npx -y conductor-cloud-plugin`, so **the published npm package is what users run** — not the checkout Cursor installed. A change to `src/` reaches nobody until it ships. The package is not published yet, so no install works today.

One version number gates both consumers, and it is written down in four files: `.cursor-plugin/plugin.json` (Cursor keys its plugin cache on it), `.cursor-plugin/marketplace.json` (what an import reads), `package.json`, and `package-lock.json`. `scripts/bump-version.sh` moves those four and nothing else — unlike `npm version` it leaves git alone (no commit, no tag), so the bump lands in the same commit as the change it describes, and it refuses to run on files that already disagree, since npm computes the next version from `package.json` alone and would leave the others behind.

**A change to `src/`, `skills/`, `mcp.json`, or `.cursor-plugin/` needs a bump before it can be published.** Neither consumer fails loudly on a stale version: Cursor keeps serving the plugin it already cached, and npm rejects a publish that reuses a version — the change simply reaches nobody. Prose, `.claude/`, `.github/`, and `scripts/` ship to no one and need no bump.

Publishing is by hand, and it is this checklist. There is no release bot, no Changesets, no semantic-release — don't add one.

1. **CI is green on the commit you are shipping.** Not on the branch, on the commit.
2. **Bump**, unless the release is only prose: `scripts/bump-version.sh <major|minor|patch>`, committed with the change it describes.
3. **See what would ship**: `npm pack --dry-run`. `dist/index.js` must be in the list — it is gitignored, so it exists only because `prepare` rebuilt it here.
4. **Open the tarball**, since the list alone won't show you a stale bundle: `npm pack && tar -tzf conductor-cloud-plugin-<version>.tgz`, and check `package/package.json` carries the version you just bumped to. Delete the tarball afterwards.
5. **Publish**: `npm publish`. `prepare` builds `dist/` from `src/` again, so what goes out is built from this checkout.
6. **Read it back from the registry**: `npm view conductor-cloud-plugin version` returns the new number, and `npx -y conductor-cloud-plugin@<version>` starts — that last one is the path `mcp.json` actually takes.
7. `git push`.

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
