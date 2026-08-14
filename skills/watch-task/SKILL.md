---
name: watch-task
description: After a Conductor task is launched, spin up a short-lived Grok Bot routine that polls the session and notifies the user when it finishes or needs input — without blocking the current turn.
---

# Watch Task

## The Gesture

After you call `continue_session` to send a job, do not sit in the current turn polling it. Start a Grok Bot routine that wakes up every few minutes, checks the session, and surfaces a message when there is something for the user to act on. End your turn immediately after creating the routine.

## When To Use

- You just called `continue_session` to send a job to a cloud session.
- The work will take more than a minute.
- No watch already targets this `sessionId` — one watcher per session.

## Setup

Use the `schedule` skill to create a Grok Bot routine with:

- **Cadence**: every 3 minutes
- **Expiry**: 4 hours after creation — the routine must stop itself at that point regardless of session state
- **Model**: a fast, lightweight tier (Haiku or equivalent)
- **Prompt**: the self-contained template below with all placeholders filled

Once the routine is created, tell the user: *"I'll notify you when the session finishes or needs input."* Then end your turn.

### Routine Prompt

The routine has no conversation history. Every fact it needs must be in this prompt.

```
You are a session watcher for sessionId {{sessionId}}.
Workspace deep link: {{deepLink}}
Watch created at:    {{watchCreatedAt}}   (ISO-8601; timestamp of the most recent assistant turn when the watch began)

On each wake, follow these steps in order:

1. EXPIRY — if now is more than 4 hours past watchCreatedAt, stop all future wakes and do nothing else.

2. STATUS — call get_session_status for {{sessionId}}.
   If state is "working" → stop. Stay quiet.

3. TRANSCRIPT — call get_transcript for {{sessionId}} with no cursor.
   Find the last assistant message.
   If its timestamp is not after watchCreatedAt → stop. No new output yet.

4. NOTIFY — the session is idle with new output. Choose one:
   • If the last assistant message ends with "?" or asks for confirmation:
       Reply with: "The agent needs your input — <quote the message, ≤ 200 chars>  {{deepLink}}"
   • Otherwise:
       Reply with: "Task done — <one-sentence summary of what the agent did>  {{deepLink}}"
   Then stop all future wakes.
```

## Rules

- **One watcher per session.** Confirm no existing watch targets this `sessionId` before creating.
- **Quiet while working.** Step 2 is a hard gate. Never surface a notification while state is `"working"`.
- **Idle ≠ done.** A session can be idle before the task starts. The timestamp check in step 3 is what distinguishes "not started yet" from "finished."
- **No secrets in the prompt.** Routine prompts are stored server-side. Do not include `CONDUCTOR_API_KEY` or any credential.
