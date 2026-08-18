"""The delivery record - what a day of agents did to the roadmap.

D0017 (approved 2026-08-16) gives the Navigator one file of its own and makes the
five-minute sweep the sole writer of the other. That split is not fussiness: the
two nights before it produced repeated cases of one process quietly overwriting
another's file, and the delivery record is the thing the whole role exists to
produce.

Two kinds of line live here, because not everything the Navigator decides deserves
the same weight:

    verdict   one closeout - which worker, what it produced, which requirement it
              moved, and whether that movement is confirmed or drift.
    call      a decision made on @jwildfire's behalf that changes the plan - filing
              a requirement, amending one, granting an exemption, closing something
              as out of scope. These carry a permanent `n0001` id, because he
              reviews them in batch and reversing one means naming it.

The mechanism - the lock, the append-only journal, the high-water arithmetic - is
`id_ledger`, shared with the config list and the worker roster rather than written
again. Ids come from the journal and never from the rendered file: an id read out
of body prose burned two numbers on 2026-08-15 (obot.agent#126), and this file is
prose by construction.

What does NOT generalise is the audit. This one asks a question neither of the
others does: is every call the Navigator says it made still visible in the record
@jwildfire reads? A delegated decision that leaves no record is indistinguishable
from no decision, which is the risk inside the delegation grant.
"""

import datetime
import pathlib

from id_ledger import (Scheme, actor, allocated, append_journal, locked, next_id,
                       now, read_journal, sha)

SCHEME = Scheme("n", 4, "delivery-log")

VERDICTS = ("confirmed", "drift", "none")

# Actors that may record a CALL but never a VERDICT (obot.agent#167, under
# jwildfire/obot.roadmap#236, correction 1).
#
# The admiral writes its own actions here so its work is judged by the same
# standard as any worker's - an overseer whose actions are invisible is the failure
# it exists to prevent. It does NOT judge delivery. Judging stays the Navigator's,
# and a second writer of verdicts makes this record two-sourced, which is precisely
# the defect this programme spent two days removing from the decisions registry, the
# dashboard queue and the roadmap page.
#
# Enforced here rather than only in the admiral's skill file, because a rule
# that lives only in prose is a rule an agent can talk itself out of at three in the
# morning. Matched on the actor prefix so the sub-ids an admiral might claim are
# covered too.
#
# "fleet" IS STILL LISTED, AND IS NOT A LEFTOVER. This tuple is a bar, not a label:
# every name in it is refused. The role was renamed from fleet to admiral in
# obot.agent#182, and dropping the old name would have made the rename a silent
# widening of what may write a verdict — anything still running with
# OBOT_ACTOR=fleet, from a session started before the rename or a skill file read
# from an older checkout, would have sailed straight through a guard that used to
# stop it. A bar costs nothing by listing a name nobody uses any more, and costs
# the whole guard by dropping one somebody still does. Old names stay here
# permanently; only new ones are ever added.
CALL_ONLY_ACTORS = ("admiral", "fleet")


def is_call_only(who):
    """Whether this actor is barred from writing verdicts."""
    a = str(who or "").strip().lower()
    return any(a == p or a.startswith(p + "-") or a.startswith(p + ":")
               for p in CALL_ONLY_ACTORS)

HEADER = [
    "# delivery - what the agents did to the roadmap",
    "",
    "Written only by `obot.agent tools/delivery-log`, append-only. The Navigator",
    "session is the sole writer; the five-minute sweep reads this and renders it,",
    "and never writes it (D0017, 2026-08-16).",
    "",
]


def record_path(ws):
    return pathlib.Path(ws) / ".claude/session-hub/delivery.md"


def journal_for(ws):
    return record_path(ws).parent / "delivery.journal"


def _today():
    return datetime.date.today().isoformat()


def _hhmm():
    return datetime.datetime.now().strftime("%H:%M")


def _ensure_header(md):
    if md.exists():
        return
    md.parent.mkdir(parents=True, exist_ok=True)
    md.write_text("\n".join(HEADER) + "\n", encoding="utf-8")


def append_line(ws, line):
    """One line onto the end of the record. The file only ever grows."""
    md = record_path(ws)
    _ensure_header(md)
    with md.open("a", encoding="utf-8") as fh:
        fh.write(line + "\n")


def verdict_line(worker, produced, requirement, verdict, note=None):
    bits = ["- %s %s %s" % (_today(), _hhmm(), worker),
            "produced %s" % produced,
            "requirement %s" % requirement,
            verdict]
    if note:
        bits.append(note)
    return " · ".join(bits)


def named_actor(who):
    """The actor to print on a call line, or None for the Navigator session itself.

    A bare session id (`session:b510658b`) means nothing to a human reader and would
    be noise on every line, so it stays in the journal where the joining is done. A
    NAMED actor - `admiral`, or a worker id - is what a reader needs, because it
    answers "who decided this on my behalf" in the case where the answer is not the
    officer he expects. jwildfire/obot.roadmap#236: the admiral's own actions go in
    this record actor-stamped, judged by the same standard as any worker's, because
    an overseer whose actions are invisible is the failure it exists to prevent.
    """
    a = str(who or "").strip()
    if not a or a.startswith("session:") or a.startswith("host:"):
        return None
    return a


