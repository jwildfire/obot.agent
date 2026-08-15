<!-- STATUS: Posted to https://github.com/jwildfire/obot.agent/pull/128 on 2026-08-16 01:24 EDT -->
<!-- GITHUB_PROPERTIES: Milestone: v0.5.0, Labels: enhancement, Assignee: @me -->

## What this is

Cleanup of a defect I introduced in #127: a compiled Python file got committed.

`#127` added `tools/lib/blockers_ledger.py`. Importing it for a smoke test left a `__pycache__/blockers_ledger.cpython-314.pyc` beside the source, and a `git add -A` swept it into the commit. The repo had **no `.gitignore` at all**, so nothing caught it.

## Roadmap context

Milestone v0.5.0, follow-up to #126 / #127. No separate issue — this is a one-file repo-hygiene fix to work that just landed, not new scope.

## Evidence

```
$ git ls-files | grep -i pycache
tools/lib/__pycache__/blockers_ledger.cpython-314.pyc
```

After this change that returns nothing. Staged diff:

```
 .gitignore                                            |   5 +++++
 tools/lib/__pycache__/blockers_ledger.cpython-314.pyc | Bin 16643 -> 0 bytes
```

No test changes — nothing here is testable behaviour, and the full suite is unaffected by removing a bytecode cache.

## Technical briefing

- `.gitignore` (new) — `__pycache__/` and `*.py[cod]`.
- `git rm --cached` on the tracked `.pyc`. The interpreter keeps writing it locally, which is its job; it just stops arriving in commits.

Why it matters beyond tidiness: the filename carries the interpreter version (`cpython-314`), so the file churns on every Python upgrade, and a stale cache sitting beside an edited source is a genuinely confusing thing to debug — particularly for a module whose whole purpose is being trusted about what it recorded.

## Next steps

None. `tools/lib/` is the first Python package in this repo, so this is the one-time cost of adding it.

---

Drafted by Claude Code using Opus 5 and reviewed by @jwildfire
