"""The worker ledger - what makes "which agent did this" an answerable question.

@jwildfire, 2026-08-16: "I also want each worker to get a unique ID moving
forward W000x".

He asked because he cannot tell agents apart. Every issue, pull request, comment
and commit an agent writes is authored by `obotclaw[bot]`, and GitHub has no
field that separates one agent from another. The volume is past the point where
that is survivable: 33 sibling workers started in the last 24 hours, six running
at once at the peak.

What stood in for an identity was the worker's display name, `👯🤖 {date} {slug}`.
It is not an identifier and cannot become one - the slug is typed freehand by
whichever lead spawns the worker, recorded nowhere before the spawn, checked by
nothing. Across all 51 sibling jobs on this machine no two slugs had collided,
but that is luck rather than construction, and none of them carried an identifier
at all.

WHERE THE TRUTH LIVES. The journal, and only the journal:

    .claude/workers.journal      one JSON object per line, never rewritten

There is deliberately no `workers.md`. The config list keeps a hand-editable
markdown primary because @jwildfire reads and ticks off that file; a worker
roster has no such reader, so a stored copy would be a second source that can
drift from the first. That is the shape of the hub decision registry's `status`
field - written by everything, read by nothing, silently disagreeing with the
Index row that is the real authority - and it is not worth repeating. The roster
here is RENDERED from the journal on demand and joined live to the harness's job
records for liveness.

WHAT THE AUDIT CHECKS, and why the fourth one is the point. The first three ask
whether the ledger is internally sound. The fourth asks whether anyone is
actually using it, which is the only question that can distinguish this
capability working from this capability having shipped:

    an id issued twice            finding   the allocator broke
    a hole in the sequence        finding   a write escaped the lock
    one id on two live workers    finding   a lead reused it in a name
    a worker with no id at all    finding   THE CONVENTION IS NOT BEING APPLIED
    an id claimed, never launched  note     a spawn that failed after the claim

Without the fourth, this tool could ship, be wired into the sweep, report success
on every run, and never once be called by a spawn - and nothing would say so. It
is checked against `~/.claude/jobs/*/state.json`, the harness's own record, so it
is reality rather than self-report: a worker that died still has a job record,
and a worker that chose not to mention itself is counted anyway.

IDS ARE BURNED, NEVER RECYCLED. Two workers died on 2026-08-15 - one went
`blocked`, one stalled for three hours and was stopped. Their ids stay allocated.
The entire purpose is being able to ask what each worker did, including the ones
that did nothing, and an id freed by death is an id that lies about history.

FORWARD-ONLY, BY RECORD. He said "moving forward", and it is also the only honest
option: three of the workers that ran the night before left no machine-recoverable
trace at all, so a backfill could never be complete and a partial one rendered as
clean rows would assert a completeness it does not have. The seed record stamps
the moment the ledger was adopted, and the audit judges nothing that started
before it - so what is out of scope is out of scope by record rather than by
silence.
"""

import datetime
import glob
import json
import os
import re

from id_ledger import (Scheme, actor, allocated, append_journal, high_water,  # noqa: F401
                       locked, next_id, next_sub_id, now, read_journal)

# The worker family: `W0001`, four digits, owned by tools/worker-id.
WORKERS = Scheme("W", 4, "worker-id")

# The session kinds that are workers, by the tag their name opens with. A worker
# is an agent that produces something; prime (🎩🤖) is the Q&A front door and
# carries no deliverable, ultracode jobs (⚡️🤖) are tracked separately, and a
# lead session (😺🤖) is not a worker. Alarming on those would make the check cry
# wolf on every sweep, and a detector nobody trusts is worse than no detector.
WORKER_TAGS = ("👯🤖", "🦾🤖")

ID_IN_NAME = re.compile(WORKERS.pattern)


def journal_for(ws):
    return ws / ".claude" / "workers.journal"


def _dt(s):
    """A timestamp from either source, comparable. None when unreadable."""
    if not s:
        return None
    try:
        return datetime.datetime.fromisoformat(str(s).replace("Z", "+00:00"))
    except ValueError:
        return None


# ---- allocation ----------------------------------------------------------

