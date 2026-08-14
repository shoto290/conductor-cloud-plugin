---
name: list-projects
description: List every Conductor Cloud repository the current API key can reach. Use when you need a project name, git remote, or id — never guess an id.
---

# List Projects

## When To Use

Any time you need a project `id` — to create a workspace, reference a repo, or answer "which repos exist."

## Steps

1. Call `list_projects` (no arguments).
2. For each entry, surface:
   - **name** — human-readable label
   - **gitRemote** — the repository URL
   - **id** — the opaque id used in other tool calls
3. If the user or another tool needs a specific project, match by name or remote and pass its `id` forward.

## Rules

- **Never fabricate an id.** Only use ids returned by `list_projects` in this turn.
- Do not call any other tool to supplement the list; `list_projects` is the authoritative source.
