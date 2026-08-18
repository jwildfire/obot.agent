<!-- STATUS: Posted to https://github.com/jwildfire/obot.agent/pull/208 on 2026-08-18 01:02 EDT -->
<!-- GITHUB_PROPERTIES: Milestone: v0.5.0, Labels: - -->

## What this is

The first piece of the morning fold — the thing that decides, every morning, whether there is anything worth telling him.

It writes no diary entry, renders no page and sends no push. Those are #202, [obot.roadmap#247](https://github.com/jwildfire/obot.roadmap/issues/247) and #205, and each acts on the verdict this produces. This one leads because the requirement says the gate is the whole design, and it is right: the last time this program published on a clock without asking first, the result was measured afterwards — 559 words on a day it called quiet, the things needing him at line 38, and a reader trained to skip.

Closes #200

## Roadmap context

Requirement [obot.roadmap#238](https://github.com/jwildfire/obot.roadmap/issues/238), from @jwildfire's adoption of the session-model decision (D0007, M2 and M3) on 16 August. He clicked adopt-all; the answer pipeline dropped it; it was recorded two days later. This is the first thing built against it.

The requirement's Design section was written as part of this work and now settles the two questions it was filed open — what schedules the fold, and what "content" means. Seven sub-issues sit under it, all filed and linked.

## What it decides, and why it is three questions

The decision says *content-gated* once, for three outputs whose false positives cost wildly different amounts.

| Output | Gate | A wrong yes costs |
|---|---|---|
| Diary entry | activity since the last fold | a thin entry; the record still exists |
| Briefing page | a change to his queue | nothing — one stable URL, rewritten |
| Push | a change **and** a non-empty queue | the credibility of the next push |

Underneath all three, one rule that is deliberately not symmetric: **an unknown is never reported as quiet.** A source that cannot answer exits 3, publishes nothing, and leaves the watermark where it was so the next fold still covers the window this one could not see. A stale sweep counts as unknown — an observer being dead is not evidence of a quiet night.

The queue is cumulative, so an item he has not closed carries every morning and never pushes twice. That is what makes ignoring it for a week free, which was the single most important property in M3.

## Evidence

- <a href="https://github.com/jwildfire/obot.agent/blob/w0045-fold-gate/tools/fold/README.md">tools/fold/README.md</a> — what it reads, what it refuses to read, and why it is a script rather than a session
- <a href="https://github.com/jwildfire/obot.agent/blob/w0045-fold-gate/tools/fold/lib/decide.mjs">lib/decide.mjs</a> — the gate, pure and testable
- <a href="https://github.com/jwildfire/obot.agent/blob/w0045-fold-gate/tools/fold/test/cli.test.mjs">test/cli.test.mjs</a> — the quiet-night acceptance, asserted on the filesystem rather than on the tool's own report
- <a href="https://github.com/jwildfire/obot.agent/blob/w0045-fold-gate/tools/fold/test/history.test.mjs">test/history.test.mjs</a> — calibrated against measured windows of real history

Run against the live workspace right now:

```
fold: FOLD  (dry run — nothing written)
window: 2026-08-17T04:55Z -> 2026-08-18T04:55Z

  diary    YES  activity: 214 commit(s) · 2 swept event(s) · 2 scratchpad file(s) grew
  briefing YES  no briefing has ever been published — publishing the first one so the URL exists
  push     no   no push: the first page existing is not news

queue: 1 RC · 3 decisions · 0 todos · 10 config items
```

Those four numbers were each cross-checked against their own source, not taken from the tool.

Suite: 886 pass, 0 fail across the full CI set, with `tools/fold/test/*.test.mjs` added to the workflow. `obot-policy validate` passes; the policy verdict sweep is unchanged at 30 verdicts.

## Technical briefing

Everything the fold owns lives under `.claude/fold/` — its own directory, because the Navigator's sweep declares itself sole writer of `.claude/session-hub/` and a second writer there is reported as a ledger fault. The one shared file it touches is the timing ledger, where a `fold` bookend now joins `init` and `wrapup`; the documented enum in `docs/session-framework.md` moves in the same commit, and the note that nothing reads that ledger yet is stated rather than left to be discovered.

Three source-selection decisions that are load-bearing:

- Release candidates come from `navigator-rc.json`, **not** `navigator-state.md` — the latter is a prose render that caps its event list at fifteen while the snapshot behind it keeps sixty.
- The blocker figure is unchecked bullets under `## Open`, **not** the sweep's `config ledger: 14 id(s) allocated` line, which is an integrity audit and would be wrong by four. The count is the entire payload; no item text goes near this code.
- Every time comparison uses a real instant. An event's `at` is a bare local `HH:MM`, and this machine's own records disagree with themselves across the BST-to-EDT move.

**A correction made while building.** Both #238 and #200 as filed named 5–13 August as the quiet stretch to calibrate against. That is the *diary's* gap, not a work gap — those nine days carry 29 commits across obot.agent and obot.roadmap, which is precisely the failure #238 exists to fix. The tests use measured windows instead: 2026-08-11T09:00Z→2026-08-12T08:00Z holds zero commits across all seven project repos, and the night of 16 August holds 116. #200's body carries the correction.

## Next

- #201, the day boundary — worth pulling forward. `findSessionMarker()` has returned null every day since **4 August**: the dashboard has been scoping its panels to the whole day for two weeks while their labels still read "since session start", and the only signal is one footer clause. The requirement called this a forecast; it is the live state.
- [obot.roadmap#247](https://github.com/jwildfire/obot.roadmap/issues/247), the briefing page, which turns this verdict into the thing he actually opens.
- Two defects found on the way and filed rather than absorbed: #206 (his dashboard is showing zero of ten config items and calling it an empty list) and #207 (the attribution guard passes `GH_TOKEN=$(…)` on trust, and a failed mint writes as him — with one instance of my own, recorded).

---

Drafted by 👯🤖 W0045 (Claude Code using Opus 5). Not reviewed by @jwildfire.
