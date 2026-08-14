---
name: send-prompt
description: Send a follow-up message to an existing Conductor Cloud session. Use when the sessionId is already known and you want to continue or redirect an in-progress agent without creating a new workspace.
---

# Send Prompt

## The Gesture

One move: **send a follow-up to a session that already exists.** You are continuing a conversation with an agent that has context, a running sandbox, and possibly in-flight work.

## When To Use

- You have a `sessionId` from a previous `create_workspace` or `list_workspaces` call.
- You want to add instructions, answer a question the agent raised, or redirect work mid-flight.
- The workspace is still alive (not stopped or expired).

**If you do not have a `sessionId`, stop here.** Ask the user to use the `conductor-cloud` skill (or `create_workspace` directly) to start a session first, then come back.

## Flow

1. **Confirm you have a `sessionId`** — if not, stop and tell the user to create a workspace first.
2. **Send the message** — `send_prompt` with the `sessionId` and your follow-up text. A response of `state: "queued"` is normal; it means the agent received the message.
3. **Supervise** — `get_session_status` until `state` is `idle`, then `get_transcript` (pass back the `after` cursor each time to fetch only new content). `idle` alone does not confirm the turn finished — wait for new transcript content after your cursor.
4. **Report back** — summarize what the agent replied or did. If the workspace deep link is needed, retrieve it with `get_workspace`.

## Writing The Follow-Up

The agent already has the repository and whatever prior turns established. You do not need to re-explain the full context — but **do** spell out anything that changed: a new constraint, a corrected file path, updated acceptance criteria.

Never include secrets, API keys, or credentials in the prompt text. Cloud chat is stored on Conductor's servers.

## Rules

- **Never create a workspace here.** This skill is for existing sessions only.
- **Never put a secret in a prompt.** Use environment variables in the sandbox, not chat messages.
- **Check workspace state before sending.** A sandbox stopped at 23h50m or sleeping after 4 hours idle will not receive the message usefully — surface this to the user instead of silently queueing into a dead session.
- **One key, from the environment.** `CONDUCTOR_API_KEY`. Never log it or echo it.
