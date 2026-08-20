"""The landing record - what he was promised, and what actually reached him.

TWO INCIDENTS, ONE MISSING LANE (jwildfire/obot.roadmap#257).

    2026-08-18  He asked for an org chart. Two workers built it, he was told it was
                being drafted, and the page returned 404 for over a day. Nothing was
                wrong in the ordinary sense: the requirement stayed open, the branch
                was intact, no check reported a false state. He simply did not get it.

    2026-08-20  Four workers finished inside twenty-five minutes and closed five
                requirements. Nothing told him. He noticed the agent count had
                dropped, asked what happened, and got a list of issue numbers back.

The house is tuned to catch a FALSE statement - a success reported where nothing
happened. Both of these make no statement at all, and an absent thing produces no
signal for a check that fires on a wrong one.

So this file holds the two record kinds that close that lane, and they are
deliberately the same shape because they are the same question asked at two ends:

    promise   something he asked for, in HIS words, with a named landing place and a
              date. It carries no verdict of its own - `check` fetches the landing
              and records what it found, and an ask that has gone quiet surfaces
              from its age rather than from anyone remembering to look.
    closure   something that completed, as ONE SENTENCE saying what a person can now
              do that they could not before. The sentence is the deliverable; the
              issue number is a trailing citation and never the headline.

WHY THE SENTENCE IS VALIDATED HERE AND NOT ASKED FOR IN PROSE. "Write a plain-English
summary" is an instruction, and an instruction is what four workers had on 2026-08-20.
`summary_findings` is a bar: "#251, #256 and #264 closed" is refused at the moment of
writing, by the tool, with the reason. What the bar cannot see - a closure written with
no summary at all, because nobody called this tool - is not this file's to catch, and is
caught instead by the sweep comparing GitHub's closed requirements against this record
(`tools/navigator/closures.mjs`). Between them there is no way to close a requirement
quietly.

THREE OBSERVATION STATES, NEVER TWO. A landing is `landed`, `not-landed`, or
`unchecked`, and the third never collapses into the second. A fetch that could not run
says so; only a fetch that ran and found nothing says the thing is absent
(jwildfire/obot.agent#215 - ENOENT is the only failure allowed to read as absence).

The mechanism - the lock, the append-only journal, the high-water arithmetic - is
`id_ledger`, shared with the config list, the worker roster and the delivery record
rather than written again. Ids come from the journal and never from the rendered file.
"""

import datetime
import pathlib
import re

from id_ledger import (Scheme, actor, allocated, append_journal, locked, next_id,
                       now, read_journal, sha)

SCHEME = Scheme("L", 4, "landing-log")

# What a landing observation may say. Ordered worst-known-first on purpose: a reader
# scanning this tuple should meet `unchecked` as a first-class answer rather than as
# an afterthought, because treating it as one is the whole point.
STATES = ("landed", "not-landed", "unchecked")

# How long an unlanded promise stays quiet before it is a finding. Twenty-four hours
# because that is what the org chart actually cost - it was undelivered "for over a
# day, across a dozen exchanges in which it could have come up".
QUIET_HOURS = 24

# The bar a closure sentence has to clear. Every number here was chosen against the
# sentence that failed on 2026-08-20 ("#251, #256 and #264 closed": 5 words, 28
# characters, 3 of 5 tokens an issue reference) and against the sentence the scope
# note gives as the standard ("When the system says it stopped a runaway agent, it
# now has to prove the process died": 19 words, 96 characters, no citations).
MIN_CHARS = 40
MIN_WORDS = 8
MAX_CITATION_SHARE = 0.25

ISSUE_REF = re.compile(r"(?:[A-Za-z0-9._-]+/)?[A-Za-z0-9._-]*#\d+")

HEADER = [
    "# landings - what he was promised, and what reached him",
    "",
    "Written only by `obot.agent tools/landing-log`, append-only. A promise is",
    "something @jwildfire asked for; a closure is one sentence saying what he can now",
    "do that he could not before. Both are his language, not the machine's",
    "(jwildfire/obot.roadmap#257).",
    "",
]


def record_path(ws):
    return pathlib.Path(ws) / ".claude/session-hub/landings.md"


def journal_for(ws):
    return record_path(ws).parent / "landings.journal"


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


# ---- the bar -----------------------------------------------------------------

