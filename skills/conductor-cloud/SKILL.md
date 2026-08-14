---
name: conductor-cloud
description: Hand a self-contained job to a Conductor Cloud agent running in its own sandbox, then supervise it to done. Use when work is independent of what you are doing now, long-running, or better run in parallel — and when the user asks to delegate, farm out, or kick off work in the cloud.
---

# Conductor Cloud

> **Status: scaffold.** The `conductor-cloud` MCP server installs and starts, but it exposes **no tools yet**. Until it does, perform the flow below with `curl` against `https://api.conductor.build/v0` — see the [Conductor API docs](https://www.conductor.build/docs/api).

## The Gesture

One move: **send a job to a cloud agent.** A cloud session is a separate agent in a separate sandbox — you are handing off work, not extending your own turn.

## When To Use

- The work is independent of the change in front of you.
- It is long-running, or several jobs could run at once.
- The user says delegate, farm out, kick off, or run it in the cloud.

Do not reach for it when the job needs the user's local machine, a non-GitHub repository, or context that only exists in this conversation and cannot be written down.

## Flow

1. **Pick the repository.** `GET /v0/projects`.
2. **Create the workspace.** `POST /v0/workspaces` with an explicit `name`, `agent`, and `model`. The name becomes the git branch, so name it after the job. Returns `{ workspaceId, sessionId, deepLink }`.
3. **Send the brief.** `POST /v0/sessions/{id}/messages`.
4. **Supervise.** Poll `GET /v0/sessions/{id}/status` until you have seen `working`, and only then treat `idle` as done. Read the reply with `GET /v0/sessions/{id}/messages?after=<last message id>`.
5. **Hand back the `deepLink`** so the user can open the workspace themselves.

## Writing The Brief

**The session shares no context with you.** It has the repository and nothing else — not this chat, not the files you have open, not the decision you just made with the user. A brief that assumes otherwise produces an agent that guesses.

Every brief states: the files or area to touch, the approach and any constraint, and the definition of done.

## Rules

- **One key, from the environment.** `CONDUCTOR_API_KEY`. Never accept it as a tool argument, never log it, never echo it into a session message.
- **Never put a secret in a prompt.** Cloud chat is stored on Conductor's servers and readable by the whole organization.
- **Confirm before destroying someone else's work** — `archive` and `cancel` stop in-flight turns.
- **Do not assume a workspace is still awake.** Sandboxes sleep after 4 hours idle and stop at 23h50m regardless. Check the status; expect `sleeping`.