def seed_record():
    """Adopt the ledger. Happens once, ever, and stamps the convention's epoch.

    The epoch is what makes forward-only honest. Every worker that ran before this
    moment is out of scope, and the audit can say so from a record instead of
    quietly declining to look.
    """
    return {
        "ts": now(), "op": "seed", "actor": actor(),
        "high": 0, "known": [],
        "epoch": now(),
        "note": "worker id ledger adopted; workers that started before this are out of scope",
    }


def ensure_seeded(jp):
    records = read_journal(jp)
    if records:
        return records
    seed = seed_record()
    append_journal(jp, seed)
    return [seed]


def epoch(records):
    for r in records:
        if r.get("op") == "seed" and r.get("epoch"):
            return _dt(r["epoch"])
    return None


def claim(jp, slug, task=None, sub=None, requirement=None):
    """Allocate one id and record it. The whole read-allocate-write is one
    critical section - worker spawns land 2.4 seconds apart on this machine.

    `requirement` is what this worker was dispatched under, and it is the field that
    makes a collision visible (jwildfire/obot.roadmap#267, call n0233). Three times in
    the week it was added, two workers were sent at overlapping work and neither was
    told the other existed; the fact was knowable at dispatch, known by exactly one
    party - the dispatcher - and carried by nothing. It is optional because an
    unrecorded requirement must not stop a spawn, and the sweep reports how many claims
    carry one rather than reading silence as no overlap.
    """
    with locked(jp):
        records = ensure_seeded(jp)
        wid = next_sub_id(WORKERS, sub, records) if sub else next_id(WORKERS, records)
        rec = {"ts": now(), "op": "claim", "id": wid, "actor": actor(),
               "slug": (slug or "").strip()[:60]}
        if task:
            rec["task"] = task.strip()[:200]
        if requirement:
            rec["requirement"] = requirement.strip()[:120]
        if sub:
            rec["parent"] = WORKERS.canon(sub)
        append_journal(jp, rec)
        return wid


def display_name(wid, slug, tag=WORKER_TAGS[0], today=None):
    """The one definition of the spawn name shape.

    `👯🤖 W0042 2026-08-16 workerids`. The id goes first because it is the field
    that must survive truncation in a narrow `claude agents` row, and because the
    counter is monotonic, sorting by id sorts chronologically anyway. The date
    stays because an id makes a name unique but not READABLE - W0042 carries no
    recency, and last week's workers sit in the same list as tonight's.

    It is a function rather than a line in a skill so the convention and the check
    that enforces it cannot drift apart.
    """
    d = today or datetime.date.today().isoformat()
    return "%s %s %s %s" % (tag, wid, d, slug)


# ---- reading reality -----------------------------------------------------

def read_jobs(jobs_dir):
    """The harness's own record of what ran. Never written here."""
    out = []
    for f in sorted(glob.glob(os.path.join(str(jobs_dir), "*", "state.json"))):
        try:
            with open(f, encoding="utf-8") as fh:
                d = json.load(fh)
        except (OSError, ValueError):
            continue
        out.append({
            "name": str(d.get("name") or ""),
            "state": str(d.get("state") or "?"),
            "startedAt": d.get("startedAt") or d.get("createdAt"),
            "firstTerminalAt": d.get("firstTerminalAt"),
            "job": os.path.basename(os.path.dirname(f)),
        })
    return out


def is_worker(job):
    return job["name"].startswith(WORKER_TAGS)


def id_of(job):
    m = ID_IN_NAME.search(job["name"])
    return WORKERS.canon(m.group(0)) if m else None


# ---- the audit -----------------------------------------------------------

def audit(records, jobs):
    ep = epoch(records)
    claims = [r for r in records if r.get("op") == "claim" and r.get("id")]

    seen, dup = set(), set()
    for r in claims:
        wid = WORKERS.canon(r["id"])
        if wid in seen:
            dup.add(wid)
        seen.add(wid)

    alloc = allocated(WORKERS, records)
    tops = {i for i in alloc if WORKERS.parse(i)[1] is None}
    holes = [WORKERS.fmt(n) for n in range(1, high_water(WORKERS, records) + 1)
             if WORKERS.fmt(n) not in tops]

    # Only sessions that started after the ledger was adopted are judged. A job
    # with no readable start time is skipped rather than guessed at.
    fresh = [j for j in jobs if is_worker(j) and (ep is None or (_dt(j["startedAt"]) or ep) >= ep)]

    unstamped = [j["name"] for j in fresh if not id_of(j)]

    by_id = {}
    for j in fresh:
        wid = id_of(j)
        if wid:
            by_id.setdefault(wid, []).append(j)
    reused = sorted(w for w, js in by_id.items() if len(js) > 1)
    # An id in a name that the journal never issued: someone invented a number.
    # It is a finding rather than a note because the allocator does not know about
    # it, so the same number can - and eventually will - be handed out for real.
    unknown = sorted(w for w in by_id if w not in alloc)
    unlaunched = sorted(w for w in tops if w not in by_id)

    return {
        "duplicate": sorted(dup), "holes": holes, "reused": reused,
        "unstamped": unstamped, "unknown": unknown, "unlaunched": unlaunched,
        "allocated": len(alloc), "stamped": len(by_id),
        "epoch": ep.isoformat(timespec="seconds") if ep else None,
    }