def normalise(s):
    """One spelling of a sentence, for comparing it against an issue title."""
    return re.sub(r"[^a-z0-9 ]+", " ", str(s or "").lower()).strip()
    

def summary_findings(summary, title=None):
    """Every reason this sentence is not a plain-English executive summary.

    Empty list means it clears the bar. Each finding is a whole sentence, because
    it is printed straight back at the agent that wrote the bad summary and
    "invalid" teaches nobody what to write instead.
    """
    s = str(summary or "").strip()
    out = []
    if not s:
        return ["there is no summary at all - a closure without a sentence is the "
                "failure this bar exists to stop"]

    words = [w for w in re.split(r"\s+", s) if w]
    refs = [w for w in words if ISSUE_REF.search(w)]

    if len(s) < MIN_CHARS:
        out.append("it is %d characters; a sentence saying what he can now do takes at "
                   "least %d" % (len(s), MIN_CHARS))
    if len(words) < MIN_WORDS:
        out.append("it is %d words; the bar is %d, because fewer is a label rather than "
                   "a sentence" % (len(words), MIN_WORDS))
    if words and len(refs) / len(words) > MAX_CITATION_SHARE:
        out.append("%d of its %d words are issue references - \"#251, #256 and #264 "
                   "closed\" is the exact failure being named here; the citation goes "
                   "at the end and is never the summary" % (len(refs), len(words)))
    if re.match(r"^\s*(?:[A-Za-z0-9._-]+/)?[A-Za-z0-9._-]*#\d+", s):
        out.append("it opens with an issue number; the summary is the deliverable and "
                   "the number is a trailing citation")
    if re.match(r"^\s*(?:closes|fixes|resolves|requirement|issue|pr)\b", s, re.I):
        out.append("it opens with \"%s\", which is bookkeeping rather than a statement "
                   "of what changed for him" % s.split()[0])
    if title and normalise(s) == normalise(title):
        out.append("it is the issue title verbatim; the title names the work and the "
                   "summary names what he can now do")
    return out


def check_summary(summary, title=None):
    """Raise with every reason, or return the sentence unchanged."""
    f = summary_findings(summary, title)
    if f:
        raise ValueError("this is not a plain-English summary: " + "; ".join(f))
    return str(summary).strip()


# ---- writing -----------------------------------------------------------------

def promise_line(lid, asked, landing, date, issue=None, who=None):
    bits = ["- %s %s %s · promise · %s" % (date, _hhmm(), lid, asked),
            "lands at %s" % landing]
    if issue:
        bits.append(issue)
    if who:
        bits.append(who)
    return " · ".join(bits)


def closure_line(lid, summary, issue, date, worker=None):
    bits = ["- %s %s %s · closure · %s" % (date, _hhmm(), lid, summary),
            issue]
    if worker:
        bits.append(worker)
    return " · ".join(bits)


def write_promise(ws, asked, landing, date=None, issue=None):
    """Record something he asked for, with the place it is meant to land."""
    if not str(asked or "").strip():
        raise ValueError("a promise needs his words - what did he actually ask for?")
    if not str(landing or "").strip():
        raise ValueError("a promise needs a landing place: a URL, a page, a file or an "
                         "issue. A promise with nowhere to land cannot be verified, and "
                         "an unverifiable list of promises is a second place to be wrong")
    date = date or _today()
    jp = journal_for(ws)
    with locked(jp):
        records = read_journal(jp)
        lid = next_id(SCHEME, records)
        who = actor()
        line = promise_line(lid, asked.strip(), landing.strip(), date, issue, who)
        append_journal(jp, {"op": "promise", "id": lid, "at": now(), "actor": who,
                            "asked": asked.strip(), "landing": landing.strip(),
                            "date": date, "issue": issue or "", "digest": sha(line)})
        append_line(ws, line)
    return lid, line


def write_closure(ws, issue, summary, worker=None, landing=None, title=None):
    """Record a completion, as the sentence rather than as the number.

    The bar runs BEFORE the lock and before anything is written, so a refused
    summary costs nothing and leaves no half-record behind.
    """
    if not str(issue or "").strip():
        raise ValueError("a closure needs the thing it closed, e.g. hub#264")
    summary = check_summary(summary, title)
    jp = journal_for(ws)
    with locked(jp):
        records = read_journal(jp)
        lid = next_id(SCHEME, records)
        who = actor()
        line = closure_line(lid, summary, issue.strip(), _today(), worker or who)
        append_journal(jp, {"op": "closure", "id": lid, "at": now(), "actor": who,
                            "issue": issue.strip(), "summary": summary,
                            "worker": worker or who, "landing": landing or "",
                            "digest": sha(line)})
        append_line(ws, line)
    return lid, line


