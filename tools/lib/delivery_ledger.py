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


def call_line(cid, kind, summary):
    return "- %s %s %s · call %s · %s · %s" % (_today(), _hhmm(), cid, cid, kind, summary)


def write_verdict(ws, worker, produced, requirement, verdict, note=None):
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
        line = call_line(cid, kind, summary)
        append_journal(jp, {"op": "call", "id": cid, "at": now(), "actor": actor(),
                            "kind": kind, "summary": summary, "digest": sha(line)})
        append_line(ws, line)
    return cid, line


def read_entries(ws, day=None):
    """The rendered record, parsed back into verdict and call lines for one day."""
    md = record_path(ws)
    if not md.exists():
        return {"verdicts": [], "calls": []}
    day = day or _today()
    verdicts, calls = [], []
    for raw in md.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line.startswith("- ") or day not in line:
            continue
        (calls if " · call " in line else verdicts).append(line[2:])
    return {"verdicts": verdicts, "calls": calls}


def render(ws, day=None):
    """The `## Delivery` section the sweep folds into its own state file.

    One heading, because the dashboard's Navigator tab renders any heading the
    state file carries - so this reaches his dashboard with no rendering code.
    """
    day = day or _today()
    e = read_entries(ws, day)
    out = ["## Delivery - %s" % day, ""]
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
