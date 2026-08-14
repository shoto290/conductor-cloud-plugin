---
name: send-prompt
description: Send a follow-up message to an existing Conductor Cloud session using continue_session. Use when the sessionId is already known and you want to continue or redirect an in-progress agent without creating a new workspace.
---

# Send Prompt

## The Gesture

One move: **call `continue_session` with a `sessionId` you already have.** Then stop — hand the `sessionId` back to the user so they can track progress with get-status or watch-task.

## When To Use

- You have a `sessionId` from a previous workspace creation.
- You want to send a follow-up, add instructions, answer a question the agent raised, or redirect work mid-flight.

**If you do not have a `sessionId`, stop here.** Tell the user to run create-task first to get one, then come back.

## Flow

1. **Confirm you have a `sessionId`** — if not, stop and tell the user to use create-task first.
2. **Call `continue_session`** with the `sessionId` and the follow-up message.
3. **Stop.** Return the `sessionId` to the user. Do not call `get_session_status`, `get_transcript`, or any other follow-up tool — that is the job of get-status or watch-task.

## Writing The Follow-Up

The agent already has the repository and whatever prior turns established. Spell out anything that changed: a new constraint, a corrected file path, updated acceptance criteria. The brief must be self-contained — do not assume the agent remembers details you mentioned only in this chat.

Never include secrets, API keys, or credentials in the message. Cloud chat is stored on Conductor's servers.

## Rules

- **Never create a workspace here.** This skill is for existing sessions only.
- **Never put a secret in a message.** Use environment variables in the sandbox, not chat messages.
- **Stop after `continue_session`.** Supervision is out of scope for this skill.