def call_line(cid, kind, summary, who=None):
    stamp = named_actor(who)
    return "- %s %s %s · call %s · %s%s · %s" % (
        _today(), _hhmm(), cid, cid, ("%s · " % stamp) if stamp else "", kind, summary)


def write_verdict(ws, worker, produced, requirement, verdict, note=None):
    who = actor()
    if is_call_only(who):
        raise PermissionError(
            "%s may record calls but never verdicts - judging delivery is the "
            "Navigator's, and a second writer makes this record two-sourced. "
            "Report the closeout gap instead; do not route around this." % who)
    if verdict not in VERDICTS:
        raise ValueError("verdict must be one of %s" % ", ".join(VERDICTS))
    line = verdict_line(worker, produced, requirement, verdict, note)
    jp = journal_for(ws)
    with locked(jp):
        append_journal(jp, {"op": "verdict", "at": now(), "actor": actor(),
                            "worker": worker, "produced": produced,
                            "requirement": requirement, "verdict": verdict,
                            "note": note or "", "digest": sha(line)})
        append_line(ws, line)
    return line


def write_call(ws, kind, summary):
    """Allocate a permanent id and record the call, both inside one lock."""
    jp = journal_for(ws)
    with locked(jp):
        records = read_journal(jp)
        cid = next_id(SCHEME, records)
        who = actor()
        line = call_line(cid, kind, summary, who)
        append_journal(jp, {"op": "call", "id": cid, "at": now(), "actor": who,
                            "kind": kind, "summary": summary, "digest": sha(line)})
        append_line(ws, line)
    return cid, line


def read_entries(ws, day=None):
    """The rendered record, parsed back into verdict and call lines for one day."""
    md = record_path(ws)
    if not md.exists():
        # `armed` is what tells the renderer apart from a day with no entries. The
        # tool's own `report()` has always said "This is not the same as a clean
        # day; it means nothing has been written" - that sentence never reached the
        # state file, because "not armed" exits 0 (jwildfire/obot.roadmap#223).
        return {"verdicts": [], "calls": [], "armed": False}
    day = day or _today()
    verdicts, calls = [], []
    for raw in md.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line.startswith("- ") or day not in line:
            continue
        (calls if " · call " in line else verdicts).append(line[2:])
    return {"verdicts": verdicts, "calls": calls, "armed": True}


def render(ws, day=None):
    """The `## Delivery` section the sweep folds into its own state file.

    One heading, because the dashboard's Navigator tab renders any heading the
    state file carries - so this reaches his dashboard with no rendering code.
    """
    day = day or _today()
    e = read_entries(ws, day)
    out = ["## Delivery - %s" % day, ""]
    if not e.get("armed", True):
        # One sentence in place of both verdicts: neither "no closeouts today" nor
        # "no call has been made on your behalf" is a claim this machine can make.
        out.append(
            "- **NO RECORD** - `%s` does not exist on this machine, so nothing is "
            "being recorded. This is not a quiet day; it is an unwritten one. The "
            "Navigator session creates it on its first closeout." % record_path(ws))
        return "\n".join(out) + "\n"
    if not e["verdicts"]:
        out.append("- no closeouts recorded yet today")
    for v in e["verdicts"]:
        out.append("- %s" % v)
    out += ["", "### Calls made for you", ""]
    if not e["calls"]:
        out.append("- none - no plan-changing call has been made on your behalf today")
    for c in e["calls"]:
        out.append("- %s" % c)
    return "\n".join(out) + "\n"


def audit(ws):
    """Is every call the journal issued still visible in the record he reads?

    Read-only: the sweep runs this every five minutes and a detector that mutates
    what it observes is not a detector. Deliberately one-directional - a line in
    the file with no journal record is a hand-edit, which is noted rather than
    failed, while an id the journal issued and the file has lost is a decision that
    has vanished from the record, which is the failure this exists to catch.
    """
    jp = journal_for(ws)
    records = read_journal(jp)
    call_ids = sorted(allocated(SCHEME, records))
    md = record_path(ws)
    text = md.read_text(encoding="utf-8") if md.exists() else ""
    missing = [cid for cid in call_ids if cid not in text]
    verdicts = [r for r in records if r.get("op") == "verdict"]
    return {"armed": bool(records), "calls": call_ids, "missing": missing,
            "verdicts": len(verdicts), "path": str(md)}


def report(a):
    """Verdict first, then detail. Callers summarise by first line (obot.agent#129)."""
    if not a["armed"]:
        return ["delivery-log: not armed - no calls or closeouts recorded yet at %s." % a["path"],
                "  This is not the same as a clean day; it means nothing has been written."]
    if a["missing"]:
        lines = ["delivery-log: DELIVERY RECORD GAP - %d call(s) allocated with no line in the record"
                 % len(a["missing"])]
        for cid in a["missing"]:
            lines.append("  %s is in the journal and missing from %s" % (cid, a["path"]))
        return lines
    return ["delivery-log: record clean - %d call(s) allocated, %d present, %d closeout(s) recorded"
            % (len(a["calls"]), len(a["calls"]), a["verdicts"])]


def findings(a):
    return bool(a["missing"])
