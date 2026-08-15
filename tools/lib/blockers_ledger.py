"""The config list's ledger - the part that makes `.claude/blockers.md` trustworthy.

The list is the record of everything only @jwildfire's hands can do. It is
deliberately local-only: never committed, never published, because it maps
permission boundaries and missing grants and would be a capability-gap disclosure
on a public site. That is right for its content, and it is also why the file has
no version history, no backup and no integrity check - so anything that goes wrong
with it goes wrong silently.

Two things had gone wrong (obot.agent#126):

1. THE ALLOCATOR COUNTED PROSE. The next id was `max(every cNNNN in the file) + 1`,
   which cannot tell an identifier from a mention. On 2026-08-15 an agent wrote
   "See c0011 for the same problem in obot.agent" into an entry body before c0011
   had been claimed; the next two items were filed as c0012/c0013 and the numbers
   under them were burned. When the cross-reference was corrected a minute later
   the only trace of c0011 went with it, and the sequence was left lying about what
   had ever existed.

2. THERE WAS NO LOCK. Capture is read -> compute -> write the whole file, and
   several sessions write this file on a normal night. Measured on 2026-08-16 with
   24 concurrent captures against the unlocked tool: 20, 5 and 22 entries survived
   across three runs, with a duplicated id in the first. The clobber is not
   theoretical and it is not rare.

The fix is one append-only journal beside the list, written under an exclusive
lock:

    .claude/blockers.journal      one JSON object per line, never rewritten

It answers the three questions the file cannot answer about itself:

    what has ever been allocated   -> the journal, never the prose
    can two writers collide        -> no, the read-modify-write is inside the lock
    has an entry gone missing      -> allocated minus present, said out loud

Prevention stops at the tool's edge. An agent editing `blockers.md` with ordinary
file tools bypasses the lock entirely and nothing here can stop that - so every
record carries the file's digest, and a change made outside the tool is noticed
and dated on the next run. Detection that fires beats prevention that can be
walked around.

Nothing in this module ever deletes or restores an entry. Re-adding something the
list lost is @jwildfire's call, not an agent's.
"""

import contextlib
import datetime
import fcntl
import hashlib
import json
import os
import platform
import re
import sys

# An id identifies an entry only when it opens one. Everything else on the page -
# a cross-reference, a plan, a note - is prose, and prose has no vote.
ENTRY_ID_RE = re.compile(r"^-\s+\[[ xX]\]\s*(c\d{4})\b", re.M)
# The old, whole-text rule. Kept for exactly one purpose: adopting a list that
# predates the journal (see `seed_record`).
ANY_ID_RE = re.compile(r"\bc(\d{4})\b", re.I)


def now():
    return datetime.datetime.now().astimezone().isoformat(timespec="seconds")


def sha(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def entry_ids(text):
    """The ids that identify entries, open or resolved."""
    return {m.group(1).lower() for m in ENTRY_ID_RE.finditer(text)}


def actor():
    """Who is writing. Names the session where one is available.

    This is the field that turns "two ids vanished" into "this session did it".
    Reconstructing the 2026-08-15 incident took a scan of every transcript in the
    workspace; the journal would have answered it in one line.
    """
    a = os.environ.get("OBOT_ACTOR", "").strip()
    if a:
        return a
    jd = os.environ.get("CLAUDE_JOB_DIR", "").strip()
    if jd:
        return "session:" + os.path.basename(jd.rstrip("/"))
    return "%s@%s" % (os.environ.get("USER", "?"), platform.node().split(".")[0])


def journal_path(md_path):
    return md_path.parent / (md_path.stem + ".journal")


@contextlib.contextmanager
def locked(md_path):
    """Hold the list exclusively for a whole read-modify-write.

    The lock is a separate file, so taking it never touches the list itself and a
    crashed holder leaves nothing to clean up - the kernel drops the flock when
    the process dies.
    """
    md_path.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(str(md_path.parent / (md_path.stem + ".lock")),
                 os.O_CREAT | os.O_RDWR, 0o600)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX)
        yield
    finally:
        try:
            fcntl.flock(fd, fcntl.LOCK_UN)
        finally:
            os.close(fd)


def read_journal(jp):
    if not jp.exists():
        return []
    out = []
    for line in jp.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            out.append(json.loads(line))
        except json.JSONDecodeError:
            # A damaged line loses its own record and nothing else. Refusing to
            # run because the history is imperfect would be the wrong trade for a
            # tool whose job is to keep capture cheap.
            continue
    return out


def append_journal(jp, record):
    """Append one record. The journal only ever grows.

    O_APPEND rather than read-modify-write, so even a writer that somehow escaped
    the lock cannot overwrite a line that is already there.
    """
    jp.parent.mkdir(parents=True, exist_ok=True)
    line = json.dumps(record, sort_keys=True, ensure_ascii=False) + "\n"
    fd = os.open(str(jp), os.O_CREAT | os.O_WRONLY | os.O_APPEND, 0o600)
    try:
        os.write(fd, line.encode("utf-8"))
    finally:
        os.close(fd)


