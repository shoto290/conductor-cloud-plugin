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

Create a short-lived Grok Bot routine (standing order) with:

- **Cadence**: every 3 minutes
- **Expiry**: 4 hours — the routine must stop itself at that point regardless of session state
- **Model**: a fast, lightweight tier (Haiku or equivalent)
- **Prompt**: the self-contained template below with all placeholders filled

Before creating, call `get_transcript` for the session with no cursor and record the cursor it returns as `{{startCursor}}`. This marks the point before the task began; new content is anything after it.

Once the routine is created, tell the user: *"I'll notify you when the session finishes or needs input."* Then end your turn.

### Routine Prompt

The routine has no conversation history. Every fact it needs must be in this prompt.

```
You are a session watcher for sessionId {{sessionId}}.
Workspace deep link: {{deepLink}}
Start cursor:        {{startCursor}}   (transcript cursor captured before the task started)
Wake count:          {{wakeCount}}     (increment on each wake; stop after 80 wakes ≈ 4 hours)

On each wake, follow these steps in order:

1. EXPIRY — if wakeCount has reached 80, stop all future wakes and do nothing else.

2. STATUS — call get_session_status for {{sessionId}}.
   If state is "working" → stop. Stay quiet.

3. TRANSCRIPT — call get_transcript for {{sessionId}} with after={{startCursor}}.
   If no new content is returned → stop. The session is idle but nothing new has been written yet.

4. NOTIFY — the session is idle and has new content after the start cursor. Choose one:
   • If the last new assistant message ends with "?" or asks for confirmation:
       Reply with: "The agent needs your input — <quote the message, ≤ 200 chars>  {{deepLink}}"
   • Otherwise:
       Reply with: "Task done — <one-sentence summary of what the agent did>  {{deepLink}}"
   Then stop all future wakes.
```

## Rules

- **One watcher per session.** Confirm no existing watch targets this `sessionId` before creating.
- **Quiet while working.** Step 2 is a hard gate. Never surface a notification while state is `"working"`.
- **Idle ≠ done.** A session can be idle before the task produces output. Step 3's cursor check is what distinguishes "not started yet" from "finished."
- **No secrets in the prompt.** Routine prompts are stored server-side. Do not include `CONDUCTOR_API_KEY` or any credential.
