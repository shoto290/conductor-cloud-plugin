---
name: conductor-cloud
description: Hand a self-contained job to a Conductor Cloud agent running in its own sandbox, then supervise it to done. Use when work is independent of what you are doing now, long-running, or better run in parallel — and when the user asks to delegate, farm out, or kick off work in the cloud.
---

# Conductor Cloud

> **Status: early.** Not every step below has a tool behind it yet. If a step names a tool you cannot see in your tool list, say so rather than improvising a substitute.

## The Gesture

One move: **send a job to a cloud agent.** A cloud session is a separate agent in a separate sandbox — you are handing off work, not extending your own turn.

## When To Use

- The work is independent of the change in front of you.
- It is long-running, or several jobs could run at once.
- The user says delegate, farm out, kick off, or run it in the cloud.

Do not reach for it when the job needs the user's local machine, a non-GitHub repository, or context that only exists in this conversation and cannot be written down.

## Flow

1. **Pick the repository** — `list_projects` returns what the key can create workspaces in. Match the user's repository to one of them and keep its `id`; do not guess an id the tool did not return.
2. **Create the workspace** with an explicit name, agent, and model. The name becomes the git branch, so name it after the job.
3. **Send the brief.**
4. **Supervise.** A queued prompt has not started a turn yet, and the session reports `idle` until it does — wait until you have seen `working` before treating `idle` as done, then read the reply from the transcript.
5. **Hand back the deep link** so the user can open the workspace themselves.

## Writing The Brief

**The session shares no context with you.** It has the repository and nothing else — not this chat, not the files you have open, not the decision you just made with the user. A brief that assumes otherwise produces an agent that guesses.

Every brief states: the files or area to touch, the approach and any constraint, and the definition of done.

## Rules

- **One key, from the environment.** `CONDUCTOR_API_KEY`. Never accept it as a tool argument, never log it, never echo it into a session message.
- **Never put a secret in a prompt.** Cloud chat is stored on Conductor's servers and readable by the whole organization.
- **Confirm before destroying someone else's work** — `archive` and `cancel` stop in-flight turns.
- **Do not assume a workspace is still awake.** Sandboxes sleep after 4 hours idle and stop at 23h50m regardless. Check the status; expect `sleeping`.