def findings(a):
    return a["duplicate"] or a["holes"] or a["reused"] or a["unstamped"] or a["unknown"]


def report(a):
    """The audit in words, worst first.

    The VERDICT LEADS and the notes follow. Callers summarise this by its first
    line - the Navigator puts it straight into navigator-state.md - and a note is
    the common case, so a note printed first would displace the verdict on almost
    every sweep. That exact regression is why the config ledger was rewritten
    (obot.agent#129): a status line that stops showing status is not a status line.
    """
    out = []
    if a["duplicate"]:
        out.append("worker-id: WORKER LEDGER BROKEN - %d id(s) issued twice: %s"
                   % (len(a["duplicate"]), ", ".join(a["duplicate"])))
        out.append("  The allocator handed out the same number twice. Every record naming one of")
        out.append("  these is now ambiguous. Nothing here fixes it - that is @jwildfire's call.")
    if a["holes"]:
        out.append("worker-id: WORKER LEDGER GAP - %d id(s) below the high-water mark were never issued: %s"
                   % (len(a["holes"]), ", ".join(a["holes"])))
        out.append("  Allocation is append-only inside a lock, so a hole means a claim was lost or")
        out.append("  the journal was edited outside this tool.")
    if a["reused"]:
        out.append("worker-id: WORKER LEDGER CONFLICT - %d id(s) carried by more than one worker: %s"
                   % (len(a["reused"]), ", ".join(a["reused"])))
        out.append("  The journal is intact but reality disagrees with it: a lead put an id it did")
        out.append("  not claim into a session name, so writes from two workers share one identity.")
    if a["unknown"]:
        out.append("worker-id: WORKER LEDGER UNKNOWN ID - %d worker(s) carry an id the ledger never issued: %s"
                   % (len(a["unknown"]), ", ".join(a["unknown"])))
        out.append("  The allocator does not know these are taken, so it will hand them out again.")
    if a["unstamped"]:
        out.append("worker-id: WORKER LEDGER - %d unstamped worker(s) ran with no id: %s"
                   % (len(a["unstamped"]), ", ".join(a["unstamped"][:5])))
        out.append("  Claim one with `worker-id claim --slug <slug>` BEFORE the spawn and put it in")
        out.append("  the session name. A worker with no id cannot be attributed to anything it wrote,")
        out.append("  which is the whole reason the ledger exists.")
    if a["unlaunched"]:
        out.append("worker-id: note - %d id(s) claimed but never launched: %s. Burned, not lost."
                   % (len(a["unlaunched"]), ", ".join(a["unlaunched"][:5])))
    return out


# ---- the roster ----------------------------------------------------------

def roster(records, jobs):
    """Rendered from the journal every time. Never stored - see the module note."""
    live = {}
    for j in jobs:
        wid = id_of(j)
        if wid:
            live.setdefault(wid, j)
    lines = []
    for r in records:
        if r.get("op") != "claim" or not r.get("id"):
            continue
        wid = WORKERS.canon(r["id"])
        j = live.get(wid)
        # A sub-id has no session of its own, which is a fact about subagents
        # rather than a gap: the parent worker is what the harness records and
        # what is accountable for what the subagent wrote.
        state = j["state"] if j else ("subagent" if r.get("parent") else "not launched")
        row = "%s · claimed %s · %s · %s" % (wid, str(r.get("ts", ""))[:16], r.get("slug", "?"), state)
        if r.get("task"):
            row += " · %s" % r["task"]
        lines.append(row)
    return lines
