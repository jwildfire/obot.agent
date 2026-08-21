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

That mechanism now lives in `id_ledger.py`, shared with the worker ids
(obot.agent#130), because the incidents it prevents are worth preventing once.
What stays HERE is everything specific to this list: what an entry looks like on
the page, how a list that predates the journal is adopted, and what counts as a
finding. The worker ledger's audit compares the journal against the harness's job
records; this one compares it against a markdown file a human edits by hand. Only
the mechanism is common.

Prevention stops at the tool's edge. An agent editing `blockers.md` with ordinary
file tools bypasses the lock entirely and nothing here can stop that - so every
record carries the file's digest, and a change made outside the tool is noticed
and dated on the next run. Detection that fires beats prevention that can be
walked around.

Nothing in this module ever deletes or restores an entry. Re-adding something the
list lost is @jwildfire's call, not an agent's.
"""

import re
import sys

from id_ledger import (Scheme, actor, allocated as _allocated, append_journal,  # noqa: F401
                       high_water as _high_water, journal_path, locked,
                       next_id as _next_id, now, read_journal, sha)

# The config-item family: `c0001`, four digits, owned by tools/blocker-log.
CONFIG = Scheme("c", 4, "blocker-log")

# An id identifies an entry only when it opens one. Everything else on the page -
# a cross-reference, a plan, a note - is prose, and prose has no vote.
ENTRY_ID_RE = re.compile(r"^-\s+\[[ xX]\]\s*(c\d{4})\b", re.M)
# The old, whole-text rule. Kept for exactly one purpose: adopting a list that
# predates the journal (see `seed_record`).
ANY_ID_RE = re.compile(r"\bc(\d{4})\b", re.I)


def entry_ids(text):
    """The ids that identify entries, open or resolved."""
    return {m.group(1).lower() for m in ENTRY_ID_RE.finditer(text)}


def allocated(records):
    """Every id the ledger has ever handed out, including ones since deleted."""
    return _allocated(CONFIG, records)


def high_water(records):
    return _high_water(CONFIG, records)


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
    unaccounted = [CONFIG.fmt(n) for n in range(1, high + 1) if CONFIG.fmt(n) not in known]
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
    return _next_id(CONFIG, records, floor=max((int(i[1:]) for i in entry_ids(text)), default=0))


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


# ---------------------------------------------------------------------------
# The `Why it matters` bar.
#
# @jwildfire, 2026-08-20: "I need the config summarys to start with the 'why'.
# Why is this important? What problem does it fix?"
#
# The trap in that sentence is that this list already HAS a `Why`, and his own
# earlier rule puts it last because "an item that opens with the mechanism is
# written agent-to-agent, and he triages by skimming". Moving `Why` to the top
# would satisfy the words and produce exactly the opening that rule exists to
# stop. What he is asking for is the STAKES, which is what `Unblocks` already
# held. So `Unblocks` was renamed and promoted, and this is its bar.
#
# Enforced HERE, at capture, for the same reason `--do`/`--expect`/`--verify`
# are: a tool that accepts a free-text one-liner gets fed free-text one-liners
# forever. Every finding is a whole sentence, because it is printed back at the
# agent that wrote the bad line and "invalid" teaches nobody what to write.
#
# What this bar CANNOT do is notice a grammatical sentence that says nothing.
# It catches the shapes that are mechanically wrong — a command, a path, a flag,
# a fragment — and the rest is the writer's judgement. Said plainly here so
# nobody reads a pass as a compliment.

MATTERS_MIN_CHARS = 40
MATTERS_MIN_WORDS = 8

# First words that mean the line opened with a mechanism rather than a stake.
_COMMANDISH = (
    "gh", "git", "cd", "bash", "sh", "sudo", "npm", "npx", "node", "python3",
    "grep", "sed", "awk", "cat", "ls", "test", "open", "run", "curl", "brew",
    "launchctl", "pmset", "osascript", "security", "defaults", "rm", "mkdir",
    "printf", "echo", "chmod", "ssh", "scp", "rsync", "docker", "make",
)


def matters_findings(text):
    """Every reason this line is not a statement of why the item matters.

    An empty list means it clears the bar.
    """
    s = str(text or "").strip()
    if not s:
        return ["there is no 'why it matters' at all - an item that cannot say what "
                "problem it fixes is a candidate for not being needed, which is the "
                "other half of what this field is for"]

    out = []
    words = [w for w in re.split(r"\s+", s) if w]
    first = re.sub(r"[^A-Za-z0-9_.-]", "", words[0]).lower() if words else ""

    if len(s) < MATTERS_MIN_CHARS:
        out.append("it is %d characters; saying what breaks if he never does it takes "
                   "at least %d" % (len(s), MATTERS_MIN_CHARS))
    if len(words) < MATTERS_MIN_WORDS:
        out.append("it is %d words; the bar is %d, because fewer is a label rather "
                   "than a reason" % (len(words), MATTERS_MIN_WORDS))
    if re.match(r"^\s*[`~./]|^\s*/Users/|^\s*\$", s):
        out.append("it opens with a path or a shell token; the stakes are what the "
                   "path is FOR, and the path itself belongs in --do")
    if first in _COMMANDISH:
        out.append("it opens with the command \"%s\"; that is --do. This field is what "
                   "goes on being broken until that command is run" % words[0])
    if re.match(r"^\s*--?[A-Za-z]", s):
        out.append("it opens with a flag; a flag is a mechanism and he triages by "
                   "skimming this line first")
    if re.match(r"^\s*(because|since|so that|due to|the reason)\b", s, re.I):
        out.append("it opens with \"%s\", which answers \"why does this happen\" rather "
                   "than \"why does this matter\" - the first is --why, and it goes "
                   "last" % words[0].rstrip(","))
    mech = re.match(r"^\s*(?:the\s+)?(hook|guard|classifier|allowlist|wrapper|parser|"
                    r"launchd|plist|token|regex|script|daemon|sweep)\b", s, re.I)
    if mech:
        out.append("it opens by naming a mechanism (\"%s\"); that is the shape of a "
                   "line written agent-to-agent, and this one is written to him"
                   % mech.group(1))
    return out


def check_matters(text):
    """Return the line unchanged, or raise with every reason it failed."""
    f = matters_findings(text)
    if f:
        raise ValueError("that is not a statement of why it matters: " + "; ".join(f))
    return str(text).strip()
