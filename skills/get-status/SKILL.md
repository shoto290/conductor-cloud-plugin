---
name: get-status
description: Read how a cloud session is doing — session state, any new agent output since a cursor, and the workspace deep link. Use when the user asks what a session is doing, whether it has finished, or wants to see its latest output.
---

# Get Status

## The Gesture

Two calls: **`get_session_status`**, then **`get_transcript`** with an `after` cursor if you have one.

## When To Use

- The user asks what a session is doing, whether it has finished, or wants to see its latest output.
- You are supervising a session you started and want to check progress.

Do not create a workspace or send a prompt — this skill is read-only.

## Flow

1. **`get_session_status`** — pass the `sessionId`. Note the session state (`idle`, `working`, `queued`) and the workspace state.
2. **`get_transcript`** — pass the `sessionId` and the `after` cursor from your last poll (omit on the first call). Keep the cursor it returns for the next poll.
3. **Decide if the turn is done** — a turn is complete when the session is `idle` **and** `get_transcript` returned new content after your cursor. `idle` alone is ambiguous: the session also reads `idle` before its first turn starts. Seeing `working` confirms the turn began, but is not required — a short turn can start and finish between two polls, so never block waiting for `working`.
4. **Get the deep link** — if the user needs to open the workspace, call `get_workspace` with the `workspaceId` and return its `deepLink`.

## What To Return

- A short status line: state, and whether the turn appears done or still in progress.
- Any new agent text from `get_transcript` (trim internal tool calls; surface the prose the agent wrote).
- The `deepLink` if the user asked for it or would clearly want it.

## Rules

- **Never create or prompt.** This skill observes; it does not act.
- **Pass the cursor forward.** Always use the `after` value `get_transcript` returns so each poll costs one reply, not the whole history.
- **Sleeping is expected.** A workspace goes `sleeping` after four idle hours. Report that state clearly rather than treating it as an error.