def write_observation(ws, ref, state, detail=""):
    """What a fetch of a promise's landing actually found.

    Journal only. Observations are a measurement stream - one every sweep for every
    open promise - and putting them in the record he reads would bury the promises
    themselves under their own polling.
    """
    if state not in STATES:
        raise ValueError("state must be one of %s" % ", ".join(STATES))
    if not SCHEME.canon(ref):
        raise ValueError("%s is not a landing id" % ref)
    jp = journal_for(ws)
    with locked(jp):
        append_journal(jp, {"op": "observation", "ref": SCHEME.canon(ref), "at": now(),
                            "actor": actor(), "state": state, "detail": detail or ""})
    return SCHEME.canon(ref)


# ---- reading -----------------------------------------------------------------

def _age_hours(iso, now_dt=None):
    try:
        t = datetime.datetime.fromisoformat(iso)
    except (TypeError, ValueError):
        return None
    now_dt = now_dt or datetime.datetime.now().astimezone()
    if t.tzinfo is None:
        t = t.astimezone()
    return (now_dt - t).total_seconds() / 3600.0


def read_state(ws, now_dt=None):
    """Every promise and closure, with each promise's latest observation attached.

    `armed` is what tells a day with nothing recorded apart from a machine where
    nothing is recording. The two look identical from a count and they are not the
    same fact (jwildfire/obot.roadmap#223).
    """
    jp = journal_for(ws)
    records = read_journal(jp)
    if not records:
        return {"armed": False, "promises": [], "closures": [],
                "path": str(record_path(ws))}

    latest = {}
    for r in records:
        if r.get("op") == "observation" and r.get("ref"):
            prev = latest.get(r["ref"])
            if not prev or str(r.get("at", "")) >= str(prev.get("at", "")):
                latest[r["ref"]] = r

    promises, closures = [], []
    for r in records:
        if r.get("op") == "promise":
            obs = latest.get(r["id"])
            age = _age_hours(r.get("at"), now_dt)
            promises.append({
                "id": r["id"], "asked": r.get("asked", ""), "landing": r.get("landing", ""),
                "date": r.get("date", ""), "issue": r.get("issue", ""),
                "at": r.get("at", ""), "ageHours": age,
                "state": (obs or {}).get("state", "unchecked"),
                "detail": (obs or {}).get("detail", "never checked on this machine"),
                "checkedAt": (obs or {}).get("at", ""),
                "quiet": bool(age is not None and age >= QUIET_HOURS
                              and (obs or {}).get("state") != "landed"),
            })
        elif r.get("op") == "closure":
            closures.append({
                "id": r["id"], "issue": r.get("issue", ""), "summary": r.get("summary", ""),
                "worker": r.get("worker", ""), "landing": r.get("landing", ""),
                "at": r.get("at", ""), "date": str(r.get("at", ""))[:10],
                "ageHours": _age_hours(r.get("at"), now_dt),
            })
    return {"armed": True, "promises": promises, "closures": closures,
            "path": str(record_path(ws))}


