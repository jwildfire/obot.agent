---
name: session-inbox
description: "Sweep the idea queue — hub Ideas Discussions plus the Siri/Reminders intake lane — and triage each new idea: reply in-thread as obotclaw[bot], classify it (todo / requirement candidate / update / design note), and surface the batch for @jwildfire review in the session framework. Runs inside the init recon sibling, or on demand when @jwildfire asks — never inline in the lead during startup. Use when @jwildfire says '/session-inbox', 'sweep the ideas inbox', 'any new ideas?', or after he mentions dropping ideas in the Ideas board or the obot Reminders list. Do NOT use for already-scoped roadmap work (file/edit the issue directly) or for mid-session task capture (that is session-update)."
---

# Session Inbox

The triage half of the idea queue ([obot.roadmap#48](https://github.com/jwildfire/obot.roadmap/issues/48)).
Capture is deliberately Claude-free and zero-token: ideas arrive as **Ideas-category
Discussions** on the hub (typed directly, or filed by the Siri → Reminders →
[`reminders-to-ideas`](../../scripts/reminders-to-ideas) lane). This skill is the
only place tokens are spent — one bounded pass per session, not a persistent
"ideas" session.

The third capture door is [`session-idea`](../session-idea/SKILL.md), for an idea
that surfaces mid-session; it posts the same shape, so a thread reads the same
here whichever door it came through.

The queue's front door for @jwildfire: the pinned explainer at
[discussion #47](https://github.com/jwildfire/obot.roadmap/discussions/47).

## Where this runs

This sweep is **Tier 2 work — it never runs in the lead's response path.**

- **At kickoff** it runs inside the init recon sibling
  ([`templates/delta-sweep-briefing.md`](../../templates/delta-sweep-briefing.md),
  job 2). Init does not wait for it.
- **Invoked directly by @jwildfire mid-session**, the lead acks in one line,
  spawns, and returns — unless the sweep comes back empty on the first call,
  which is cheap enough to finish inline.

See the [responsiveness contract](../../docs/session-framework.md) for why.

**This pass is the backstop, not the front line** (2026-07-24): the hub's
[`ideas-triage` Action](https://github.com/jwildfire/obot.roadmap/blob/main/.github/workflows/ideas-triage.yml)
triages each new post within minutes — filing issues and closing confident
threads, or asking @jwildfire questions in-thread. So the **default expectation
is an empty or near-empty queue**: this skill catches whatever that lane missed
(Action disabled, low-confidence threads still open, the Reminders lane, the
private inbox). **If `ideas-sweep` returns nothing, report `no new ideas` in one
line and stop — do not run steps 3–7.** Skip closed threads entirely; they need
no re-triage.

## Procedure

### 1. Ingest the Reminders lane

```bash
obot.agent/scripts/reminders-to-ideas
```

Files pending "obot"-list reminders as Ideas discussions (marking each complete
only after a successful post) and diverts `private:`-prefixed items to the local
private inbox, which is never posted. This step touches **macOS Reminders and can
stall on a permission prompt** — which is exactly why it must not sit in a lead's
response path. If the script reports no "obot" list or a Reminders permission
problem, note it in the digest and continue — the Discussions lane still works.

### 2. Sweep the queue

```bash
obot.agent/scripts/ideas-sweep
```

One JSON line per discussion new or updated since the last watermark (the pinned
explainer #47 is excluded). **Do not `--advance` yet.**

Bound the re-read: re-read only threads whose sweep line shows **new comments
since the watermark** (an updated thread usually means @jwildfire replied), and
**batch those reads into one `gh api graphql` call** rather than looping
thread-by-thread. Per the draft-sync spirit, the thread is the source of truth,
not the sweep snapshot.

### 3. Triage each idea

| Looks like | Action |
| --- | --- |
| Quick todo / chore | Add to the session todo list ([`session-update`](../session-update/SKILL.md)); if it has a deadline, offer the `priority` flow |
| Requirement candidate | Capture it as a **one-line proposal in the digest** and hand it to the wrapup's next-session queue |
| Update to existing work | Draft the comment/edit against the existing issue or PR |
| Design fragment | Attach to the relevant requirement's Design section or design doc |
| Unclear | Ask the clarifying question in-thread and leave it in the queue |

**Never draft a requirement inside a sweep.** Drafting is an arbitrarily long
composition task and belongs to its own pass —
[`session-idea`](../session-idea/SKILL.md) step 5 states the same rule from the
other direction (capture, hand off, do not triage).

### 4. Reply in-thread

Every triaged thread gets one reply as obotclaw[bot]. **Mint the token once for
the whole batch** (tokens expire in ~1h) and post the replies in a single
authenticated block rather than N sequential writes:

```bash
export OBOT_GH_TOKEN=$(obot.agent/scripts/obot-app-token)
test -n "$OBOT_GH_TOKEN" || exit 1
obot.agent/scripts/obot-gh api graphql -f query='<one addDiscussionComment call>'
```

The mint and the check are separate lines on purpose. `GH_TOKEN=$(mint) gh ...`
looks like it checks the mint and does not — a command substitution in an
assignment prefix has its exit status discarded, so a failed mint leaves the
variable empty, `gh` reads an empty token as unset, and every reply in the batch
goes out as @jwildfire while reporting success (obot.agent#207). `obot-gh` reuses
an exported `OBOT_GH_TOKEN` and skips the mint, so the batch still costs one.

Each reply carries the proposed shape ("reads as a requirement for X — proposed
to the next-session queue", "added to today's session todo") or the clarifying
question. Keep replies short; hub bodies use no hard wraps; the drafted-by
attribution line goes at the bottom after a `---` rule.

### 5. Surface the batch

The batch **does not fold into the kickoff list** — init does not wait for it.
Write it into the recon sibling's corrections file
(`{workspace}/.claude/session-notes/{YYYY-MM-DD}-init-delta.md`, `Ideas` group)
as a **pending count plus one line per triaged thread**; the lead relays it as a
Tier 2 revision at its next turn. Mid-session invocations surface through
[`session-todo`](../session-todo/SKILL.md) as before. Nothing posts beyond
in-thread replies and drafts without the normal approval gates.

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
