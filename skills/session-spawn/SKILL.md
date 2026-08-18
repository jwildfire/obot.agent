---
name: session-spawn
description: "Spawn a sibling background claude agent carrying a context briefing from the current session plus the session-framework contract: 👯🤖 identity, auto permission mode, deliberate model/effort choice, and the scratchpad heartbeat (log key events, close out before finishing). The briefing comes from templates/sibling-briefing.md and carries the report-back contract, the shelled-timestamp heartbeat, and the responsiveness contract siblings inherit. Use when @jwildfire says 'spawn an agent for X', '/session-spawn', or work should fork to a parallel background sibling. Do NOT use for in-conversation subagents (the Agent tool) or ultracode/Workflow jobs (⚡️🤖, tracked separately)."
argument-hint: "The task for the spawned agent"
---

# Session Spawn

Fork work to a background sibling without it falling out of the session
framework: the sibling gets a context briefing from the current session, the
workspace identity conventions, and the scratchpad heartbeat contract — so its
work stays visible to [`session-todo`](../session-todo/SKILL.md) all session and
foldable by [`session-wrapup`](../session-wrapup/SKILL.md) at close. Formerly
the `scaffold:spawn` plugin command; moved here 2026-07-14 when the heartbeat
made it session machinery rather than a general-purpose personal command.

Spawn is the delegation primitive of the
[responsiveness contract](../../docs/session-framework.md): anything that would
cost the lead more than ~30 seconds forks here.

## When to Use

- @jwildfire asks to spawn/fork a background agent for a task.
- The lead session identifies work worth parallelizing into a sibling (a build,
  a long investigation, an independent deliverable).
- Routine recon that would otherwise block a chat reply: a GitHub delta, an ideas
  sweep, a PR queue, a free-text investigation. The trigger is not "this is a big
  build", it is "**this would cost me more than ~30 seconds**".

