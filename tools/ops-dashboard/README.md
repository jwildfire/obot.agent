# ops-dashboard — the Operations Dashboard

@jwildfire's **local** page: his todo list — release candidates, decisions, config —
and the place he answers decision artifacts instead of reading them on the public site
and typing the answer somewhere else. It is also the site's default view: the session
hub lives on the Agents tab of the same server.

Requirement: [jwildfire/obot.roadmap#180](https://github.com/jwildfire/obot.roadmap/issues/180) ·
decision that produced it: [Recording your decisions](https://jwildfire.github.io/obot.roadmap/reports/decisions/2026-08-15-decision-recording/).

## Vocabulary (@jwildfire, 2026-08-15)

- **Dashboard** — this local page. The Operations Dashboard.
- **Hub** — the public site with the roadmap, news and artifacts.
- **Config** — an item only his keyboard can apply: a settings line, a grant, a
  device-side step. Called "your hands" until 2026-08-15 ("let's call 'your hands' ->
  'config' and give them IDs. c0001, etc.").

Both words were used loosely for both things before today. They are not interchangeable now.

## Usage

From the workspace root:

```bash
node obot.agent/tools/ops-dashboard/ops-dashboard.mjs --serve   # http://127.0.0.1:7326/
node obot.agent/tools/ops-dashboard/ops-dashboard.mjs           # render once to stdout
```

The first four tabs are the **shared spine** (jwildfire/obot.roadmap#203): the same four
entities, in the same order, as the public hub's roadmap sub-nav, so a reader who knows one
surface can navigate the other without being told. A divider follows them, and everything
after it is this surface's own.

| Route | Tab | View | On the hub |
|---|---|---|---|
| `/` | Queue | his todo list — what needs him | `roadmap.html` |
| `/wire.html`, `/wire` | Wire | what changed, and how much since he last looked | `wire.html` |
| `/live.html`, `/session` | Agents | the Agents table — one row per agent, with a filter sidebar | the NOW strip, counts only |
| — | Catalog | links out; this surface does not duplicate the record | `catalog.html` |
| `/navigator` | Navigator | what the 🧭🤖 Navigator sweep has seen | — |
| `/session/log` | — | the full record: the roster by outcome, every verdict | — |
| `/session/frame` | — | the session hub's own render, served unchanged | — |
| `/artifact/<slug>/` | — | a decision artifact from the hub clone | — |

| Option | Meaning |
|---|---|
| `--serve` | run the loopback server (without it, one render to stdout) |
| `--port <n>` | port, default 7326 (or `$OBOT_DASHBOARD_PORT`); rolls forward if taken |
| `--exclusive` | bind the requested port or exit 1 instead of rolling forward — what an automatic restart uses, because a replacement that quietly lands on 7327 is a dashboard nobody can find |
| `--workspace <dir>` | workspace root (default: cwd) |
| `--hub <dir>` | obot.roadmap clone (default: `<workspace>/obot.roadmap`) |
| `--open` | print the URL once the server is up |

## What it shows

One queue, three sources:

- **Release candidates** — from the sweep `scripts/reviews-queue` already does,
  classified by release lane (see below) and cached in the ops store so the page opens
  instantly and works offline. Clicking one opens the pull request on GitHub; release
  candidates are reviewed there.
- **Decisions** — every open decision artifact, read from the hub's own collector
  (`scripts/lib/collect/decision-log.mjs`) rather than the deployed `decisions.json`,
  so a decision recorded five minutes ago is already here. Which *copy* of the hub is
  read is decided per request — see [What the page is made of](#what-the-page-is-made-of).
- **Config** — the workspace list at `<workspace>/.claude/blockers.md` and nowhere
  else. **Headlines only**: an item's body describes exactly which control stopped an
  agent, and there is no reason to render that on a queue row. Most items are captured
  by hand with `tools/blocker-log`; one class raises itself. A pull request touching a
  guardrail path is unmergeable by every agent, so `tools/carveout-route` reads
  `obot-merge --check` on the five-minute sweep and files the item — once per pull
  request, matched on the pull request rather than the headline (obot.agent#264).

In that order, his (2026-08-15): "RCs first. then decisions, then config items."

Below all three, and asking nothing of him, sit the two read-only panels:

- **Next ten** — what gets picked up next, rank declared and everything else derived
  (jwildfire/obot.roadmap#278).
- **Delivered** — what reached him. One completion per row, and the row is the SENTENCE
  saying what he can now do that he could not before, with the issue number as small
  print under it. Written by whoever closed the requirement, through
  `tools/landing-log`, which refuses a summary that is a list of issue numbers. Under it,
  only the things he asked for that have *not* been found where they were meant to land,
  each with its age and what the fetch actually returned — `unchecked` is rendered
  differently from `not-landed`, because a landing nobody could look at is not a landing
  that failed (jwildfire/obot.roadmap#257).


Clicking a decision opens the artifact in the main area and the answer controls in
the sidebar. **Adopt all is one click** — it is repeatedly his complete answer, and
it must never be six.

### Release-candidate labels

A release candidate reads `{package} vX.Y.Z-RCn` — `gsm.safety v1.1.0-RC1` — and carries
no summary at all (@jwildfire, 2026-08-15, superseding his own earlier rule the same day;
the rule is in the [RC framework](../../docs/rc-framework.md)). A correctly-titled RC is
therefore already its own label, and `rcLabel`'s remaining job is to *normalise* what the
queue still holds: PRs written before the rule, whose titles carry a summary it retired.
The summary is stripped rather than kept — a page that keeps rendering descriptions makes
a title that has one look correct. The version comes from the title when the title names
this package's version, otherwise from the `(Upcoming)` heading of the local clone's
`NEWS.md`; a version is never invented, and with none the label is the package alone. An
`-RCn` already in the title is authoritative and never renumbered: the counter is a
review-round fact this page cannot see.

### What counts as a release candidate

By **release lane**, never by readiness — one classifier, `tools/navigator/classify.mjs`,
shared with the Navigator sweep. A pull request is his to review when it targets a branch
holding the `release` role in `scripts/policy.json`, or he was asked for a review by name,
or he has already reviewed it and it is still open. Drafts are out.

Readiness still gates on top of that: `reviews-queue`'s `you` bucket (mergeable, checks
green, nothing sent back) says whether it is his *yet*. The lane says whether it is his
*at all*.

Until 2026-08-16 this module had no classifier and read `bucket == "you"` as "release
candidate". Those are different claims and the difference showed: the sweep listed two
RCs, the page listed three, and the third was `gsm.safety#51` — ordinary feature work
into `dev`, sitting in the panel the RC-only review rule exists to protect. Anything the
lane excludes is named in one line under the panel rather than dropped in silence.

The lane-classified sweep caches to `rcs-lane.json`, deliberately not `rcs.json`. The
cache is shared with any ops-dashboard process already running, and that process is
long-lived because nothing restarts it on a merge — writing a new shape into the old
file hands a running older server something it cannot parse. That is not hypothetical:
it turned the live queue page into a 500 on 2026-08-16. The file name is the schema.

### The ranked head — what comes next, below all three

Under the three buckets, at the bottom of the queue, sits the next ten requirements in
order (jwildfire/obot.roadmap#278). @jwildfire, 2026-08-18: *"Next 10 requirements show
up at the bottom of the queue maybe. you're responsible for strategy, so you get the
decision and then i can steer when i want to."*

**It is a preview, never a fourth bucket.** Read-only, no control of any kind, every
link leaving for GitHub. His queue holds exactly three things that need him and that
rule is jwildfire/obot.roadmap#220; the moment this asks him for something it becomes a
fourth obligation. `test/rank-head.test.mjs` asserts the absence of the ask rather than
trusting anyone to remember it.

**Rank is declared; everything else is derived.** Two things come from a file — the
position and the one-line why, in `obot.agent/rank/top10.json`. Title, state, milestone,
blocked-ness and sub-issue progress come from GitHub, keyed off the `top10` label
@jwildfire asked for so the list is one API call away. A label carries membership and
the file carries order; the two can disagree, and every disagreement is reported on the
panel rather than silently resolved.

**Two clocks, never merged.** "Ranked 2026-08-19, 3d old" is the order; "state refreshed
4m ago" is everything beside it. The declaration is read inline on every render, so the
order and the reasons survive an unauthenticated `gh`; only the derived half is cached
and refreshed behind the page. A refresh that failed says so in its own sentence, with
the age of what is actually on screen — never a silent substitution of old for current.
An age nobody could measure prints as "not known", never as a zero. The order's age
comes from `git log -1 -- rank/top10.json`, never the file's mtime, which a fresh clone
stamps with the moment it was written.

**A slot open is stated and left alone.** A `top10` label on a closed issue is a
computed condition, so the sweep raises it as a finding
(`tools/navigator/rankhead.mjs`) and this panel shows it. Neither chooses the
replacement — that is 🎩🤖 obot-prime's — and the bench reaches both surfaces as a
*count* so nothing either prints can be read as a recommendation. Nothing about it ever
reaches his config list.

Both surfaces read GitHub through the same module, spawned out of process by the
dashboard, so the page and the sweep cannot disagree about what the ten are. The cache
is `rank-head.json`, its failures `rank-head-failed.json`, under the same
name-is-the-schema rule as `rcs-lane.json`. Full contract: [`rank/README.md`](../../rank/README.md).

## What the page is made of

The page states three things about itself, on the healthy path as well as the bad one:

- **The code it is running** — the commit, its age, and whether the checkout has moved
  past it. Captured when the process loads, not read during a request: a long-running
  server's checkout moves on beneath it, so reading `HEAD` live names the code that is
  precisely *not* being served. A stale build cannot fix itself — a process cannot
  reload its own modules — so it says so and gives the restart.
- **Where its decisions came from** — the clone, or the freshest committed state of it.
  The clone is preferred, for the reason this page reads a clone at all: a decision
  recorded five minutes ago is in the working tree and in no published feed. It stops
  being preferred in exactly one case, a clean clone strictly behind its upstream, where
  the upstream is the clone plus more with nothing of his to lose. Then that tree is
  materialised into the ops cache and the hub's own collector is imported out of it —
  the same code the published log runs, so there is no second parser to drift from it.

- **Whether anything is pulling new code onto this machine at all** — and what the last
  attempt did. The first two report the snapshot; this one reports the *mechanism*,
  which is the half that fails invisibly: an updater that quietly stopped looks exactly
  like one with nothing to do. Read live on every render, from the record the sweep
  writes at `.claude/session-hub/cache/selfupdate.json`. Absent is a real answer and the
  commonest one on a machine without the sweep, so it says that rather than nothing.

His **hub** clone is never moved to get the decisions answer: no pull, no checkout, no
stash. A background `git fetch` every five minutes updates remote-tracking refs and
nothing else, and a clone with uncommitted decision edits keeps priority even when
behind, because his unsaved work outranks a tidier answer. The `obot.agent` checkout is
the one exception and it is a deliberate one — see below.

All three lines print when everything is fine. Twice on 2026-08-16 the running dashboard
was many merges behind `main` — eleven, the second time — and the hub clone it read was
four commits behind `origin/main`, which is why a decision he made that morning was still
listed as awaiting him. Both sat well inside any sane staleness threshold, so a line that
only appears when something is late would have caught neither.

### Merging is not deploying, so the checkout tracks `main`

Requirement [jwildfire/obot.roadmap#243](https://github.com/jwildfire/obot.roadmap/issues/243).

Everything on this machine runs from the local checkout, and a merge to `main` does not
move it. Nothing pulled, so nothing changed, and the failure was silent by construction:
a server serving old code looks exactly like a server serving new code. The same
mechanism bit three separate things in two days — the wake channel that merged and had
no effect, this dashboard serving an eleven-merge-old build twice, and the nightly
audit's findings file quoted as current at twenty-two hours old.

The five-minute Navigator sweep now fast-forwards the checkout and restarts what reads
it (`tools/navigator/selfupdate.mjs`). Two calls, made rather than implied:

**Which consumers get restarted.** Restarting one mid-request is worse than serving
stale for five more minutes, so the tiers are data rather than control flow:

| Tier | What | Why |
|---|---|---|
| Restarted | this server, holding the serve marker on the default port | a long-running server whose state is all on disk |
| Nothing to do | the launchd sweep; the admiral | both re-exec per run and pick up new code themselves |
| Never restarted, only reported | standing Claude sessions — prime, the Navigator, workers | their state is a conversation; restarting one destroys context nothing can rebuild |

Quiescence is this server's own answer, from `GET /healthz`: how many requests are in
flight, and how long since the last one finished. The probe is excluded from its own
accounting, which is the whole mechanism rather than a nicety — a health check that
counted itself as traffic would reset the idle clock every five minutes and the restart
would never fire. A build too old to have the endpoint falls back to the last-look
record; when neither can answer, the restart waits and says so.

**Only in-flight counts, and the wait has an end.** Those two numbers are not
interchangeable. A restart kills a request that is *in flight* — the marker's exit hook
calls `process.exit` without draining — and nothing else: the pages here fetch nothing
from this origin, so a closed response is complete on the wire. Time since the last
response is a guess about the future, and it was a twenty-second bar until
[#258](https://github.com/jwildfire/obot.agent/issues/258): anything that watched the
page starved the restart for as long as it kept watching, and on 18 August the checkout
stood at `7482007` while this server served `0832443`. Two seconds of it survive, for
the one thing it knows — a click is two requests. And every deferral is counted on the
record: after `DEFERRAL_LIMIT` (3, a fifteen-minute ceiling at this cadence) the restart
goes ahead regardless. A dropped request announces itself and a refresh repairs it; a
stale page is not visible as a fault at all.

**Restarted means this process is serving, not that the port answers.** The port
answering is a question the process being replaced answers perfectly well, so the check
compares the pid and the commit from `/healthz` against the replacement just spawned. A
replacement that never took the port is stopped rather than left running. And the check
only ever asks `/healthz` — asking for the page is traffic, and would seed the next
deferral.

A crashed dashboard is started again on the next sweep, and one he stopped on purpose is
not: `pkill` sends SIGTERM, the marker's release hook runs, and a released marker reads
as "nothing is advertising a dashboard". Only a crash leaves a marker behind.

**What happens when the fast-forward is refused.** It reports, and never forces. No
reset, no stash, no `git pull`, no merge that could conflict, and nothing that touches a
worktree — workers hold worktrees off this same repository and a dashboard refresh must
never disturb work in progress. Refused when: the checkout is on another branch, is a
linked worktree, is mid-merge or mid-rebase, has uncommitted changes to tracked files,
has diverged, or the remote could not be read. Untracked files never block — the drafts
folder is permanently full of them. Every refusal reaches this page, and reaches the
sweep's state file as a `**AUTO UPDATE FAILED**` alarm.

### The release-candidate panel

Clicking a release candidate opens it **in the middle column** rather than bouncing to
GitHub. @jwildfire asked for the PR itself in an iframe; that is impossible — github.com
answers `x-frame-options: deny` on a PR (verified 2026-08-15), so it renders blank
permanently, and proxying his authenticated GitHub session to defeat that would be a
security hole rather than a workaround.

The native panel is the better answer anyway: it opens instantly from the cache (so it
works with the network down), it matches the dashboard instead of dropping a foreign page
into the middle of it, and it follows his stated review order — *"skim the PR, read
through the demo page and then read the release notes"* — without GitHub's chrome around
it. Top to bottom: title with CI state and diff size, the one-sentence exec summary, the
ask, the `NEWS.md` link, the requirements the release closes, and the **demo page running
live in an iframe** (Pages sets no frame headers, so our own demo frames fine; a demo
hosted anywhere else degrades to a link).

This is only renderable because the [RC body contract](../../docs/rc-framework.md#what-an-rc-pr-must-carry)
gives every RC body the same shape — the contract makes the panel possible, and the panel
is why the contract is worth enforcing. Where a body predates the contract the panel says
so in place of the missing part ("No NEWS.md link — the contract requires one"), which is
a more useful nudge than a blank space.

**Approving stays on GitHub, deliberately.** Reviewing here means writing there, and
approving a release candidate is exactly the action that should stay a deliberate click:
the RC gate is @jwildfire's, and a one-click approve inside a local tool erodes it. The
panel ends with an *Open on GitHub to approve* link.

**The second line.** Because the title no longer explains itself, an RC row carries a
subtitle: the one-sentence executive summary the
[RC body contract](../../docs/rc-framework.md#what-an-rc-pr-must-carry) puts first in every
RC body, which `reviews-queue --json` already extracts as `lead` (so it costs no extra
call). It is the better line — the old summary was whatever an author typed into a title,
while this sentence is contract-mandated and has to be accurate, since it also heads the
PR he opens. It truncates to about 325px on a 390px phone, so the sentence's **first
words** are what he actually reads.

### Config ids

Every config item carries a permanent `c0001`-style id, claimed once at capture time by
[`tools/blocker-log`](../blocker-log) and stored in the list itself, so it survives the
item being reworded. The next id is one above the highest in the **whole** file,
retired entries included — a number is never reused, because he approves things by
quoting them ("c0007 is done") and the record has to stay unambiguous. Same rule as the
hub's decision ids (`scripts/lib/decision-ids.mjs`), deliberately: two schemes that
behave differently would be worse than either.

### Config items are installation qualifications

@jwildfire, 2026-08-15: *"the config items are pretty useless. They need to actually tell
me what i need to do in exact detail. they need to be an installation qualification."*

His term, and precise — an IQ is a protocol with exact steps, the result expected of each,
and a recorded pass/fail. The old items were not thin (most already carried a paste-ready
command); three other things were wrong, largest first:

1. **The page threw the fix away.** `collectConfig` read the headline and set `detail: ''`
   on purpose, and a config row was not clickable. The entries were better than the surface
   rendering them.
2. **No expected result, no verification.** Success and silent failure looked identical.
3. **No pass/fail record.** Checking the box was self-attestation.

So an entry now carries `Why it matters` / `Do` / `Expect` / `Verify` / `Source`, plus optional
`Blocks` and `Why` (last — an item that opens with the mechanism was written agent-to-agent).
All four of the first are **required and enforced at capture** by [`tools/blocker-log`](../blocker-log),
not patched up here: a tool that accepts a free-text one-liner gets fed free-text one-liners
forever.

Clicking a config row opens the item's own HTML card — the page `/config/<id>` already
serves — in the main area, the same treatment a decision artifact gets. @jwildfire,
2026-08-20: *"show the html artifacts by default - just like the decisions."* The main pane
used to rebuild the same item as a form and offer the card as a link into a new tab; that
was a second version of one item that could disagree with the first. What could not move
into a static card is the check, because only this server can run a command and write the
result down, so it lives in the sidebar beside the triage buttons.

`Why it matters` leads, on the entry and on the card (@jwildfire, 2026-08-20: *"I need the
config summarys to start with the 'why'. Why is this important? What problem does it fix?"*).
Note what it is **not**: it is not `Why`. Promoting the mechanism would satisfy the letter of
that sentence and produce exactly the agent-to-agent opening `Why` is kept last to prevent.
It is the *stakes* — which is what `Unblocks` already meant, so this is that field renamed and
promoted rather than a second one beside it; `Unblocks:` is still read as an alias so no
existing entry stops parsing, and the card's old "Buys you" strip item was dropped because it
was the same fact written twice, in the copy that could drift.

It is checked, not merely required. A line opening with a command, a path, a flag, a bare
mechanism (*"the classifier …"*), or a *"because …"*, or too short to be a sentence, is refused
with **every** reason at once — one at a time turns a rewrite into a guessing game. What the
bar cannot catch is a grammatical sentence that says nothing; a pass is not a compliment. Use
`blocker-log --set-matters cNNNN --text '…'` to write or replace one on an existing entry —
journaled and under the same lock, because a hand edit moves the digest the ledger watches.

**The verify contract: the command must exit 0 exactly when the item is done.** `Check` runs
it and appends a real result to `.claude/ops/checks.jsonl`. Only single, read-only commands
run unattended (`lib/iq.mjs`, `AUTO_VERIFY_HEADS`) — a write dressed as a read (`gh api -X
DELETE`), anything that can chain or redirect, and anything that could run arbitrary code
degrade to copy-and-run with the reason on the button. That is not a limitation to apologise
for: several of these steps are web-UI-only or device-side and *cannot* be scripted, and the
page has to say so rather than pretend. Say `→ prints 2` or `→ not <string>` when the exit
code alone is not the whole question; a stated output outranks the exit code, because
`grep -c x file` prints `0` and exits 1 when "none" is the right answer.

### Delete and snooze, on anything in the list

@jwildfire, 2026-08-15: *"i also want to just be able to delete/snooze anything in the list."*
Anything — release candidates and decisions too, not only config items (`lib/triage.mjs`).

- **A snooze must have a wake.** One with no way back is a silent delete wearing a friendlier
  word, so a snooze with neither a date nor a change-watch is refused by the module *and* the
  route. Every snooze offered on the page carries both: a day / a week / until it changes, and
  all three watch a content fingerprint, so an item that moves under the snooze returns on its
  own. Snoozed rows stay on the page, collapsed, with the wake written on them.
- **Nothing is deleted.** His click on Dismiss *is* the approval the workspace rules require —
  but the config list's own convention is retire-with-strikethrough, and that convention wins:
  **a dashboard click never edits `.claude/blockers.md`.** It appends to an append-only ledger
  (`.claude/ops/triage.jsonl`) the queue filters on. Dismissals are recoverable by construction
  and `blocker-log --retire` stays the one writer that moves an entry to `## Resolved`.
- **Dismiss says what it actually does**, per kind: for a release candidate, *"hides it here;
  the pull request stays open on GitHub."* Conflating "off my list" with "gone" would hide real
  work.

### The critical tag, and why it is hard to claim

@jwildfire, 2026-08-15: *"maybe use a 'critical' tag. but use it sparingly. I'm going to be
annoyed if you tell me something is critical when it isn't."* That is a trust contract, so
the bar is mechanical (`lib/rank.mjs`):

- **No boolean an agent can write.** Two routes in, both measured by something other than the
  thing asking for attention: a `Blocks:` reference that GitHub confirmed **open** at capture
  time (`blocker-log` asks; no `gh`, or a closed or missing reference, means no stamp and no
  tag), or a computed condition on the item (`item.computed`) such as the answer pipeline's
  OVERDUE — an answer of his recorded and unapplied past the hour, which is that seam's
  first and so far only producer. Self-declared urgency has nowhere to go.
- **The claim is displayed** — the row reads `critical · blocks obot.roadmap#182`, so a weak
  claim is obvious at a glance. That is the check no rule can perform for him.
- **Budgeted at three.** Sparingly is enforced. A fourth claim is neither shown as critical nor
  hidden: it keeps its sentence, sorts to the top of its own section, and the page says how many
  are over budget.
- **Cross-section, above everything.** The three sections keep his order; the pin sits above all
  of them, which is what "true blockers first" asks for and matches a blocking config item
  outranking a routine RC. **What it costs:** the clean one-to-one mapping between the three
  sections and the three worker outcomes — an agent reading Config no longer sees every config
  item there. Mitigated by moving rather than duplicating (a row twice in a phone list is a bug),
  by the section header saying how many moved, and by `/queue.json` keeping the unpinned grouping.

Today only config items can earn route 1, because only the config list carries `Blocks:`. Route
2 is open to any kind the moment a collector attaches `computed`.

## Why local, and why the page holds no credential

The hub is a static, public site. A published page cannot write anywhere by itself,
so every "approve in the doc" scheme is really a scheme about where the click's write
goes — and because the page is public, whatever receives that write must also prove
the click came from him. That is an authentication product, not a button, and it
would put an approval-forgery surface on the internet to save one chat message. A
click on a page served from 127.0.0.1 is his by construction.

The dashboard still does not hold a write credential. An answer is written to the
local ops store, and an agent applies it to the artifact's Decisions section, the
decision log and the index. Anything able to write to the hub on his behalf holds
real capability; a browser page that also renders artifact content is the wrong place
to keep it.

## The Wire, and the one break in the symmetry

The what-changed feed used to live two clicks down, inside the Agents tab's full record. It
is the same entity the public hub calls the Wire, so it now sits in the same slot under the
same name (#203) — and it is the one surface that can answer the harder half of the question.

This server sees every request, so it reads the real per-surface visit record (#205) and
answers **what changed since you last looked**. The hub is static and records nothing per
visitor, and per-visitor tracking has no place on a public page, so it answers **what changed
recently** against a fixed 7-day window. Both pages say so and each names the other.

Degrading honestly is inherited whole from #205: no prior visit renders "first look", an
unreadable record says so, and an event with no timestamp counts as *old* — undercounting
tells him to look, overcounting tells him not to, and only the second can hide something.

## Config counts reach the hub; config text never does

`obot.agent/tools/config-count` writes `<hub>/data/config-count.json`: two integers and a
date, nothing else. It is a separate tool rather than a line in this page on purpose — the
code that may see config text and the code that may cross the boundary should not be the same
code. It asserts its own payload shape before writing, and refuses to write at all when the
list cannot be read, because a count that cannot be measured is not zero.

The hub validates it again on arrival and refuses the whole payload on any field that is not
a number or a date. That reader is the half that survives someone editing this one.

```bash
obot.agent/tools/config-count             # write it
obot.agent/tools/config-count --dry-run   # print it, write nothing
obot.agent/tools/config-count --check     # exit 1 if the published count has drifted
```

## Premise readings reach the hub; the sweep's own words never do

`obot.agent/tools/premise-status` writes `<hub>/data/premise-status.json`: one row per
decision-artifact premise carrying its id, a twelve-hex fingerprint of the proof that ran,
one of three states, when it was measured, and — only for an `unknown` — which of three
kinds of not-knowing it was. Nothing else, and nothing in prose.

It is the other half of [jwildfire/obot.roadmap#266](https://github.com/jwildfire/obot.roadmap/issues/266).
The sweep has re-checked these premises every five minutes since #262 and reported an expiry
on the Navigator surface; the artifact page itself said nothing, so a reader met an argument
built on a premise that might have expired with no sign anything had ever looked. The hub
renders a strip above every artifact's masthead from these readings; this gets them there.

The premise *sentences* a reader sees are the page's own `<meta name="premise">` content —
written in the hub repository, already public — so this channel never has to carry prose in
order to render prose. That is what lets the hub's reader refuse every payload that is not a
number, a date, hex, or a member of a closed set.

The sweep runs it every pass and never commits: what is committed is what the pages get, so
the Navigator surface reports the gap between the two rather than closing it unattended.

```bash
obot.agent/tools/premise-status             # write it
obot.agent/tools/premise-status --dry-run   # print it, write nothing
obot.agent/tools/premise-status --check     # exit 1 if the published readings have drifted
```

## How the page is dressed

The palette, the type and the document components come from the repository's shared
stylesheet, [`assets/obot.css`](../../assets/obot.css) — the decision artifacts' visual
language, extracted once (jwildfire/obot.agent#15) and inlined by every view this server
renders. @jwildfire, 2026-08-20: *"match the css of the decision docs."* Two surfaces that
he moves between all evening now read as one product, and the dashboard gained the dark
theme the artifacts never had.

What stayed here is this page's layout, which the shared sheet deliberately does not carry,
and an alias block at the top of `SHELL_CSS` pointing the dashboard's own token names
(`--card`, `--accent`, `--crit`, …) at the sheet's. The aliases are a bridge, not a second
palette: each resolves to a token defined once, so the theme follows. Roles decide the
mapping — accent is the link blue, config is bronze, critical is the flag red, settled is
green. See [`docs/shared-stylesheet.md`](../../docs/shared-stylesheet.md).

## A config item as a card

`/config/<id>` renders one item as a short page: an executive summary, then why it exists,
then step by step. His order, and his ask — [obot.roadmap#263](https://github.com/jwildfire/obot.roadmap/issues/263),
2026-08-18: *"The config format isn't working for me. Let's make local-only (relatively
short) html artifacts for each item."*

That is the third format in three days, so the reason is written down rather than fixed a
fourth time. He reads on a phone to decide whether it is worth going to a keyboard, then
works at the keyboard with the item open — two documents, and we kept shipping one. The
summary is built as the phone document: it answers what this is, whether to do it now, how
long it takes and what it buys, and it holds no forward reference to a step, because the
steps may be off-screen when it is read. Everything below it is the keyboard document.

The five field names are gone. The two properties that made them worth having are not: every
step carries what he should see, and the page closes with a check that answers pass or fail.
A card that drops either to look cleaner has re-made the mistake of the 16th in the other
direction.

```bash
obot.agent/tools/config-card                 # every open item
obot.agent/tools/config-card c0016 c0017     # named items
obot.agent/tools/config-card c0016 --stdout  # print the page, write nothing
obot.agent/tools/config-card c0016 --summary # the phone document, as plain text
obot.agent/tools/config-card --list          # ids, titles, and which have prose
```

**Two sources.** The spine — title, dates, criticality, what it blocks, the verify command —
is read from `.claude/blockers.md` on every render and never copied, so a card cannot drift
from the list about anything measurable. The prose is `<store>/config-cards/cNNNN.md`. An
item with no prose still renders: it shows the list entry and says plainly that nobody has
written a card for it, which keeps every open item reachable at the same address.

`--summary` exists because loopback is not reachable from a phone. The dashboard is the
keyboard lane; the fold and the push relay are the phone lane, and they can now carry the
summary verbatim instead of paraphrasing a page nobody on that end can open.

**Why this cannot leak.** Config item text has never reached a public surface — that is why
the list lives outside git, and it predates this format. Here it is structural: `writeCard`
is the only writer in the program, it computes its destination from a four-digit id rather
than accepting a path, it refuses a destination outside the store, it refuses a store with a
`.git` anywhere above it, and it refuses content that is not sentinel-stamped — the stamp the
hub deploy greps for and fails on. The server has no card writer at all; it renders on the
request and writes nothing. Each refusal has a test in `test/config-card.test.mjs`.

## The currency of a claim — one mechanism, two artifact classes

Requirements [obot.roadmap#264](https://github.com/jwildfire/obot.roadmap/issues/264) and
[#266](https://github.com/jwildfire/obot.roadmap/issues/266), built as one under
[obot.agent#262](https://github.com/jwildfire/obot.agent/issues/262). Core in
`tools/lib/claims.mjs`; the two readers and the section in `tools/navigator/currency.mjs`.

Two artifact classes state claims and neither re-checked them. Config items carry a verify
command, the dashboard runs one on a click, and nothing ran them on their own — three of
the last six items left the list for being stale or mis-specified rather than for being
done. Decision artifacts state a premise in prose, and D0021 said a release was held
pending the decision when it had published sixteen minutes earlier. Same defect, one
artifact class apart, which is why #266 asked for one mechanism by name.

A **claim** is a sentence and a proof:

```
<what is claimed> | <read-only command> → <what its output should say>
```

The right-hand half is the config list's own `Verify:` grammar, unchanged. A decision
artifact declares one per line in its head, beside the description the contract already
requires — the form is one line because a premise that costs a section or a schema does not
get written:

```html
<meta name="premise" content="v1.1.0 is published, not a draft | gh release view v1.1.0 -R jwildfire/gsm.safety --json isDraft --jq .isDraft → prints false">
```

**Three states, never two.** `holds` / `does not hold` / `unknown`. The classes read them
differently — a config claim that holds is done and leaves his queue; a premise that holds
still frames its question correctly — but `unknown` means the same thing in both, and it is
the state the whole capability turns on:

- A command the allowlist will not run is unknown with a reason, never a fail.
- A command that never produced an exit status — not installed, killed by the timeout — is
  unknown. This was live in the old `runVerify`, which coerced a spawn failure to
  `exitCode: 1` and judged it, so an item nothing could check read as an item waiting on him.
- A `prints X` claim whose command exited non-zero and either printed nothing or reported an
  error is unknown: there was no answer to compare. Found by 👯🤖 W0071's missing-file
  control. Deliberately narrow — `grep -c x file` prints `0` and exits 1 when the answer is
  "none, which is what we wanted", and two live items depend on that reading as a pass.
- A reading of a *different* command is not this claim's reading. A reworded verify starts
  again rather than inheriting its predecessor's verdict.

**Read-only, and a shell is never involved.** The allowlist is the same fail-closed one the
click-to-run button used. A shell metacharacter *outside quotes* means the author wrote for
a shell and the claim is refused rather than reinterpreted — `grep -q x f > /dev/null` run
through `execFile` passes `>` and `/dev/null` to grep and answers a different question,
silently. Inside quotes it is a character in an argument and passes through untouched, which
is what lets a proof do its own work: `gh api … --jq '.content | @base64d | test("x")'` is
one command with three jq pipes and no shell at all.

**On the sweep, and at publish time.** They fail differently and neither substitutes.

```bash
tools/navigator/currency.mjs                        # the pass, as the sweep runs it
tools/navigator/currency.mjs --artifact <slug>     # one artifact, exits 1 if a premise does not hold
```

Cadence catches the world moving under a page that was right when written — and the config
half, where nothing else ever will. Publish-time catches a page born wrong, which cadence
can only report forever with no path to green: the first draft of D0021's premise was the
corrected-away claim, and a five-minute check on it would have been a permanent alarm. What
actually closes the window is not the evaluation, though — the premise that expired was
never in a field to evaluate. It is that **declaring** a premise forces the author to state
it as a command, so a belief becomes a measurement at the moment of writing. The gate is
worth having; the declaration is the part doing the work.

**A premise is asserted in five places.** Measured by W0071 on D0021: the page, the
artifact's README, the published index row, `registry.json`, and the discussion title — all
five stated it and none of them were true. So a broken premise's finding names every one of
them, and reads when each of the three that are files was last modified, flagging any older
than the moment the premise broke. The discussion title is named without a reading, and says
so: refusing to claim a check nobody ran is what makes the other three believable. A
declaration that cannot be parsed at all is counted and reported rather than vanishing,
because a premise nobody can read looks exactly like a page with nothing wrong.

**What it never does.** It never writes to `.claude/blockers.md` — an item its own check
proves done leaves the queue as a view, and the line naming it is there so nothing can
vanish silently. It never closes anything on GitHub. And it never prints config item text:
ids and counts reach the sweep file and the page, as everywhere else. Premise sentences do
reach it, because they are already published on the artifact's own public page.

## The hub's code runs in its own process

This page runs the hub's own decision collector rather than a copy of it, so the page and the
published site cannot disagree about what "open" means. It runs it **out of process**, and that
is not a performance choice.

The hub is a public build. To satisfy [obot.roadmap#203](https://github.com/jwildfire/obot.roadmap/issues/203)
— the config list must be structurally unable to reach a published surface — its generators
import `scripts/lib/local-only-guard.mjs`, which on import replaces the content-reading surface
of `node:fs`, `node:fs/promises` and `node:child_process` for the whole process and refuses any
read outside the hub repo. That guard is right, and it stays exactly as it is.

It is also a monkey-patch on a module singleton, so it has no idea who imported it. When this
server imported the hub's collector in-process, the guard arrived down the import graph and
disarmed the dashboard: ten open config items and a three-minute-old Navigator sweep, both on
disk, both refused with `ELOCALONLY`, and both reported to him as ordinary emptiness. It hid
because the guard deliberately leaves `existsSync`/`stat` alone (every existence check still
said yes) and leaves writes alone (the server kept writing its caches while unable to read its
inputs). See [#206](https://github.com/jwildfire/obot.agent/issues/206).

**The rule: no module under this tool imports anything from the hub.** `lib/hub-collect.mjs` is
the only file that may name a hub module path, and it only ever hands it to a child process
(~35ms, including node's own start-up). `test/hub-isolation.test.mjs` asserts the effect rather
than the wiring — a stand-in hub that arms a guard on import must not be able to stop the config
list being read a line later — and a second case fails on any dynamic import appearing in this
tool at all.

## A read that failed is not a source that is empty

`lib/absent.mjs` holds both halves of the honesty rule. The first is the older one: a surface may
print a figure only when it read the file the figure comes from. The second is `readFailure`, and
it exists because the first is not enough — a page can read nothing, admit it, and still describe
the failure in the words of an absence.

`ENOENT` is the only thing that means "not there". Every other failure keeps its errno and renders
as a fault: in colour, not in a hover title, because he reads this page on a phone. The sentence
says the list is *unread* rather than *empty*, and it withholds the first-morning remedy — telling
him to capture his first config item is actively misleading when ten of them are sitting in a file
this process could not open.

## One site, several tabs

@jwildfire, 2026-08-15: *"I want the ops db and orginal ops hub to be merged. just make
them 2 different tabs on the same (local) site for now. new ops db should be default
view."*

So this server is the site — three tabs now (he added the Navigator an hour later: "I
think i almost certainly want a navigator tab in the ops db"). The strip is a list in
`lib/render.mjs` (`TABS`); a fourth tab is one entry and one route.

It serves the dashboard at `/`, the agent roster and the session hub's live view at
`/live.html` inside a shell that carries the same header. The live view is an **iframe**,
not an injection, because it is generated by a different tool on its own watch loop and
wrapping it costs neither generator a line of layout (the news feed included). One port:
**7326**, the dashboard's.

The status line finds it the way it always has. On start-up this server writes
`<workspace>/.claude/session-hub/serve.json` — the same `{port, pid, url}` marker
session-hub's own `--serve` writes — pointing at `/live.html` here. Which means the
watch loop should now run **without** `--serve`:

```bash
node obot.agent/tools/session-hub/session-hub.mjs --watch   # renders live.html; no server
```

### A second instance cannot take the marker

Two servers both writing that marker was the one way to confuse the status line, and it
happened five times on 2026-08-16 — every time an agent running a test server while
changing this dashboard, which is exactly what it should be doing
([#142](https://github.com/jwildfire/obot.agent/issues/142)). So the marker is now a claim
that a second instance declines, rather than one it takes:

```bash
node obot.agent/tools/ops-dashboard/ops-dashboard.mjs --serve --port 7399
# ops-dashboard: not claiming the serve marker — an explicit --port (7399) names a
#                test server, not the machine dashboard
# ops-dashboard: http://127.0.0.1:7399/
```

Test freely: a non-default `--port` serves the whole site and touches nothing the status
line reads. The rules, and why each one removes a failure rather than detecting it, are in
[`lib/serve-marker.mjs`](lib/serve-marker.mjs). Ask [`tools/serve-marker`](../serve-marker)
what the marker says — it answers `none` / `unreadable` / `stale` / `live`, and hands back
a URL only for `live`, because a marker left behind by a killed server looks exactly like
a healthy one.

## The Navigator tab

`/navigator` renders `<workspace>/.claude/session-hub/navigator-state.md` — the RC queue
and event log the [Navigator sweep](../navigator/) writes every five minutes, read fresh
on every request.

Two things it is careful about:

- **A dead observer says so.** The state file's own rule is that a `swept:` stamp older
  than three cadences means the sweep is not running; the tab then leads with a banner
  and the restart command, and never presents what follows as current. A surface he
  would trust to tell him a review landed is the worst place to render stale data
  quietly.
- **Every `##` section renders, including ones this code has never seen.** That seam is
  what the agent roster below is built on: it is markdown, parsed by `lib/navigator.mjs`
  and rendered by the same list, so no table code exists anywhere for it. An indented
  bullet is the detail of the row above it and renders as a disclosure, which is what
  lets one row carry a summary and the evidence behind it.

## The Agents table

`/live.html` is a table with a filter sidebar: one row per agent, carrying the id, the
status, the cost, the closeout verdict, the roadmap impact and the day it was last
active. @jwildfire described this view three times, each more concretely, and the third
is the specification (2026-08-17): *"I want the db session manager view to be a table
with a sidebar with filters. Each row is an agent. It should share a data feed as the
price analytics page."* Requirement
[roadmap #227](https://github.com/jwildfire/obot.roadmap/issues/227), task
[#154](https://github.com/jwildfire/obot.agent/issues/154). The escalating concreteness
was the finding: each earlier build improved on the ask instead of meeting it, so this
one is literal and the pieces of the previous one moved to `/session/log` rather than
sitting above the table he asked for.

**The filters** are `lib/roster-table.mjs`: status, produced, active period, repo
touched, closeout verdict, kind. Within a group the boxes are OR; across groups they are
AND. The counts beside each option are over the whole roster rather than the current
selection — a count that changes as you tick boxes cannot tell you what ticking the next
one would give you, which is the only reason to print it. An option is offered only when
something has it: a box that can never match teaches the reader that the filter is
decorative, and after that an empty result is indistinguishable from a broken one.

**At 390px** the sidebar is the same `<details>` element it is on a desktop — open
beside the table there, collapsed to one summary bar above it on a phone, with the live
count (`12 of 38 · $80.22`) already on the bar so it is worth reading closed. That is a
decision rather than a reflow: a media query that drops a sidebar under the content puts
a screenful of checkboxes between him and the table. The table stays a table and scrolls
sideways inside its own box, with the agent column pinned so a row never loses its name
mid-swipe.

**Sorting** is on every column header. First click gives the end of the column he came
for — biggest number, most recent day, top of the alphabet — and the pre-ledger bucket
sorts last by default whatever it cost, because it is 147 agents added together rather
than an agent. A sort orders each band on its own: pinned rows never scatter back into
the table because a column was clicked.

**Pinning** (`lib/pins.mjs`, task
[#169](https://github.com/jwildfire/obot.agent/issues/169)) puts a band at the top of
the table — *"also let me pin agents. pin prime, nav and fleet manager (fleet for short)
by default"* (@jwildfire, 2026-08-17; renamed the same evening — the fleet manager is
the admiral, and `short` is `admiral` rather than `fleet`). Every row
carries the control, and four rules make it a pin rather than a decoration:

- **The default is derived, not listed.** The pinned-by-default set is *every standing
  role*, read off `STANDING_ROLES` in `lib/roster-view.mjs` — the same registry that
  decides what a row's kind is. Nothing in `pins.mjs` names prime, the Navigator or the
  admiral. Declaring a fourth standing role is one line in that registry and it
  arrives pinned; a worker that has run for a month and spent the most money still
  cannot drift into the band, because it is not a role.
- **A pinned row is never dropped.** The scope rules and the cap on deaths both consult
  the pins, so a pinned role that died is still in the table showing that it died. A pin
  that drops its subject on death is worse than no pin, because the absence reads as
  health. When a filter he ticked hides one, the band says so rather than looking
  complete.
- **A pinned role with no session still gets a row**, reading `not running` with the
  reason. The admiral is short-lived by design ([#167](https://github.com/jwildfire/obot.agent/issues/167)):
  absent is its ordinary state, and an empty slot cannot say whether it is resting or
  broken.
- **Pins are his preference state**, kept in `.claude/ops/pins.json` with the store's
  sentinel and never published — the same rule as the config list. Only overrides are
  stored, keyed by role for a standing session and by worker id for a worker, so a pin
  survives a restart or a rename; unpinning a default sticks instead of reverting on the
  next render, and clearing an override is a third state that goes back to following the
  role.

The model is `lib/roster.mjs`, unchanged and assembled fresh on every request, from four
files and nothing else:

| Column | Source |
|---|---|
| Identifier | `.claude/workers.journal` — the ledger, forward-only from 2026-08-16 |
| Status | `~/.claude/jobs/<id>/state.json` joined to `timeline.jsonl` |
| Cost | `<hub>/site/usage/usage.json`, priced by the hub's `build_usage_data.py` |
| Impact | `.claude/session-hub/delivery.md` — the Navigator's verdicts |

Four things it refuses to do, each of which was a real defect once:

- **It does not believe a job's own `state`.** One worker died on 2026-08-15 with `done`
  in its state file and a normal-looking completion note; the only surviving evidence is
  the append-only timeline, whose last entry is still `working`. Status is a join of the
  two, and a disagreement between them reads as death. `blocked` is role-aware: for a
  background worker it is where the worker stopped, for a standing session it is the
  ordinary wait. A `working` session that has said nothing for an hour is not "running".
- **It does not read impact from the job records' `children` list.** That list is empty
  for nearly half of measured jobs, including one that merged three pull requests and
  filed two issues. Impact comes from the delivery record, in three buckets in this
  order — requirements whose stage moved, issues and pull requests closed or merged,
  references that moved nothing — and every reference renders as a link, so any row can
  be checked in one click. An agent with none of the three renders `none`, never a blank.
- **It never renders a cost of zero for an unread file.** A missing artifact says
  `cost unavailable`; one older than a day says so on its face; an agent that started
  after the last pricing run says `not yet priced`. A zero and an unread file look
  identical, and the second one is a lie. The arithmetic stays in the hub's script:
  one priced source, one place to change a rate. Refresh it with
  `python3 obot.roadmap/scripts/build_usage_data.py`.
- **It never hides what it cannot name.** Agents from before the ledger are one
  collapsed row carrying their total, never omitted and never folded into a named row.
  Named rows and that row reconcile to the artifact's own total, which is a test.

The row is the agent, not the session: sessions are a count on the row and subagents
(`W0042.1`) roll into their parent, since impact is judged per worker. Two disclosures
are printed on the page rather than left to be discovered — that the figures are list
price rather than a bill, and that ids are forward-only from 2026-08-16.

**The shared feed is the point, and it is met by not touching it.** The requirement's
load-bearing line is that this page and the hub's analytics page price from the same
artifact. They do: the table's unfiltered total reads the same figure as `usage.json`'s
own `totals.cost`, to the cent, because nothing here computes a price. Two cost numbers
that disagree is the registry-versus-index failure again, and this time about money.

## What happens when he answers a decision

The evening of 2026-08-15 is why this section exists. He answered a decision at 22:22
and asked twice whether it had landed; it had not, and nothing in the system knew.
Three files existed for that one decision, 19 seconds apart, each with `decisionId:
null` and `status: "staged"` — a state with no consumer. [#120](https://github.com/jwildfire/obot.agent/issues/120)
replaced all of it with a pipeline that says who has his answer:

| state | meaning | who moves it on |
|---|---|---|
| `captured` | he clicked; it is on this machine and nothing has seen it | the Navigator |
| `delivered` | announced in `navigator-state.md` and the scratchpad; an agent has it | the agent that applies it |
| `applied` | the artifact, the log and the index were updated — with an evidence link | — |
| `superseded` | he answered again; the record is kept, never deleted | — |

- **A repeat click is the same answer.** Same artifact, same verdict, same words, same
  per-question calls: the record already on disk gets a `clicks` count, not a sibling.
  A *different* answer writes a new record naming what it supersedes, and the older one
  is stamped rather than removed — a changed mind is a fact worth keeping, and which
  answer is his *now* has to be readable from the data, not inferred from mtimes.
- **The `D####` id is joined at capture time** from the hub's
  `reports/decisions/registry.json`, and per-question answers are keyed by sub-id
  (`D0003.1`) with the code he reads (`S1`). A slug the registry does not know records
  the lookup failure on the record instead of writing a silent `null`.
- **The deliverer is the [Navigator sweep](../navigator/)** — launchd, every five
  minutes, session-independent. It is the only observer that runs when no session does,
  which is exactly the condition under which the original hand-off failed.
- **When nothing is listening, the page says so.** If an answer is `captured` and the
  sweep is not running, the sidebar leads with it and carries the restart command. A
  hand-off with no consumer must never render as success — the same failure class as a
  green CI run over a stale evidence baseline.

Agents read the queue with one bounded command (`prime-rehydrate` bundles it):

```bash
obot.agent/tools/ops-answers pending          # what he decided that nobody applied
obot.agent/tools/ops-answers pending --json   # same, machine-readable
obot.agent/tools/ops-answers apply <id> --evidence <url> --by "a sibling"
```

An answer unapplied for more than an hour is marked `OVERDUE` in the Navigator's
section, on the page, and in the CLI. `pending --exit-code` exits 1 when anything is
pending and 2 when anything is overdue, so a wrapper can act on it.

### When one goes unapplied (jwildfire/obot.roadmap#241)

On 2026-08-16 he answered three decisions, all three were announced inside six minutes,
and none reached an artifact for nine hours. The detection was never what failed: the
sweep recomputed `3 answers pending` 105 consecutive times and wrote it to a file that
nothing was obliged to read. Four things were silent, and all four were mechanisms that
already existed:

- the wake channel had no answer detection and read job records only;
- `**OVERDUE**` is not in `ALARM_RE`'s vocabulary — and a `- ` bullet is never
  alarm-tested by `lib/navigator.mjs` anyway, so the row could not have gone red even
  with the right word in it;
- `item.computed`, the critical pin's own documented route for exactly this case, had
  no producer;
- and the panel alarm counted `captured` only, so an answer picked up and then dropped
  — which is precisely what happened — could never reach it.

Past the bar the same finding now takes four routes at once. `unappliedDetections` in
`lib/answers.mjs` is the one producer:

- **the wake channel**, on its own per-run budget and on a 60-minute floor rather than
  once-only — a completion is an event, an unapplied answer is a condition that stays
  true until somebody acts. Navigator-only: applying an answer is an agent's job and
  this channel has no path to him.
- **the sweep's answers section**, as an unindented verdict line reading
  `**ANSWER DELIVERY GAP**` — unindented because that is the branch the Navigator tab
  actually alarm-tests, and that vocabulary because it is what `ALARM_RE` matches.
- **the critical pin**, so the decision moves to the top of his queue reading
  `critical · answered, not applied — you decided this 8h50 ago…`.
- **the answers panel**, which now alarms on recorded-and-unapplied rather than on
  never-picked-up, and whose row stops promising `the artifact updates next` once that
  promise is an hour old.

Two conditions, because they have different remedies and the old clock could not tell
them apart: `unclaimed` measures from his click and means the sweep never announced it,
`dropped` measures from the announcement and means an agent was told and did nothing.
None of these lines ever carries his prose — they reach the scratchpad, and a scratchpad
can end up published.

**Not automated on purpose:** nothing launches an agent by itself. The sweep announces;
a session applies. Closing that last gap unattended means letting a scheduled job start
an agent, which is @jwildfire's call to make, not a code detail — until he makes it, an
unapplied answer ages loudly rather than silently.

## The ops store

`<workspace>/.claude/ops/` — local only, never committed, never published.

- `answers/` — one file per answer. The **content** of an answer (his verdict, his
  words, his per-question calls) is written once and never edited; only status, history
  and supersede pointers move. So "what did he say, and when" survives an agent that
  applies it badly.
- `cache/` — GitHub sweeps.
- `pins.json` — which agents he has pinned on the Agents tab, as overrides only: the
  defaults follow the standing-role registry, so this file holds nothing but the places
  he has disagreed with them.
- `last-seen.json` — when he last opened each page. See below.
- Every file opens with the same local-only sentinel the hub's deploy greps for, so
  if one ever reaches an assembled site the build fails instead of publishing it.

The workspace's `.claude/` is not a git repository, so the containment does not depend
on a gitignore rule being right — the same reasoning that settled where the blockers
list lives.

## When you last looked

Every surface built for his absence wants to answer *what changed since I last looked*,
and nothing recorded when he last looked. The tempting substitutes — the last deploy, the
newest changelog entry, a fixed 24 hours relabelled — are all worse than no signal, because
a confidently wrong window actively tells him not to look.

So both servers record one thing where a page is handed over: the last time each surface was
opened, in `last-seen.json`. One timestamp per surface. No user agent, no referrer, no
history — the narrowest record that answers the question is the whole design, and this is
behavioural data about him, under the same rule as the config list.

The hard part is not writing the timestamp, it is refusing to write it. The rule was
measured against a real Chrome on 127.0.0.1 rather than assumed (2026-08-16):

| what happened | Sec-Fetch-Dest | Sec-Fetch-Mode | Cache-Control | counts? |
| --- | --- | --- | --- | --- |
| opened the page | `document` | `navigate` | — | yes |
| clicked a tab | `document` | `navigate` | — | yes |
| the page's own meta refresh | `document` | `navigate` | `max-age=0` | no |
| an iframe loaded | `iframe` | `navigate` | — | no |
| a `fetch()` poll | `empty` | `cors` | — | no |
| the favicon | `image` | `no-cors` | — | no |
| curl, a watcher, a health check | *(none sent)* | *(none)* | — | no |

Two readings of that table matter. A non-browser client sends no `Sec-Fetch-*` headers at
all, so requiring them excludes every poll by construction rather than by heuristic. And a
page refreshing itself is header-identical to a person opening it except for `max-age=0` —
which a manual reload also sends, so both are excluded and a reload does not count as a
fresh look. That is deliberate: the error is one-directional. An undercounted look shows him
a longer window and tells him to look again; an overcounted one tells him not to bother, and
only the second kind can hide something. `_r=auto` on the query is the deterministic escape
hatch for any page we control that reloads itself.

This mattered immediately: the session tab embeds the live view, which refreshes itself every
sixty seconds. Under a naive rule a tab left open would mark itself as seen forever with
nobody in the room — the signal destroyed by the only thing watching it. Verified live rather
than argued: the tab was left open for eighty seconds, its frame re-requested itself once,
and the recorded timestamp did not move.

Degradation is the requirement, not a nicety:

- No record renders `first look` — never *nothing changed*.
- A record that cannot be parsed, a stamp that is not a time, or a clock that moved
  backwards renders `last opened: unknown`, with the reason in the tooltip.
- Nothing plausible is ever substituted for something unknown.

The header consumes it (`local only · 10:03 · last opened 5h ago`), which is what keeps it
honest: a record nobody reads rots quietly. Do not build *what changed since* on top of this
here — that belongs to whichever surface wants it. ([roadmap #205](https://github.com/jwildfire/obot.roadmap/issues/205), [#143](https://github.com/jwildfire/obot.agent/issues/143))

## Not in this version

- Reviewing a release candidate inside the dashboard (it links out).
- Anything reachable from his phone.
- The apply step itself. The dashboard records and hands over; an agent still writes the
  artifact's Decisions section, the log and the index, then stamps the answer `applied`.
- An agent that starts itself. The Navigator delivers within five minutes whether or not
  a session is running, but nothing launches the session that applies.
- Notification. How pending work reaches him when he is *not* looking at this page is
  the daily-briefing design, not this.

## Tests

```bash
node --test obot.agent/tools/ops-dashboard/test/*.test.mjs
```