def render(ws, day=None, now_dt=None):
    """The `## Landings` section the sweep folds into its own state file.

    Closures first and in his language, because that is the half that had no
    delivery path at all. The promise list follows, and it leads with what has gone
    quiet rather than with what is fine.
    """
    day = day or _today()
    st = read_state(ws, now_dt)
    out = ["## Landings — what reached him", ""]
    if not st["armed"]:
        out.append(
            "- **NO RECORD** — `%s` does not exist on this machine, so no completion is "
            "being summarised and no promise is being tracked. This is not a quiet day; "
            "it is an unwritten one. `obot.agent/tools/landing-log` creates it on its "
            "first write." % st["path"])
        return "\n".join(out) + "\n"

    today_closures = [c for c in st["closures"] if c["date"] == day]
    out.append("### Completed today, in his language")
    out.append("")
    if not today_closures:
        out.append("- nothing has been recorded as completed today")
    for c in today_closures:
        out.append("- %s — %s%s" % (c["summary"], c["issue"],
                                    (" · %s" % c["worker"]) if c["worker"] else ""))

    quiet = [p for p in st["promises"] if p["quiet"]]
    open_p = [p for p in st["promises"] if p["state"] != "landed" and not p["quiet"]]
    landed = [p for p in st["promises"] if p["state"] == "landed"]
    out += ["", "### Promised to him", ""]
    if quiet:
        out.append("- **PROMISE GONE QUIET** — %d thing(s) he asked for have not landed "
                   "and are over %dh old" % (len(quiet), QUIET_HOURS))
        for p in quiet:
            out.append("  - %s · \"%s\" · %s · %s (%s)"
                       % (p["id"], p["asked"], p["landing"],
                          p["state"], p["detail"]))
    for p in open_p:
        out.append("- %s · \"%s\" · %s · %s (%s)"
                   % (p["id"], p["asked"], p["landing"], p["state"], p["detail"]))
    if not quiet and not open_p:
        out.append("- nothing outstanding — every promise on record has been fetched "
                   "and found (%d landed)" % len(landed))
    return "\n".join(out) + "\n"


def audit(ws):
    """Is every landing the journal issued still visible in the record he reads?

    Read-only. The same one-directional shape as the delivery record's audit: a line
    in the file with no journal record is a hand-edit and is noted, while an id the
    journal issued and the file has lost is a promise or a completion that has
    vanished from the record, which is the failure this exists to catch.

    It asks one thing the delivery audit does not: does every closure in the record
    still clear the summary bar? A sentence that got in past a hand-edit is exactly
    the "#251, #256 and #264 closed" case reappearing by another door.
    """
    jp = journal_for(ws)
    records = read_journal(jp)
    ids = sorted(allocated(SCHEME, records))
    md = record_path(ws)
    text = md.read_text(encoding="utf-8") if md.exists() else ""
    missing = [i for i in ids if i not in text]
    st = read_state(ws)
    weak = [(c["id"], c["issue"], summary_findings(c["summary"]))
            for c in st["closures"] if summary_findings(c["summary"])]
    return {"armed": bool(records), "ids": ids, "missing": missing,
            "promises": len(st["promises"]), "closures": len(st["closures"]),
            "quiet": [p for p in st["promises"] if p["quiet"]],
            "weak": weak, "path": str(md)}


def report(a):
    """Verdict first, then detail. Callers summarise by first line (obot.agent#129)."""
    if not a["armed"]:
        return ["landing-log: not armed - nothing promised or completed has been "
                "recorded yet at %s." % a["path"],
                "  This is not the same as a clean day; it means nothing has been written."]
    lines = []
    if a["missing"]:
        lines.append("landing-log: LANDING RECORD GAP - %d id(s) allocated with no line "
                     "in the record" % len(a["missing"]))
        for i in a["missing"]:
            lines.append("  %s is in the journal and missing from %s" % (i, a["path"]))
    if a["weak"]:
        lines.append("landing-log: SUMMARY BELOW THE BAR - %d closure(s) in the record "
                     "are not plain-English summaries" % len(a["weak"]))
        for lid, issue, why in a["weak"]:
            lines.append("  %s (%s) - %s" % (lid, issue, "; ".join(why)))
    if a["quiet"]:
        lines.append("landing-log: PROMISE GONE QUIET - %d thing(s) he asked for are "
                     "over %dh old and have not been found at their landing place"
                     % (len(a["quiet"]), QUIET_HOURS))
        for p in a["quiet"]:
            lines.append("  %s \"%s\" - %s at %s (%s)"
                         % (p["id"], p["asked"], p["state"], p["landing"], p["detail"]))
    if lines:
        # The verdict has to be the FIRST line even when several kinds of finding
        # stack up, because callers summarise by first line and a headline that is
        # merely one of three reads as the whole answer (obot.agent#129).
        kinds = sum(1 for k in ("missing", "weak", "quiet") if a[k])
        if kinds > 1:
            lines.insert(0, "landing-log: %d KINDS OF FINDING - detail below, and the "
                            "first line of each is its own verdict" % kinds)
        return lines
    return ["landing-log: record clean - %d promise(s) tracked and %d completion(s) "
            "summarised, every id present" % (a["promises"], a["closures"])]


def findings(a):
    return bool(a["missing"] or a["weak"] or a["quiet"])
