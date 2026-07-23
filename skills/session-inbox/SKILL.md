---
name: session-inbox
description: "Sweep the idea queue — hub Ideas Discussions plus the Siri/Reminders intake lane — and triage each new idea: reply in-thread as obotclaw[bot], classify it (todo / requirement candidate / update / design note), and surface the batch for @jwildfire review in the session framework. Use at session kickoff (called from session-init step 2.5), when @jwildfire says '/session-inbox', 'sweep the ideas inbox', 'any new ideas?', or after he mentions dropping ideas in the Ideas board or the obot Reminders list. Do NOT use for already-scoped roadmap work (file/edit the issue directly) or for mid-session task capture (that is session-update)."
---

# Session Inbox

The triage half of the idea queue ([obot.roadmap#48](https://github.com/jwildfire/obot.roadmap/issues/48)).
Capture is deliberately Claude-free and zero-token: ideas arrive as **Ideas-category
Discussions** on the hub (typed directly, or filed by the Siri → Reminders →
[`reminders-to-ideas`](../../scripts/reminders-to-ideas) lane). This skill is the
only place tokens are spent — one bounded pass per session, not a persistent
"ideas" session.

The queue's front door for @jwildfire: the pinned explainer at
[discussion #47](https://github.com/jwildfire/obot.roadmap/discussions/47).

## Procedure

### 1. Ingest the Reminders lane

```bash
obot.agent/scripts/reminders-to-ideas
```

Files pending "obot"-list reminders as Ideas discussions (marking each complete
only after a successful post) and diverts `private:`-prefixed items to the local
private inbox, which is never posted. If the script reports no "obot" list or a
Reminders permission problem, note it in the digest and continue — the
Discussions lane still works.

### 2. Sweep the queue

```bash
obot.agent/scripts/ideas-sweep
```

One JSON line per discussion new or updated since the last watermark (the pinned
explainer #47 is excluded). **Do not `--advance` yet.** An updated thread usually
means @jwildfire replied — re-read the whole thread (`gh api graphql` discussion
comments) before acting, per the draft-sync spirit: the thread is the source of
truth, not the sweep snapshot.

### 3. Triage each idea

| Looks like | Action |
| --- | --- |
| Quick todo / chore | Add to the session todo list ([`session-update`](../session-update/SKILL.md)); if it has a deadline, offer the `priority` flow |
| Requirement candidate | Draft via [`requirement-drafting`](../../../obot.roadmap/.github/skills/requirement-drafting) — draft only; posting waits for @jwildfire |
| Update to existing work | Draft the comment/edit against the existing issue or PR |
| Design fragment | Attach to the relevant requirement's Design section or design doc |
| Unclear | Ask the clarifying question in-thread and leave it in the queue |

### 4. Reply in-thread

Every triaged thread gets one reply as obotclaw[bot]
(`GH_TOKEN=$(obot.agent/scripts/obot-app-token) gh api graphql` with
`addDiscussionComment`): the proposed shape ("reads as a requirement for X —
draft attached at next session", "added to today's session todo") or the
clarifying question. Keep replies short; hub bodies use no hard wraps; the
drafted-by attribution line goes at the bottom after a `---` rule.

### 5. Surface the batch

Fold the triage results into the session's prioritized list (kickoff list at
init, [`session-todo`](../session-todo/SKILL.md) mid-session): what was
classified where, what awaits a decision. @jwildfire reviews there — nothing
posts beyond in-thread replies and drafts without the normal approval gates.

### 6. Promote on approval

When @jwildfire approves a candidate: post the Requirement issue (standard hub
lifecycle), reply in-thread with the issue link, then close the discussion as
resolved (`closeDiscussion`, reason `RESOLVED`). Closing is the lifecycle end of
a promoted idea — never delete a discussion.

### 7. Advance the watermark

Only after replies are posted and the batch is surfaced:

```bash
obot.agent/scripts/ideas-sweep --advance
```

If the pass aborted midway, leave the watermark alone — the next sweep re-lists
the same threads, and step 2's re-read makes the pass idempotent.
