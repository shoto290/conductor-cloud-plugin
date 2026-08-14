---
name: cancel-task
description: Stop an in-flight Conductor turn. Use when the user wants to abort a running session. Always confirm first — cancelling destroys work in flight and cannot be undone.
---

# Cancel Task

## The Gesture

One move: **cancel the running turn.** Call `cancel_session` with the `sessionId`. That is all — do not create a new session, do not send a follow-up prompt, do not poll for status.

## Rules

- **Always confirm before calling `cancel_session`.** The work in flight is gone the moment you do. There is no undo.
- **Do not start, prompt, or watch.** This skill only stops; everything else is out of scope.
