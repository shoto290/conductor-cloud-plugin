# CLOUD.md — Conductor Cloud & API Reference

Everything this plugin talks to. Read this before writing code that calls Conductor.

Sources: [Conductor API](https://www.conductor.build/docs/api), [What is Conductor Cloud?](https://www.conductor.build/docs/cloud), [Work with cloud workspaces](https://www.conductor.build/docs/cloud/working-with-cloud-workspaces), [Cloud FAQ](https://www.conductor.build/docs/cloud/faq), [Cloud environment variables](https://www.conductor.build/docs/cloud/environment-variables).

## What Conductor Cloud Is

Conductor runs each coding agent in its own isolated Linux sandbox with the organization's repositories and dependencies pre-installed. Agents keep working after the user disconnects. Workspaces and chats are shared with the organization, so a teammate can open the same workspace and pick up the same conversation.

Three concepts:

| Concept | What it means |
|---------|---------------|
| Organization | The team: its people, repositories, workspaces, and shared settings. |
| Cloud Computer | The organization's shared environment — repositories, environment variables, secrets, installed software. One per organization. |
| Cloud workspace | An isolated sandbox for one repository and branch, created from the Cloud Computer's active build. |

Cloud workspaces require a **Pro, Teams, or Enterprise** plan.

## The API

Base URL: **`https://api.conductor.build/v0`**

> **The API is v0 and in beta. Request and response shapes may change.**
> Do not hardcode assumptions about the contract. Fetch `https://api.conductor.build/v0/openapi.json` for the current spec — it is also the only authoritative list of accepted `agent` and `model` ids.

### Authentication

Pass the API key as a bearer token on every request:

```
Authorization: Bearer <CONDUCTOR_API_KEY>
```

Keys are created at [app.conductor.build/users/api-keys](https://app.conductor.build/users/api-keys) (requires a Conductor Pro account). Read the key from the `CONDUCTOR_API_KEY` environment variable.

**Never log the API key.** Not in debug output, not in an error message, not in a test fixture, not in a commit. When a request fails, log the HTTP status and the response's `userMessage` — never the `Authorization` header or the raw request. Never accept the key as a tool argument an agent could paste into a transcript.

### Required: `User-Agent`

**Custom clients must send a `User-Agent` header.** The API sits behind a proxy that rejects some default client signatures with a **403** — notably Python's `urllib`. `curl` and `python-requests` work as-is.

Send an explicit, identifying value from this plugin, e.g. `conductor-cloud-plugin/<version>`. A 403 with no useful body almost always means a missing or rejected `User-Agent`, not a bad key — a bad key returns **401**.

### Endpoints

| Endpoint | What it does |
|----------|--------------|
| `GET /v0/projects` | List the repositories you can create workspaces in. |
| `GET /v0/projects/{id}` | Get a project. |
| `GET /v0/projects/{id}/workspaces` | List a project's workspaces. |
| `POST /v0/workspaces` | Create a workspace and its first session. |
| `GET /v0/workspaces/{id}` | Get a workspace. |
| `POST /v0/workspaces/{id}/rename` | Rename a workspace. |
| `GET /v0/workspaces/{id}/sessions` | List a workspace's sessions. |
| `GET /v0/workspaces/{id}/status` | Lifecycle: `initializing`, `ready`, `sleeping`, `archived`, … |
| `POST /v0/workspaces/{id}/archive` | Stop the machine and hide the workspace (restorable). |
| `POST /v0/workspaces/{id}/unarchive` | Restore an archived workspace and start its machine. |
| `POST /v0/workspaces/{id}/sleep` | Put the workspace to sleep (stays visible and resumable). |
| `POST /v0/sessions` | Add another agent chat to a workspace. |
| `GET /v0/sessions/{id}` | Get a session. |
| `POST /v0/sessions/{id}/rename` | Rename a session. |
| `POST /v0/sessions/{id}/archive` | Archive a session (close its chat). |
| `POST /v0/sessions/{id}/messages` | Send a prompt to the agent. |
| `GET /v0/sessions/{id}/messages` | Read the session transcript. |
| `GET /v0/sessions/{id}/status` | Whether the agent is `idle`, `working`, or errored. |
| `POST /v0/sessions/{id}/cancel` | Stop the current turn and drop queued messages. |
| `GET /v0/messages/{id}` | Get a single transcript message. |
| `POST /v0/sql` | Read-only SQL over your organization's session transcripts. |
| `GET /me` | Verify a token. |

### Pagination and errors

List endpoints take `limit` / `offset` and return `{ data, offset, hasMore }`. `GET /v0/sessions/{id}/messages` also takes `after=<messageId>` — messages after that id, ascending, and it **cannot be combined with `offset`**. Use `after` for polling.

Errors return a structured body with a human-readable **`userMessage`**. Surface it. Documented statuses: `400` invalid request, `401` missing/invalid bearer token, `404` not found, `403` rejected client signature (see `User-Agent` above).

## Typical Flow

### 1. Pick a repository

```bash
curl https://api.conductor.build/v0/projects \
  -H "Authorization: Bearer $CONDUCTOR_API_KEY" \
  -H "User-Agent: conductor-cloud-plugin/0.1.0"
```

### 2. Create a workspace

`POST /v0/workspaces` requires **either** `projectId` **or** `repositoryUrl`. Optional: `branch`, `name`, `sessionName`, `agent`, `model`, `effort`, `env`.

```bash
curl -X POST https://api.conductor.build/v0/workspaces \
  -H "Authorization: Bearer $CONDUCTOR_API_KEY" \
  -H "User-Agent: conductor-cloud-plugin/0.1.0" \
  -H "Content-Type: application/json" \
  -d '{
    "projectId": "PROJECT_ID",
    "name": "fix-login-redirect",
    "agent": "claude",
    "model": "opus"
  }'
```

Returns `{ workspaceId, sessionId, deepLink }`. The `deepLink` opens the workspace in Conductor — hand it back to the user.

- **Always pass an explicit `model`.** The defaults are conservative. `agent` is one of `claude`, `codex`, `cursor`, `acp`, and the model must match the agent; a mismatch fails with a `400` naming the valid ids. `effort` sets the thinking level for `claude` and `codex`.
- **Name what you create.** Unnamed workspaces get a random city name, and the workspace name also names the git branch.
- **Commits are attributed to the API caller's Conductor account.**
- `env` sets environment variables for the setup script, agent, and terminals.

### 3. Send a prompt

```bash
curl -X POST https://api.conductor.build/v0/sessions/$SESSION_ID/messages \
  -H "Authorization: Bearer $CONDUCTOR_API_KEY" \
  -H "User-Agent: conductor-cloud-plugin/0.1.0" \
  -H "Content-Type: application/json" \
  -d '{"message": "..."}'
```

**The session shares no context with you.** Write a self-contained brief: files, approach, constraints, definition of done.

### 4. Supervise it

> **Wait for `working` before trusting `idle`.**
> A queued prompt has not started a turn yet, and the session reports `idle` until it does. After sending, poll `GET /v0/sessions/{id}/status` until you have seen `working` at least once, then treat the next `idle` as done and read the reply from the transcript. A very fast turn can start and finish between polls — so if `idle` persists, check the transcript directly with `GET /v0/sessions/{id}/messages?after=<last message id>`.

Messages sent while the agent works are steered into the running turn, so a follow-up is the right way to correct a session that stalls or drifts.

## Calling the API From Inside a Cloud Workspace

| Variable | Availability |
|----------|--------------|
| `CONDUCTOR_API_URL` | Set in every cloud workspace. |
| `CONDUCTOR_API_TOKEN` | Workspace-scoped token, set by default in new machine-launched cloud workspaces when automatic API access is enabled. Other cloud workspaces get no automatic token. |
| `CONDUCTOR_API_KEY` | The user's own key when configured. **Always takes precedence** over the workspace token. Workspaces with an automatic token also set it here when the user supplies none. |
| `CONDUCTOR_SESSION_ID` | Current session id, in agent processes only (not setup scripts or terminals). Send as the optional `X-Conductor-Session-Id` header to attribute a request to its session. |

Resolve credentials as `CONDUCTOR_API_KEY` first, then `CONDUCTOR_API_TOKEN`:

```bash
curl -H "Authorization: Bearer ${CONDUCTOR_API_KEY:-$CONDUCTOR_API_TOKEN}" \
  ${CONDUCTOR_SESSION_ID:+-H "X-Conductor-Session-Id: $CONDUCTOR_SESSION_ID"} \
  -H "User-Agent: conductor-cloud-plugin/0.1.0" \
  "$CONDUCTOR_API_URL/me"
```

Other workspace variables: `CONDUCTOR_WORKSPACE_NAME`, `CONDUCTOR_WORKSPACE_PATH` (the repository checkout), `CONDUCTOR_ROOT_PATH` (same path), `CONDUCTOR_BASE_DIR` (directory containing the workspace — use it for caches and scratch files), and `CONDUCTOR_IS_LOCAL` (`0` in cloud workspaces).

`CONDUCTOR_*` names above are reserved and cannot be overridden, along with `HOME`, `PATH`, `PORT`, `NODE_PATH`, `CONDUCTOR_INTERNAL_*`, and `CONDUCTOR_GIT_AUTH_*`.

## The Sandbox

Every cloud workspace is a **Vercel sandbox running Linux** — not a Mac, and not the user's machine.

| | |
|---|---|
| OS | Amazon Linux 2023 |
| Hardware | 8 vCPUs, 16 GB RAM, 32 GB ephemeral NVMe |
| Region | `us-east-1` |
| Preinstalled | Node.js 24, npm, pnpm, Python 3, git, GitHub CLI, jq, ripgrep, Git LFS, tmux, Vim, Google Chrome |

Anything else is installed by [configuring the Cloud Computer](https://www.conductor.build/docs/cloud/cloud-computer). Homebrew, Xcode, and other macOS-only tooling do not exist here — a setup script shared with local workspaces must branch on `CONDUCTOR_IS_LOCAL` for Mac-only steps.

Storage is **ephemeral**. Nothing outside the repository checkout should be assumed to survive.

### Ports

Cloud workspaces do **not** receive `CONDUCTOR_PORT`. Start servers on an explicit port, listening on `127.0.0.1` or `0.0.0.0`:

```bash
npm run dev -- --host 0.0.0.0 --port 3000
```

The user then forwards the port from the workspace details. The forwarded local port usually differs from the sandbox port. Port `22` is reserved for SSH.

## GitHub Only

**Cloud workspaces support GitHub repositories only.** GitLab, Bitbucket, and other Git hosts are not supported — those repositories need local workspaces. Access comes from the Conductor GitHub App, which the organization connects during Cloud setup and can extend to additional GitHub organizations later.

Conductor manages git and GitHub CLI authentication inside the sandbox. **Do not copy GitHub tokens into Cloud Computer environment variables** — `CONDUCTOR_GIT_AUTH_*` is reserved for this.

## Chat Is Stored on Conductor's Servers

This is the one place Cloud differs from local Conductor on privacy, and it must be stated plainly to users:

> **Chat messages from cloud workspaces are stored on Conductor's servers.** With local Conductor, messages go straight to the model provider and session data stays on the user's device. Cloud sessions run in managed sandboxes, so Conductor stores session inputs and outputs to support them.

Consequences to design around:

- Anything a user or agent types into a cloud session is retained by Conductor and visible to the organization. Workspaces and chats are shared by default.
- `POST /v0/sql` lets anyone in the organization query those transcripts (read-only, over `session_transcripts_view`; useful columns include `workspace_id`, `workspace_name`, `session_title`, `transcript`, `transcript_updated_at`).
- Never put a secret in a prompt. If this plugin ever echoes a credential into a session message, that credential is now in an organization-wide transcript store.

## Sleep and Maximum Lifetime

Two independent clocks stop a sandbox:

| | |
|---|---|
| **Sleep** | After **4 hours** without agent or terminal activity. Keeping the workspace open in a focused Conductor window counts as activity. |
| **Maximum lifetime** | Every sandbox stops at **23 hours 50 minutes**, even when active. |

What survives: **files and chat history**. What does not: **running processes** — including in-flight agent turns, which the lifetime cap can interrupt mid-work.

Opening a workspace wakes it automatically, as does `Open via SSH`. After waking, interrupted servers and builds must be restarted and an interrupted agent turn must be resent. While asleep or unreachable, cloud terminals are read-only.

Design implications for this plugin:

- A long poll is not a substitute for durability. A session that was `working` can come back stopped rather than finished — check the transcript, don't assume the last known status still holds.
- Never assume a workspace created yesterday is still running. Check `GET /v0/workspaces/{id}/status` and expect `sleeping`.
- `POST /v0/workspaces/{id}/sleep` is the polite way to release a workspace you're done with; `archive` stops the machine and hides it.

## Gotcha Checklist

- [ ] `User-Agent` set on every request — otherwise 403.
- [ ] Explicit `model`, matched to the `agent`.
- [ ] Workspace named — the name becomes the branch.
- [ ] Prompt is self-contained — the session shares no context with you.
- [ ] Saw `working` before treating `idle` as done.
- [ ] Polled the transcript with `after=`, not `offset`.
- [ ] Surfaced `userMessage` on failure.
- [ ] Never logged, echoed, or committed the API key.
