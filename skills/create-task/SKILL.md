---
name: create-task
description: Start a Conductor Cloud task — create a workspace and optionally send an initial prompt. Use when the user wants to spin up a cloud session without waiting for it to finish. Does not poll or supervise; hands back the deep link immediately.
---

# Create Task

## The Gesture

One move: **start a cloud workspace and hand back the link.** Stop there — do not poll, do not supervise, do not cancel.

## Flow

1. **Get the project id** — if you already have it, skip this step. Otherwise call `list_projects` and match the user's repository to one of the results. Keep its `id`.
2. **Create the workspace** — call `create_workspace` with three required fields:
   - `name` — becomes the git branch; name it after the job (e.g. `fix/auth-timeout`)
   - `agent` — the agent type to run
   - `model` — the model id to use
   Keep the `workspaceId`, `sessionId`, and `deepLink` from the response.
3. **Send the brief (optional)** — if the user provided a prompt, call `send_prompt`. Write it as a self-contained brief: the cloud session has the repository and nothing else — not this chat, not open files, not prior decisions. Every brief states the area to touch, the approach, and the definition of done. If the user only wants an empty workspace, skip this step.
4. **Give the user the deep link** — return the `deepLink` from `create_workspace` immediately so the user can open the workspace themselves.

## Rules

- **Stop after step 4.** Do not call `get_session_status` or `get_transcript`. Do not wait for the session to reach `idle`.
- **Never cancel** a session you just started.
- **One key, from the environment.** `CONDUCTOR_API_KEY`. Never accept it as a tool argument, never log it, never put it in a prompt.
- **Never put a secret in a prompt.** Cloud chat is stored on Conductor's servers and readable by the whole organization.