def allocated(records):
    """Every id the ledger has ever handed out, including ones since deleted."""
    ids = set()
    for r in records:
        if r.get("op") == "seed":
            ids.update(str(x).lower() for x in r.get("known", []))
        elif r.get("id"):
            ids.add(str(r["id"]).lower())
    return ids


def high_water(records):
    h = 0
    for r in records:
        if r.get("op") == "seed":
            h = max(h, int(r.get("high", 0)))
        m = re.fullmatch(r"c(\d{4})", str(r.get("id", "")), re.I)
        if m:
            h = max(h, int(m.group(1)))
    return h


def seed_record(text):
    """Adopt a list that predates the journal. Happens once, ever.

    Deliberately conservative: the high-water mark is taken with the OLD whole-text
    rule, prose included. With no history behind us there is nothing to tell an id
    that once named an entry from one that was only ever mentioned - and the two
    mistakes are not symmetric. A burned id costs nothing. A REUSED id makes a
    record ambiguous, and he approves these by number in chat ("c0007 is done").
    From the next claim on, prose is inert.
    """
    high = max((int(m.group(1)) for m in ANY_ID_RE.finditer(text)), default=0)
    known = sorted(entry_ids(text))
    # The holes the sequence already had on the day it was adopted. Whether these
    # ever named an entry is unknowable from here - that is the whole problem - so
    # they are RECORDED and not alarmed on. Without this the adoption would quietly
    # normalise a gap and the next person to notice it would start the same
    # investigation from nothing, which is exactly how this began.
    unaccounted = ["c%04d" % n for n in range(1, high + 1) if "c%04d" % n not in known]
    return {
        "ts": now(), "op": "seed", "actor": actor(),
        "high": high,
        "known": known,
        "unaccounted": unaccounted,
        "sha256": sha(text),
        "note": "pre-journal list adopted; high-water read once with the old whole-text rule",
    }


def ensure_seeded(jp, text):
    """Return the journal, creating its seed record if this list has none yet."""
    records = read_journal(jp)
    if records:
        return records
    seed = seed_record(text)
    append_journal(jp, seed)
    if seed["unaccounted"]:
        print("blocker-log: adopting %s - the sequence already had %d unaccounted id(s): %s\n"
              "  Recorded in the seed record, not treated as a loss: whether they ever named an\n"
              "  entry cannot be known from the file. Everything from here is tracked."
              % (jp.parent / (jp.stem + ".md"), len(seed["unaccounted"]), ", ".join(seed["unaccounted"])),
              file=sys.stderr)
    return [seed]


def next_id(text, records):
    """The next free id.

    Taken from the journal's high-water mark and from ENTRY HEADLINES - never from
    body prose, which is the whole point (obot.agent#126). Headlines still count so
    that an entry somebody added by hand is respected rather than overwritten.
    """
    n = max(
        high_water(records),
        max((int(i[1:]) for i in entry_ids(text)), default=0),
    )
    return "c%04d" % (n + 1)


def audit(text, records):
    """What the ledger knows against what the file shows.

    `missing` is the alarm: an id was allocated and no entry carries it. The list's
    contract is that a resolved entry MOVES to `## Resolved` and is never deleted,
    so a missing id means one left outside the lifecycle.

    `changed_outside` is not an alarm. He ticks items off by hand and agents fix
    cross-references; that is allowed. It is recorded so that when a gap does turn
    up, the window it happened in can be dated instead of guessed at.
    """
    present = entry_ids(text)
    alloc = allocated(records)
    last = next((r for r in reversed(records) if r.get("sha256")), None)
    return {
        "missing": sorted(alloc - present),
        "untracked": sorted(present - alloc),
        "changed_outside": bool(last) and last["sha256"] != sha(text),
        "last_write": (last or {}).get("ts"),
        "last_actor": (last or {}).get("actor"),
        "allocated": len(alloc),
        "present": len(present),
    }


def report(a, md_path):
    """The audit in words, worst first. Empty when there is nothing to say."""
    out = []
    if a["missing"]:
        ids = ", ".join(a["missing"])
        out.append("blocker-log: LEDGER GAP - %d id(s) allocated with no entry in %s: %s"
                   % (len(a["missing"]), md_path, ids))
        out.append("  A resolved entry MOVES to ## Resolved and is never deleted, so an id with")
        out.append("  no entry means one left the list outside its lifecycle.")
        out.append("  Who wrote what, and when: %s" % journal_path(md_path))
        out.append("  Nothing is restored automatically - re-adding an entry is @jwildfire's call.")
    if a["untracked"]:
        out.append("blocker-log: note - %d entr(y/ies) the journal never issued: %s (added by hand?)"
                   % (len(a["untracked"]), ", ".join(a["untracked"])))
    if a["changed_outside"]:
        out.append("blocker-log: note - %s changed outside this tool since it was last written (%s, by %s)."
                   % (md_path, a["last_write"], a["last_actor"] or "?"))
    return out