The lane test is one line
([D0013](https://jwildfire.github.io/obot.roadmap/reports/decisions/2026-08-15-delegation-lanes/),
decided 2026-08-15): work whose **entire product is an answer** for the lead to
relay runs as a background subagent (the Agent tool — its result returns into
the lead's own context); work that **leaves anything behind** — a commit, an
artifact, a PR, or state that must outlive the spawning session — comes here.
When in doubt, spawn the sibling.

**Do not use** for in-conversation subagents (the Agent tool — results return to
this session, no heartbeat needed) or for ultracode/Workflow jobs (`⚡️🤖
{description}` — tracked separately, 2026-07-12).

**Subagents still get an id, and it is the parent's.** Claim it with
`worker-id claim --sub $WID --slug <what-it-does>`, which returns `W0042.1` — the hub's
`D0001.n` shape, for the same reason: it names something that belongs to a parent rather
than standing on its own. The parent worker is accountable for whatever the subagent
writes, which is also the rule
[obot.roadmap#184](https://github.com/jwildfire/obot.roadmap/issues/184) already settled.

**What degrades for subagents — state this rather than let it be discovered later:**

- **No harness job row.** No start or terminal timestamp of their own, so nothing can
  detect a subagent going terminal and the audit's unstamped-worker check cannot see them
  at all. The parent's close-out is the only coverage.
- **The name does not carry it.** `Agent` takes a `description`, not a `-n` name, so unlike
  a sibling — where the id rides the name for free — a sub-id has to be written into the
  prompt and the subagent has to be *told* to stamp it. That is an instruction, not a
  mechanism, and instructions hold less well.
- **Allocation is voluntary.** Nothing forces the claim. A subagent that writes without a
  sub-id is attributed to the bare parent id: lossy, but never wrong.

The cost is accepted because the degraded lane is the one barely used — measured zero
`Task` calls across all 134 transcripts in this workspace, since
[D0013](https://jwildfire.github.io/obot.roadmap/reports/decisions/2026-08-15-delegation-lanes/)
sends anything that leaves an artifact behind to a sibling.

## Procedure

### 0. Claim the worker's id — before the briefing, before the name

```bash
WID=$(obot.agent/tools/worker-id claim --slug <slug> --task '<one line: what it will do>')
```

It prints the bare id (`W0042`) and nothing else, so it is safe to capture. Every worker
gets one, it is permanent, and it is **never reused** — not when the worker finishes, and
not when it dies. Two workers died on 2026-08-15; their ids are still theirs, because the
question worth answering is what each worker did *including the ones that did nothing*, and
an id freed by death is an id that lies about history.

Why this is step 0 rather than a detail: every agent write — issue, PR, comment, commit —
is authored by `obotclaw[bot]`, and GitHub has no field that separates one agent from
another. The id is the only thing that can, and only if it is applied **at the moment of
writing**. Nothing recovers it afterwards: the harness job ledger's `children` field was
empty for 46% of jobs, and a transcript rescan cannot tell reading a reference from writing
one (one job's transcript carried 87 references and 2 real create calls).

`worker-id --audit` reports a worker that spawned without an id as a **finding**, and the
Navigator sweep surfaces it every five minutes. That check exists because the alternative —
this convention shipping and quietly never being used — would be indistinguishable from it
working. ([obot.roadmap#194](https://github.com/jwildfire/obot.roadmap/issues/194))

### 1. Write the briefing

Fill in [`templates/sibling-briefing.md`](../../templates/sibling-briefing.md):
copy the whole file, fill in every `{…}` placeholder, and pass it as the spawn's
prompt ahead of the `TASK:` line.

> **The template file is the prompt, verbatim.** Everything in it is sent, so it
> carries no notes to its own editor — no HTML comments, no "how to use" preamble.
> The harness samples the first text of a prompt into the job record's `intent`
> and into timeline `detail`, so a comment at the top of the file arrives on the
> Agents tab as what the session is doing, attached to a state
> ([obot.agent#177](https://github.com/jwildfire/obot.agent/issues/177): sixteen
> entries across ten jobs, one of them re-asserting `blocked` forty-five seconds
> before a clean close-out). Guidance about the template belongs here, in the
> skill; `scripts/test/tool-invocation.test.mjs` fails if a prompt template grows
> a comment again.

Put the id from step 0 into every `{W-id}` placeholder — the template's
`## Your identity` block tells the sibling what its id is and where to stamp it.
The `## Context` block is the only part composed per spawn — cwd and key paths
already touched, findings/decisions/constraints established here, recent errors
or state worth knowing, what has already been tried and ruled out. One line each,
under ~300 words. Everything below `## Context` is fixed text, so a spawn is a
fill-in, not an essay.

Skip anything the agent can rediscover by reading the code.

### 2. Standing instructions — always in the briefing

The template carries them as fixed sections: the **report-back contract** (lists
not prose, deliverable to disk, `nothing changed` in exactly one line, close out
with what the lead must relay, the lead is not waiting on you), the **heartbeat
contract**, **ending your session** with a terminal `result:` line, and the
**standing rules** (merges, org scope, deletions, attribution, GitHub bodies).
Do not retype them here; fill in the placeholders.

Two things stay spawn-specific:

- **The heartbeat append is heading-anchored** — inserted under `## Session log`
  with a shelled `$(date +%H:%M)`, per the exact command in the template. Never a
  bare end-of-file `>>` (it lands under `## Scaffold` on a drifted scratchpad and
  corrupts the wrapup's inventory, obot.agent#57), and never a modeled timestamp.
  Fill in the workspace root and the sibling's `{slug}`; multi-writer rules are in
  [`session-update`](../session-update/SKILL.md).
- **Merging**: a sibling merges its own passing work. That is the default the
  briefing states and it is what [`scripts/policy.json`](../../scripts/policy.json)
  says — every repo in the file is `profile: auto`, so its integration branch is on
  the standard lane and needs no approval and no wait. Do not brief a sibling to hold
  finished work; two so briefed on 2026-08-18 did exactly that, and one would have
  left a published page wrong for a day and a half. Use the policy-gated lane only:
  `obot.agent/scripts/obot-merge <pr#> -R <owner>/<repo>` (add `--check`
  to dry-run the policy first) — typed as a **single, undecorated command**. The
  workspace allowlist matches that string whole; a `bash` prefix, a `./`, a
  `cd … &&`, a trailing `; echo`, or a `| tail -20` breaks the match and drops
  the call through to the auto-mode classifier, which refuses roughly one call
  in thirty at random. It resolves the base branch against
  [`scripts/policy.json`](../../scripts/policy.json), merges as
  obotclaw[bot], and verifies the result. Only the **integration** branch of an
  **`auto`**-profile repo merges on the standard lane; every branch of a
  `protected` repo, and every **release**-role branch anywhere (a release
  branch, or a published surface like demo-301's `site`), is on the *attested*
  lane and additionally needs
  `--jeremy-approved '<where/when he approved>'` — pass it ONLY when Jeremy
  explicitly approved that specific merge in-session; the note is posted on the
  PR as an audit comment. A PR touching a carve-out path (`scripts/policy.json`,
  `scripts/obot-merge`, `scripts/obot-policy`, `goals/registry.json`, `hooks/` —
  `obot.agent` only) is forced onto the attested lane whatever the profile says.
  Raw `gh pr merge`, REST, and GraphQL merges are
  denied by the workspace `merge-gate-guard` PreToolUse hook — a denial there
  means "use obot-merge", not "find another route".
  `scripts/obot-policy explain <owner/repo>` prints a repo's effective
  permissions if you need to check before starting work.

### 3. Pick the spawn parameters deliberately

As the lead agent this is your call — think strategically per sibling rather
than defaulting to your own settings:

- **Model** (`--model`): judgment-heavy, novel, or framework-shaping work → the
  strongest available model (fable — siblings and subagents are where Fable
  lives: leads default to opus, @jwildfire 2026-08-04); well-specified
  template-following implementation → a mid-tier model (e.g. opus); light
  mechanical chores → a small fast model (e.g. sonnet or haiku). State the
  choice and why in your reply (allocation grant, 2026-07-11).
- **Effort** (`--effort`): inherit by default; raise it for hard verification or
  judgment work, lower it for mechanical tasks.
- **Name** (`-n`): `👯🤖 W0042 2026-08-16 {slug}`, built by the tool so the shape cannot
  drift from this document:

  ```bash
  NAME=$(obot.agent/tools/worker-id name "$WID" <slug>)
  ```

  The id goes **first**, right after the tag: it is the field that has to survive
  truncation in a narrow `claude agents` row, and because the counter is monotonic,
  sorting by id sorts chronologically anyway. The date stays because an id makes a name
  unique but not *readable* — `W0042` carries no recency, and last week's workers sit in
  the same list as tonight's. Prime can address a worker by the bare id, which is
  unambiguous across every worker that will ever exist.

  Siblings are **green** (a background session sets `color` in its own
  `~/.claude/jobs/{id}/state.json`).
- **Permission mode**: siblings always spawn in auto mode — pass
  `--permission-mode auto` explicitly rather than relying on inheritance.
- **Remote Control**: background siblings spawn **unbridged** — pass
  `--settings '{"remoteControlAtStartup": false}'`. @jwildfire reversed the
  2026-07-23 always-bridged directive on 2026-08-15: he no longer drives
  siblings himself (obot-prime is the single front door —
  [D0013](https://jwildfire.github.io/obot.roadmap/reports/decisions/2026-08-15-delegation-lanes/)),
  so a bridge he never opens is pure overhead: an inbound-control surface on
  every sibling, and a permanent row in his claude.ai/code session list.
  **Dropping the `--remote-control` flag is not enough.** The flag and the
  global `remoteControlAtStartup: true` setting are peers in one `||`, so a
  flagless spawn still bridges — the `--settings` opt-out is what actually
  unbridges. It overrides that one key only: permission mode, workspace
  settings, hooks and plugins are unaffected (verified CLI 2.1.233 — evidence
  in [`docs/remote-control.md`](../../docs/remote-control.md)).
- **Opting a sibling back in**: drop the `--settings` argument and pass
  `--remote-control` instead. Do that for any sibling @jwildfire will talk to
  himself — an interactive reviewer
  ([`session-reviews`](../session-reviews/SKILL.md)), or a long-runner he has
  asked to be able to check on from his phone. Step 6 then applies.

### 4. Run it

```bash
OBOT_WORKER_ID="$WID" claude --bg --permission-mode auto \
  --settings '{"remoteControlAtStartup": false}' \
  --model <model> -n "$NAME" "<briefing>\n\n---\n\nTASK: $ARGUMENTS"
```

`OBOT_WORKER_ID` is inherited by the sibling, so everything built on the shared ledger —
`tools/blocker-log`, and anything else that records an actor — stamps that worker without
it having to remember.

(add `--effort <level>` when deviating from the default; on the opt-in lane
above, swap the `--settings` argument for `--remote-control`)

### 5. Log the spawn — in the same call, and ack in the same message

Do **not** spend a second round trip on the log line. Batch it into the spawn
call: run the `claude --bg …` command and the heading-anchored `## Session log`
append in one Bash call (`&&`-chained, or the spawn backgrounded and the append
after it), with the lead's own tag and a shelled timestamp:

```
- $(date +%H:%M) 😺🤖 lead — spawned 👯🤖 {W-id} {slug}: {task}
```

(the insert-under-the-heading command is the one in
[`templates/sibling-briefing.md`](../../templates/sibling-briefing.md), with
`😺🤖 lead` as the tag).

The **ack to @jwildfire goes in the same message as the spawn, and the ack text
is emitted *before* the spawn call** — reply-first ordering
([session-framework](../../docs/session-framework.md#reply-first--turn-ordering)):
a long briefing composed as the spawn argument runs behind an already-visible
ack, but composed ahead of the ack it is dead air (the 2026-08-15 31-minute
prime turn, obot.agent#102). One line: what was delegated, to which slug, and
how to reach it — `claude agents` from the terminal, or just ask prime, which
can `SendMessage` any local sibling whether or not it is bridged. Then return
to whatever he asked, and relay the sibling's result at your next turn.

The wrapup then knows the sibling exists even if it never logs a line — that
mismatch is exactly the "known gap" that justifies transcript mining in
[`session-wrapup`](../session-wrapup/SKILL.md) step 0.

### 6. Verify the bridge — only on the opt-in lane

**Skip this step for an ordinary background sibling.** Since 2026-08-15 those
spawn unbridged on purpose, so `bridgeSessionId` is *expected* to be absent and
checking it would report a false problem on every spawn.

It stays **required for a sibling you opted back in** (step 3) — the
`--bg` + `--remote-control` combination is undocumented, so a CLI regression
would silently leave @jwildfire unable to find on his phone the one session he
asked to reach from it. Check it explicitly — but **not** as a round trip
wedged between the spawn and the ack, which is exactly what the round-trip
budget forbids. Either batch it into the next Bash call you were going to make
anyway, or run it at your next turn (when you relay the sibling's first
result); the bridge appears within ~15s of spawn and stays for the life of the
job, so a late check is as good as a prompt one:

```bash
python3 -c "import json,sys; d=json.load(open(sys.argv[1])); \
print(d.get('name'), '| bridge:', d.get('bridgeSessionId') or 'MISSING')" \
  ~/.claude/jobs/{id}/state.json
```

- **`bridgeSessionId` present** → the sibling is drivable from claude.ai/code
  and the phone. Nothing more to do; do not spend a message saying so.
- **Missing** → say so in your next reply to @jwildfire (he will look for that
  session on his phone and not find it) and log it to the scratchpad, then keep
  going — the spawn itself is unaffected and the sibling still works locally,
  and prime can still reach it. Then check the two known causes: the
  `--remote-control` flag missing from the command, or the `--settings`
  opt-out left in by mistake. If neither explains it, it is a CLI regression on
  an undocumented combination: note the version and see
  [`docs/remote-control.md`](../../docs/remote-control.md).

**What the old always-on check bought, and what replaces it.** Running on every
spawn, it was a continuous canary on that undocumented combination — roughly
twenty samples a day. It now fires only on opt-in spawns, which are rare. The
remaining continuous canaries are the two **lead** lanes, which still pass the
flag every launch: [`scripts/obot-prime`](../../scripts/obot-prime) and
[`scripts/obot-auto`](../../scripts/obot-auto). A regression there is what
@jwildfire would actually feel, since prime is the session he opens on his
phone — but nothing checks those automatically, so it would surface as him
reporting prime missing rather than as an agent noticing. The triage one-liner
in [`docs/remote-control.md`](../../docs/remote-control.md) is the check; run it
if he ever says a session is missing from Remote Control.

**This skill only owns the sibling lane.** Sessions started any other way — the
lead 😺🤖 session, anything dispatched from the agents view, `obot-auto`'s
autonomous 🦾🤖 lead — do not pass through here, which is exactly how the lead
session went unbridged from 2026-07-23 to 2026-07-29. If @jwildfire reports a
session missing from Remote Control, do not assume this skill is at fault:
identify the launch lane first using the triage table in
[`docs/remote-control.md`](../../docs/remote-control.md).
