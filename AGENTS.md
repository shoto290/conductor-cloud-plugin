# AGENTS.md — Single Source of Truth

All AI agents working in this repo must follow these instructions.

This repo is **conductor-cloud-plugin**: a plugin that gives a coding agent (Cursor / Grok Bot) first-class control over [Conductor Cloud](https://www.conductor.build/docs/cloud). It ships two artifacts:

- an **MCP server** that exposes the Conductor API (`https://api.conductor.build/v0`) as tools, and
- a **skill** that teaches the agent when to reach for those tools and how to supervise the sessions it starts.

The platform contract — endpoints, auth, sandbox limits, privacy — lives in the [Conductor API docs](https://www.conductor.build/docs/api) and [Cloud docs](https://www.conductor.build/docs/cloud), with `https://api.conductor.build/v0/openapi.json` as the authoritative spec. Read them before writing anything that calls Conductor. This file governs how you work; those govern what you're working against.

## Layout

The repository root **is** the plugin — a single Cursor plugin. It also carries a one-entry `marketplace.json` so **+ Add** can install a clone of this folder; that entry points back at the root, so nothing lives under `plugins/`.

| Path | What lives there |
|------|------------------|
| `.cursor-plugin/plugin.json` | Plugin manifest — metadata, the `CONDUCTOR_API_KEY` variable, component paths |
| `.cursor-plugin/marketplace.json` | One-entry marketplace so **+ Add** installs this folder. Its `source` is `.` |
| `mcp.json` | MCP server registration. The filename is fixed; Cursor will not find any other name |
| `src/` | MCP server source (Node + TypeScript), bundled to `dist/index.js` |
| `dist/index.js` | Committed build output. Cursor installs by cloning and never builds, so this is tracked — rebuild and commit it whenever `src/` changes |
| `skills/<name>/SKILL.md` | Skill definition (+ supporting files) |
| `scripts/start.sh` | Launcher `mcp.json` invokes. Finds a Node the GUI's PATH doesn't expose |
| `scripts/smoke.sh` | Startup check run by `npm run check` |
| `assets/logo.svg` | Marketplace logo referenced by the manifest |
| `package.json` | Scripts, deps, and the published entry point |
| `README.md` | User-facing install and configuration |

Keep this table in sync as you add paths.

**The MCP server exposes seven tools, covering one loop end to end: `list_projects` → `create_workspace` → `send_prompt` → `get_session_status` → `get_transcript` → `get_workspace`, plus `cancel_session` to stop a turn.** Renaming, archiving, sleeping, and the PR endpoints are the next layers.

## Core Principles

Every decision passes through these:

- **Simple** — favor the simplest solution that solves the problem. Less code, fewer abstractions, no over-engineering.
- **Intentional** — every line exists for a reason. No speculative features, no "just in case" logic.
- **Measurable** — changes must have observable impact. If you can't verify it works, rethink the approach.
- **Pragmatic** — ship what works today. Choose proven patterns over clever ones.
- **Layered** — build incrementally. Each change is a stable, shippable layer on what exists.
- **Envisioned** — keep the end goal in sight. Short-term decisions should align with the long-term product.

## Behavioral Guidelines

Four rules that govern HOW you work. The principles above define what to build; these define how to approach the task. Adapted from [Karpathy's observations on LLM coding pitfalls](https://github.com/forrestchang/andrej-karpathy-skills).

**Tradeoff:** these bias toward caution over speed. For trivial tasks (typo, one-liner, obvious rename), use judgment — not every change needs the full rigor.

### 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

- State assumptions explicitly. If uncertain, ask rather than guess.
- If multiple interpretations exist, present them — never pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask 1-2 clarifying questions before writing.

### 2. Simplicity First

**Minimum content that solves the problem. Nothing speculative.**

- No tools, options, or sections beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- If 200 lines could be 50, rewrite it.
- Self-check: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

### 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing files:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor sections that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it — don't delete it.

When your changes create orphans:
- Remove references/imports that YOUR changes made unused.
- Don't remove pre-existing unused code unless asked.

Self-check: every changed line should trace directly to the user's request.

### 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

For multi-step tasks, state a brief plan with verification:

```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") force constant clarification.

**These guidelines are working if:** diffs contain only requested changes, code is simple the first time, and clarifying questions arrive before implementation rather than after mistakes.

## House Rules

- **Check before creating** — search for an existing tool, skill, or helper before adding one. Reuse over duplication.
- **One concern per commit** — each commit addresses a single logical change.
- **The API is beta** — request and response shapes may change. Fetch `https://api.conductor.build/v0/openapi.json` for the current contract instead of hardcoding assumptions; that document is also the only authoritative list of accepted `agent` and `model` ids.
- **Don't wrap endpoints one-for-one** — an MCP tool exists to make a task easy for an agent, not to mirror a route table. Prefer a few task-shaped tools over twenty thin proxies.
- **Surface `userMessage`** — Conductor errors carry a human-readable `userMessage`. Pass it through to the agent rather than swallowing it into a generic failure.
- **Keep the README honest** — when you add a setting, an env var, or an install step, update `README.md` in the same commit.

## Checks

One command must pass before a PR, and CI runs the same one:

```bash
npm run check
```

It type-checks, bundles `src/` into `dist/index.js`, then runs `scripts/smoke.sh`, which starts the built server and asserts it answers `tools/list`. The smoke step is not redundant with the build: dropping the `ListTools` handler still type-checks cleanly but breaks every client.

`smoke.sh` runs that handshake twice — once against the working tree, once against a copy with `node_modules` stripped, which is how Cursor actually installs this plugin. The second run is what fails if `dist/index.js` stops being self-contained. The build is deterministic, so `npm run check` leaves the tree clean unless `src/` actually changed. When it does change, `dist/index.js` shows up dirty — commit it alongside the source rather than reverting it.

There is no unit test suite yet.

## Enforced Rules

| Rule | Enforcement |
|------|-------------|
| Never push to `main` | BLOCKING |
| No destructive git ops without confirmation | BLOCKING |
| No `.env` / secrets access | BLOCKING |
| Never log, print, or commit an API key | BLOCKING |
| Files in kebab-case | BLOCKING |

## Naming

| Type | Convention | Example |
|------|------------|---------|
| Files & directories | kebab-case | `session-poller.ts` |
| Skill `name:` | kebab-case, matches its directory | `name: conductor-cloud` |
| MCP tool names | snake_case, verb first | `create_workspace` |
| Headings | Title Case | `## Typical Flow` |

## Safety

### Secrets

`CONDUCTOR_API_KEY` is a live credential for someone's repositories and compute. Treat it accordingly:

- **Never log it, echo it, print it in an error, or write it to a fixture, test, or commit.** Redact it in debug output.
- Read it from the environment. Never accept it as a tool argument an agent could paste into a transcript.
- When a request fails, log the status and `userMessage` — never the `Authorization` header.
- The same applies to `CONDUCTOR_API_TOKEN` and any agent-provider key.

### Destructive Operations — NEVER without confirmation

| Operation | Examples |
|-----------|----------|
| Force push | `git push --force`, `git push -f` |
| Hard reset | `git reset --hard`, `git checkout .`, `git clean -fd` |
| Branch delete | `git branch -D` |
| File destruction | `rm -rf` on any directory |

This extends to the Conductor API: `POST /v0/workspaces/{id}/archive` and `POST /v0/sessions/{id}/cancel` destroy someone else's in-flight work. Confirm before calling either on a workspace you did not create.

### Protected Files

- **Never read/modify:** `.env`, `.env.*`, `secrets/`, `*.pem`, `*.key`, `*.cert`
- **Confirm before modifying:** `package.json`, `.github/workflows/`, `LICENSE`

### Branch Protection

Never push to `main`. Always work on a feature branch and open a pull request.
