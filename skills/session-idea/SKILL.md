---
name: session-idea
description: "File one idea to the hub's Ideas discussions for triage — the in-session capture door to the idea queue, posted as obotclaw[bot] in the same shape the Siri/Reminders lane produces, honouring the `private:` prefix. Files directly by default; `--print` dry-runs only when @jwildfire asks to see the composed post first. Use when @jwildfire says 'session idea: …', '/session-idea', 'file that as an idea', 'park that for triage', or a half-formed thought surfaces that belongs in the queue rather than in this session. Do NOT use for a task to pick up later (that is session-update), tooling or convention friction (that is session-scaffold), a diary observation (that is session-note), work that already has or clearly deserves an issue (file or edit the issue directly), or triaging the queue that already exists (that is session-inbox)."
argument-hint: "The idea to file"
---

# Session Idea

The **capture** half of the idea queue ([obot.roadmap#48](https://github.com/jwildfire/obot.roadmap/issues/48))
from inside a working session. [`session-inbox`](../session-inbox/SKILL.md) is the
**triage** half — it sweeps and classifies what has already arrived; this skill puts
one new thing in.

Capture is deliberately cheap and deliberately *not* triage. An idea filed here
leaves the session immediately: the hub's
[`ideas-triage` Action](https://github.com/jwildfire/obot.roadmap/blob/main/.github/workflows/ideas-triage.yml)
picks it up within minutes, and anything it cannot settle waits for the next
`session-inbox` sweep. That is the point — the thought is safe, the session
keeps its thread, and @jwildfire meets the idea at a moment he chose.

## When to Use

- @jwildfire says "session idea: …", "file that as an idea", "park that", "put
  that in the queue".
- A half-formed idea surfaces mid-work — a feature worth considering, a different
  approach, a question about direction — that is too raw to scope and not this
  session's job.

**Do not use** when the thing is:

| It is really a… | Use instead |
| --- | --- |
| Task to pick up later this session | [`session-update`](../session-update/SKILL.md) |
| Friction in the tooling, skills, or conventions | [`session-scaffold`](../session-scaffold/SKILL.md) |
| Observation worth the diary, not an action | [`session-note`](../session-note/SKILL.md) |
| Piece of work that already has (or obviously deserves) an issue | File or edit the issue directly |
| Durable fact or preference about how to work | Memory |
| Idea already in the queue needing a decision | [`session-inbox`](../session-inbox/SKILL.md) |

The line that matters: **`session-update` is for this session, `session-idea` is
for the roadmap.** If the answer to "when would we do this?" is "not now, and
somebody should decide," it is an idea.

## Procedure

### 1. Shape it before filing

An idea is read cold, days later, by the triage Action or by @jwildfire on his
phone. Spend one sentence making that possible — **shaping is one pass, not a
drafting exercise**: the triage Action reads it within minutes and can ask.

- **Title** — the idea itself, not a category. "Make `obot-merge --check` report
  mergeability" beats "merge tooling". Keep it under 80 characters; longer titles
  are truncated in the post but survive in full in the body.
- **Body** — the context the session has and the reader will not: what prompted
  it, what it would change, anything already ruled out. Two or three sentences.
  Link the PR, issue, or file that triggered it.

Do not design the solution here. If it needs a design, it needs a requirement,
and that is a different lifecycle.

### 2. Check the privacy lane

A `private:` prefix keeps the idea off the public hub — it is appended to the
local inbox and never posted. Honour it exactly as the Reminders lane does, and
carry the prefix through verbatim rather than deciding for yourself that
something is private.

### 3. File it

```bash
obot.agent/scripts/ideas-file "<title>" --body "<context>"
obot.agent/scripts/ideas-file "<title>" --print          # dry run: show, post nothing
obot.agent/scripts/ideas-file "private: <title>"         # local inbox, never posted
```

The script posts as obotclaw[bot] to the hub's Ideas category with the same
title/body/provenance shape [`reminders-to-ideas`](../../scripts/reminders-to-ideas)
produces — one queue, one format, whichever door the idea came through. It prints
the discussion URL.

**File directly and show the result — that is the default.** Use `--print` first
**only when @jwildfire dictated the idea and asked to see the composed post
before it goes out**; the dry-run → read-back → file loop is three round trips for
the common case.

### 4. Share and log — one round trip

Chain the scratchpad log line into the **same** Bash call as `ideas-file` (`&&`),
so filing, logging, and the URL cost one round trip:

- Give the discussion URL as a clickable Markdown link (GitHub Link Sharing
  Convention).
- Append one line to the scratchpad's `## Session log` —
  `- $(date +%H:%M) {tag} — filed idea: {title} {url}`, timestamp **shelled**,
  inserted **under the heading** with the command in
  [`templates/sibling-briefing.md`](../../templates/sibling-briefing.md) — so
  [`session-wrapup`](../session-wrapup/SKILL.md) can count captured-but-unpromoted
  ideas without mining transcripts.

### 5. Hand off — do not triage it

Return to the work in flight. Filing an idea is not a licence to start it, and
**not** an invitation to triage it in-session: the Action answers within minutes
and `session-inbox` catches the rest. Triaging your own fresh post just spends
tokens racing a lane that already works.

This is the general pattern the whole framework follows — **capture, hand off,
return**; the rule is stated for every skill in
[`docs/session-framework.md`](../../docs/session-framework.md).

## Lifecycle

`ideas-file` → the hub's Ideas category → the `ideas-triage` Action (issue +
resolved thread, or a question in-thread) → whatever it missed is swept by
`session-inbox` at the next kickoff → on @jwildfire's approval the idea becomes a
Requirement issue and the discussion closes as `RESOLVED`. Discussions are closed,
never deleted.
