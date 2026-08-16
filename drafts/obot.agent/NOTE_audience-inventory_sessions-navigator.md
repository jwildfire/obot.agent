<!-- STATUS: Drafted on 2026-08-16 23:0x BST — the audience inventory commissioned with jwildfire/obot.roadmap#218/#219; ships with the feed rebuild PR -->

# Who each element was for — the audience inventory of the sessions and Navigator pages

🧭🤖 obot-navigator asked for this as a first-class output of the rebuild: every element of both pages, audited for who it serves — @jwildfire (a returning human), an agent (a dense routine reader), or both — because the fault that produced both pages was rendering agent-to-agent artifacts nearly unmediated, and a fault like that rarely stops at one element.

Method: two read-only recon agents walked the rendered pages against their generators (file:line evidence for every claim, in their full reports), before the rebuild was designed. Dispositions below say where each element lives after the rebuild that ships with this note.

## The headline finding

Four wired alarm paths could never render. The state-file parser kept only `##` headings and `-` bullets, so the config-ledger verdict, the worker-ledger verdict, the delivery-record gap prefix and the roadmap-discipline headline — all written by the sweep every five minutes, two of them since this morning — were discarded before the page saw them. The Navigator read that tab all evening treating a quiet ledger section as a clean one; it was not clean, it was unrenderable. This is obot.agent#129 inverted: there a headline was swallowed and the check reported nothing while looking healthy; here the verdict was discarded while its detail survived. Fixed in this rebuild; recorded on #129.

The general lesson, in the Navigator's words: a verdict that is only a convention about line position is not protected. Whatever carries a verdict should be structurally distinguishable from a note, rather than relying on every consumer reading the same convention.

## Navigator tab, element by element

| Element | Was for | Disposition |
|---|---|---|
| Dead-observer banner + restart command | him | kept verbatim on both views — the one failure mode that matters |
| `swept:` stamp line | both | kept; and a FAILED-but-recent sweep now gets a banner instead of small grey print with literal asterisks |
| Config-ledger / worker-ledger verdicts | him (alarms), agent (clean detail) | previously unrenderable; now on both views — alarms banner, clean verdicts one line of small print |
| RC queue section | him | canonical copy is the Operations tab's queue; kept whole on /navigator/record; the swept line still carries the count |
| Per-row `[verified gh HH:MM]` stamps | agent | kept as per-source provenance — one stamp for all sources would be a lie |
| Decision answers section | both | kept on the record; the Operations tab is where he answers |
| Delivery record (30+ verdict rows, 50+ call rows, 300-char notes) | agent | moved: counts feed the metrics, escalation calls reach the feed, the whole record renders as tables on /session/log and stays whole on /navigator/record |
| Roadmap discipline findings (27 bulleted rows) | agent | rows stay on the record; the verdict headline (previously unrenderable) now renders above them |
| Recent events (typed at birth, flattened to prose) | him | the one news-shaped thing on the page — now the What-changed feed, with types, full timestamps and day grouping; snapshot remembers 60 events while the state file still shows 15 |
| Disclosure rows (summary + evidence) | both | kept — the one-line-plus-evidence contract survives everywhere |
| The `##`-section seam (unknown sections render untouched) | agent | kept, on /navigator/record — guarded by test |

What the tab never had and now leads with: the release metrics he asked for — issues/PRs by class, releases, decisions over 1/3/7/30/365 days, from GitHub and the decisions record, never from a page's own view of itself, with the age of every number on the page and the epochs named.

## Agents (sessions) tab, element by element

| Element | Was for | Disposition |
|---|---|---|
| Headline tiles: workers today / moved something | him | kept — the lede of the brief |
| Standing-sessions tile | him | demoted to a clause under the tiles |
| Before-worker-ids tile ($4,985.31, 147 agents) | neither — a constant, not news | moved to /session/log (tile + fold) |
| Running now / Ended badly groups | him | kept on the brief — the only groups that need him now |
| Delivered / produced-nothing rosters (12+ rows) | both | counts on the brief; rows on /session/log |
| Row disclosure (verdict prose, usage, claims, subagents) | agent | /session/log |
| "No session of its own" and "Before worker ids" folds | agent | /session/log |
| Cost legend + About-these-numbers fold | both | kept on both pages — the disclosure floor |
| Collapsed old live view (iframe) | agent — except its accomplishments feed, the only carrier of "what landed on GitHub" | iframe moved to /session/log; the accomplishments source (gh-sweep cache) now feeds the What-changed feed directly, so GitHub landings reach his page without a second dashboard |
| Population-difference note (roster count vs session-hub count) | him | moved with the iframe; load-bearing only where two counts share a screen |
| "Since you last looked" | him — absent | added: the last-look phrase now renders in the Agents header exactly as on the Operations tab |
| Serving-commit provenance | him — absent on this tab | still absent; noted as a follow-on rather than widened into this change |

What the tab never had and now leads with: the What-changed feed — the typed delivery journal (verdicts, and the Navigator calls that concern his authority: approvals, invariants, boundaries, exemptions), worker-id claims with their task headlines, terminal job transitions with an agent's dying words, and GitHub landings from the sweep cache. The old markdown path lost 60 of 84 delivery records to a roster join; the journal-based tables on /session/log cannot lose rows to a join.

## Patterns worth keeping from this audit

- Both pages' worst elements were correct. Every misplaced element was accurate data in the wrong register — the fault is never the number, it is who the sentence was written for.
- The alarm class repeats: a wired detector whose output cannot reach a reader is indistinguishable from a clean one. Three instances now (obot.agent#129, the audit-staleness finding, and this parser). Anything that writes a verdict should ask who renders it, and prove the rendering once.
- Per-source provenance stamps and the stale-observer rule survived every design change tonight, on purpose. They are the two honesty mechanisms both pages were built around, and every future surface should inherit them.

---

Drafted by 👯🤖 W0012 (Claude Code using Fable 5) for @jwildfire and 🧭🤖 obot-navigator, from recon by three read-only subagents (W0012's fan-out); full file:line evidence in the recon transcripts.
