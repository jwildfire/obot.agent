# ops-dashboard — the Operations Dashboard

@jwildfire's **local** page: his todo list — release candidates, decisions, config —
and the place he answers decision artifacts instead of reading them on the public site
and typing the answer somewhere else. It is also the site's default view: the session
hub lives on the second tab of the same server.

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

| Route | View |
|---|---|
| `/` | the Operations Dashboard — the default view |
| `/live.html`, `/session` | the session hub, under the same header |
| `/session/frame` | the session hub's own render, served unchanged |
| `/navigator` | what the 🧭🤖 Navigator sweep has seen |
| `/artifact/<slug>/` | a decision artifact from the hub clone |

| Option | Meaning |
|---|---|
| `--serve` | run the loopback server (without it, one render to stdout) |
| `--port <n>` | port, default 7326; rolls forward if taken |
| `--workspace <dir>` | workspace root (default: cwd) |
| `--hub <dir>` | obot.roadmap clone (default: `<workspace>/obot.roadmap`) |
| `--open` | print the URL once the server is up |

## What it shows

One queue, three sources:

- **Release candidates** — from the sweep `scripts/reviews-queue` already does, cached
  in the ops store so the page opens instantly and works offline. Clicking one opens
  the pull request on GitHub; release candidates are reviewed there.
- **Decisions** — every open decision artifact, read from the hub clone's own
  collector (`scripts/lib/collect/decision-log.mjs`) rather than the deployed
  `decisions.json`, so a decision recorded five minutes ago is already here.
- **Config** — the workspace list at `<workspace>/.claude/blockers.md` and nowhere
  else. **Headlines only**: an item's body describes exactly which control stopped an
  agent, and there is no reason to render that on a queue row.

In that order, his (2026-08-15): "RCs first. then decisions, then config items."


Clicking a decision opens the artifact in the main area and the answer controls in
the sidebar. **Adopt all is one click** — it is repeatedly his complete answer, and
it must never be six.

### Release-candidate labels

A release candidate reads `package version — what it is` (`gsm.safety v1.1.0 — the
participant-level metrics phase`). That is the naming rule for RC PRs — it is in the
[RC framework](../../docs/rc-framework.md) — but the queue also carries PRs written
before it, so the label is *derived*: package from the repo, version from the title
when the title names this package's version, otherwise from the `(Upcoming)` heading of
the local clone's `NEWS.md`. It is idempotent, so a correctly-titled PR is not doubled,
and a version is never invented — with no evidence, the label is the package alone.

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

So an entry now carries `Do` / `Expect` / `Verify` / `Unblocks` / `Source`, plus optional
`Blocks` and `Why` (last — an item that opens with the mechanism was written agent-to-agent).
The first three are **required and enforced at capture** by [`tools/blocker-log`](../blocker-log),
not patched up here: a tool that accepts a free-text one-liner gets fed free-text one-liners
forever. Clicking a config row opens the whole thing in the main area with copy buttons.

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
  OVERDUE. Self-declared urgency has nowhere to go.
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

## One site, two tabs

@jwildfire, 2026-08-15: *"I want the ops db and orginal ops hub to be merged. just make
them 2 different tabs on the same (local) site for now. new ops db should be default
view."*

So this server is the site — three tabs now (he added the Navigator an hour later: "I
think i almost certainly want a navigator tab in the ops db"). The strip is a list in
`lib/render.mjs` (`TABS`); a fourth tab is one entry and one route.

It serves the dashboard at `/`, and the session hub's live
view at `/live.html` inside a shell that carries the same header — an **iframe**, not an
injection, because that view is generated by a different tool on its own watch loop and
wrapping it costs neither generator a line of layout (the news feed included). One port:
**7326**, the dashboard's.

The status line finds it the way it always has. On start-up this server writes
`<workspace>/.claude/session-hub/serve.json` — the same `{port, pid, url}` marker
session-hub's own `--serve` writes — pointing at `/live.html` here. Which means the
watch loop should now run **without** `--serve`:

```bash
node obot.agent/tools/session-hub/session-hub.mjs --watch   # renders live.html; no server
```

Two servers both writing that marker is the one way to confuse the status line, and the
loop no longer needs to serve anything.

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
- **Every `##` section renders, including ones this code has never seen.** That is the
  seam for the per-agent ledger he actually asked for ("a list of issues/PRs that were
  created/updated by each agent"). It is not built here because it is not derivable
  from GitHub — every agent-authored issue and PR is authored by `obotclaw[bot]`, so
  "which agent" needs a join against the scratchpad's per-sibling lines. When the sweep
  starts writing a `## By agent` section, this tab shows it unchanged.

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
node obot.agent/tools/ops-answers pending          # what he decided that nobody applied
node obot.agent/tools/ops-answers pending --json   # same, machine-readable
node obot.agent/tools/ops-answers apply <id> --evidence <url> --by "a sibling"
```

An answer unapplied for more than an hour is marked `OVERDUE` in the Navigator's
section, on the page, and in the CLI. `pending --exit-code` exits 1 when anything is
pending and 2 when anything is overdue, so a wrapper can act on it.

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
- Every file opens with the same local-only sentinel the hub's deploy greps for, so
  if one ever reaches an assembled site the build fails instead of publishing it.

The workspace's `.claude/` is not a git repository, so the containment does not depend
on a gitignore rule being right — the same reasoning that settled where the blockers
list lives.

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
