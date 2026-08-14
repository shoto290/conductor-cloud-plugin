---
name: watch-task
description: After a Conductor session is launched, set up a cron-style background watch that polls until the session goes idle, then pings the user with a summary and deep link — without blocking the current turn. Use immediately after send_prompt when the user should not have to wait.
---

# Watch Task

## The Gesture

One move: **hand supervision to a background watcher.** After you launch a session with the conductor-cloud skill, call this skill to schedule a lightweight cron agent that polls in the background. You return control to the user immediately; the watcher pings them when the session finishes or asks a question.

## When To Use

- You just launched a Conductor session (`create_workspace` + `send_prompt`) and the task will take more than a minute.
- The user should not have to wait in the current turn.

Do not use this skill to create workspaces or sessions. It only watches sessions that already exist.

## What You Need Before Starting

Collect these from the workspace you already launched:

| Name | Source |
|------|--------|
| `sessionId` | returned by `create_workspace` or `sessions create` |
| `workspaceId` | returned by `create_workspace` |
| `deepLink` | returned by `create_workspace` or `get_workspace` |
| `watchCreatedAt` | current wall-clock time as ISO-8601 — the cutoff for "new" output |

## Setting Up The Watch

Before calling `CronCreate`, check `CronList` for an existing watcher that references the same `sessionId`. Do not stack watchers — if one already exists, tell the user and skip creation.

Call `CronCreate` with:

- **Schedule**: `*/3 * * * *` (every 3 minutes)
- **Model**: a fast, lightweight tier (Haiku or the agent's default fast model) — the watcher only reads and notifies; it does not write code
- **Prompt**: the filled-in template below

After `CronCreate` returns a `cronId`, confirm to the user: `"Watching session <sessionId>. I'll notify you when it finishes or needs input."` Then end your turn.

### Cron Prompt Template

Fill in every `{{placeholder}}` before passing the prompt. The cron agent has no conversation history, no files, and no memory — every fact it needs must be in the prompt.

```
You are a session watcher. On each wake, follow these steps exactly, then stop.

Context (do not modify):
  sessionId:      {{sessionId}}
  workspaceId:    {{workspaceId}}
  deepLink:       {{deepLink}}
  watchCreatedAt: {{watchCreatedAt}}
  watchSessionId: {{sessionId}}   # used for CronList self-lookup below

Steps:

1. TIMEOUT CHECK
   If the current time is more than 4 hours past watchCreatedAt:
   - Call CronList. Find the entry whose prompt contains "watchSessionId: {{sessionId}}".
   - Call CronDelete on that entry's ID.
   - Stop. Do not send any notification.

2. STATUS CHECK
   Call get_session_status(sessionId).
   If state is "working" → stop. Do not notify. The task is still running.

3. TRANSCRIPT CHECK (only reached when state is "idle")
   Call get_transcript(sessionId) with no `after` cursor.
   Find the last assistant message in the transcript.
   If it has no timestamp or its timestamp is not after watchCreatedAt → stop quietly.
   The task has not produced new output yet.

4. NOTIFY
   The session is idle and has new output. Determine the message type:

   a. QUESTION — the last assistant message ends with "?" or contains any of:
      "do you want", "should I", "please confirm", "let me know", "which would you prefer"
      Send PushNotification:
        title: "Agent needs your input"
        body:  <last assistant message trimmed to 200 chars> + " → " + deepLink

   b. DONE — everything else
      Send PushNotification:
        title: "Task finished"
        body:  <one-sentence summary of what the agent did> + " → " + deepLink

5. SELF-DELETE
   Call CronList. Find the entry whose prompt contains "watchSessionId: {{sessionId}}".
   Call CronDelete on that entry's ID.
   Stop.
```

## Rules

- **One watcher per session.** Check `CronList` before creating. Duplicate watchers both notify the user and fight over self-deletion.
- **Self-delete on every exit path.** Steps 1 and 5 are both deletions. A watcher that never deletes leaks.
- **No noise while working.** Step 2 is a hard gate. Never notify while `state` is `"working"`.
- **Idle ≠ done.** A session can be idle before the task even starts. Step 3's timestamp check is what distinguishes "waiting to begin" from "finished."
- **Cheap model only.** This agent reads three tools and sends a notification. Do not assign a full reasoning model.
- **No secrets in the prompt.** The cron prompt is stored on Conductor's servers. Do not put `CONDUCTOR_API_KEY` or any credential into it.
