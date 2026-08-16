"""The mechanism behind every permanent id in this workspace.

Three id families exist here and they are deliberately the same shape, because
@jwildfire approves things by quoting a number in chat and a number that can be
reused makes an old approval ambiguous:

    D0001   decisions      (the hub's reports/decisions/registry.json)
    c0001   config items   (tools/blocker-log)
    W0001   workers        (tools/worker-id)

This module is the part they can share: the lock, the append-only journal, and
the arithmetic that decides the next free number. It was extracted from
`blockers_ledger.py` (obot.agent#127/#129) when the worker ids landed
(obot.agent#130) rather than copied, because the failures it exists to prevent
were found the hard way once and a second, subtly-different implementation would
be the more likely place for them to come back.

WHAT DOES NOT GENERALISE, AND WHY. Each ledger's *audit* stays in its own module.
The two check against different realities: the config list compares the journal
against a markdown file a human hand-edits, while the worker ledger compares it
against the harness's own job records. Only the mechanism is common - what
counts as a finding is not - and forcing one audit to cover both would have meant
a parameter that means "which kind of truth is this", which is the point where a
shared abstraction starts costing more than it saves.

The two properties every family needs, both learned from a real incident:

1. IDS COME FROM THE JOURNAL, NEVER FROM SCRAPED TEXT. On 2026-08-15 an agent
   wrote "See c0011 for the same problem" into an entry body before c0011 had
   been claimed. The allocator matched every `cNNNN` in the file and could not
   tell an identifier from a mention, so the next two items were filed as
   c0012/c0013 and the numbers under them were burned (obot.agent#126). Prose has
   no vote here.

2. ALLOCATION HAPPENS INSIDE AN EXCLUSIVE LOCK. Read -> compute -> write with no
   lock loses writes whenever two agents run at once, which on this machine is
   normal: 24 concurrent captures against the unlocked tool left 20, then 5, then
   22 entries across three measured runs, one with a duplicated id. Worker spawns
   are tighter still - the closest two on record were 2.4 seconds apart.

Nothing here ever deletes a record. An id, once handed out, is spent: a worker
that died holds its number, because the record of a worker that produced nothing
is exactly the record worth keeping.
"""

import contextlib
import datetime
import fcntl
import hashlib
import json
import os
import platform
import re


class Scheme:
    """One id family: its letter, its width, and the tool that owns it.

    Sub-ids (`W0042.1`) are part of the grammar for every family, following the
    hub's `D0001.n`. They name something that belongs to a parent rather than
    standing on its own - a per-question answer under a decision, a subagent
    under the worker accountable for it - so a sub-id never advances the
    top-level counter.
    """

    def __init__(self, prefix, width, tool):
        self.prefix, self.width, self.tool = prefix, width, tool
        self.pattern = r"%s(\d{%d})(?:\.(\d+))?" % (re.escape(prefix), width)
        self._re = re.compile(self.pattern, re.I)

    def fmt(self, n, sub=None):
        base = "%s%0*d" % (self.prefix, self.width, n)
        return base if sub is None else "%s.%d" % (base, sub)

    def parse(self, s):
        """(n, sub) for a well-formed id, else None. `sub` is None for a top-level id."""
        m = self._re.fullmatch(str(s).strip())
        if not m:
            return None
        return int(m.group(1)), (int(m.group(2)) if m.group(2) is not None else None)

    def canon(self, s):
        """The one spelling of an id, so `w0042` and `W0042` can never be two records."""
        p = self.parse(s)
        return None if p is None else self.fmt(*p)


def now():
    return datetime.datetime.now().astimezone().isoformat(timespec="seconds")


def sha(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def actor():
    """Who is writing. Names the worker where one is available.

    This is the field that turns "two ids vanished" into "this session did it".
    Reconstructing the 2026-08-15 incident took a scan of every transcript in the
    workspace; the journal answers it in one line.

    OBOT_WORKER_ID comes first because it is the identity this workspace can
    actually join on - a session id is unique but means nothing to a reader, and
    a hostname means nothing at all when six agents share one machine.
    """
    for var in ("OBOT_ACTOR", "OBOT_WORKER_ID"):
        a = os.environ.get(var, "").strip()
        if a:
            return a
    jd = os.environ.get("CLAUDE_JOB_DIR", "").strip()
    if jd:
        return "session:" + os.path.basename(jd.rstrip("/"))
    return "%s@%s" % (os.environ.get("USER", "?"), platform.node().split(".")[0])


def journal_path(md_path):
    return md_path.parent / (md_path.stem + ".journal")


@contextlib.contextmanager
def locked(path):
    """Hold a ledger exclusively for a whole read-modify-write.

    The lock is a separate file, so taking it never touches the ledger itself and
    a crashed holder leaves nothing to clean up - the kernel drops the flock when
    the process dies.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(str(path.parent / (path.stem + ".lock")),
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


def allocated(scheme, records):
    """Every id the ledger has ever handed out, including ones since deleted."""
    ids = set()
    for r in records:
        if r.get("op") == "seed":
            for x in r.get("known", []):
                c = scheme.canon(x)
                if c:
                    ids.add(c)
        elif r.get("id"):
            c = scheme.canon(r["id"])
            if c:
                ids.add(c)
    return ids


def high_water(scheme, records):
    """The largest top-level number ever issued. Only ever grows.

    Sub-ids are skipped on purpose: `W0042.1` is part of W0042's record, not a
    forty-third worker, so it must not push the counter along.
    """
    h = 0
    for r in records:
        if r.get("op") == "seed":
            h = max(h, int(r.get("high", 0)))
        p = scheme.parse(r.get("id", ""))
        if p and p[1] is None:
            h = max(h, p[0])
    return h


def next_id(scheme, records, floor=0):
    """The next free top-level id.

    `floor` lets a family raise the mark from a second source it trusts - the
    config list passes its entry HEADLINES, so an item added by hand is respected
    rather than overwritten. It is never body prose (obot.agent#126).
    """
    return scheme.fmt(max(high_water(scheme, records), floor) + 1)


def next_sub_id(scheme, parent, records):
    """The next free `.n` under one parent, from the journal alone."""
    p = scheme.parse(parent)
    if not p or p[1] is not None:
        raise ValueError("%s is not a top-level %s id" % (parent, scheme.prefix))
    n = p[0]
    highest = 0
    for i in allocated(scheme, records):
        q = scheme.parse(i)
        if q and q[0] == n and q[1] is not None:
            highest = max(highest, q[1])
    return scheme.fmt(n, highest + 1)
