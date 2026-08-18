<!-- STATUS: Posted to https://github.com/jwildfire/obot.agent/issues/241 on 2026-08-18 09:48 EDT -->
<!-- GITHUB_PROPERTIES: Milestone: v0.5.0, Labels: infrastructure, Assignee: @me, Parent: jwildfire/obot.roadmap#260 -->

Sub-issue of jwildfire/obot.roadmap#260. Worker 👯🤖 W0060.

### What #260 measured, and what a wider count found

#260 reports three forms of the bot's commit address in circulation. Counting every commit in the seven active checkouts finds forty.

| form | commits | links to `obotclaw[bot]` on GitHub |
|---|---|---|
| `299836032+obotclaw[bot]@users.noreply.github.com` | 1068 | yes — verified against the commits API |
| `obotclaw[bot]@users.noreply.github.com` (no id) | 101 | yes — verified |
| 38 distinct wrong numeric ids | 301 | no — `author` comes back `null` |

The wrong ids are not two stale constants copied around. They are thirty-eight different nine-digit numbers, most used a handful of times, one of them reading `223456789`. Twenty-six of the thirty-eight are allocated GitHub accounts — twenty-three people, one organisation, two bots. That is a model typing a number from memory, once per session, and getting a plausible one.

The good news, verified rather than assumed: GitHub matches the whole noreply address, so a commit carrying a stranger's id links to nobody at all. Checked in both directions on live commits — `215403313+obotclaw[bot]@…` returns `author: null`, `299836032+obotclaw[bot]@…` returns `obotclaw[bot]`. Nothing was ever credited to a stranger. The failure is that 301 commits are unattributable, not that they are attributed to someone else.

The legacy id-less form links correctly too, which matters: it is the one spelling of the bot address that has no number in it to get wrong.

### Where the number is typed

- `tools/fold/lib/publish.mjs:115` hardcodes `219968887+obotclaw[bot]@…` — a live tool, running on every fold, and that id belongs to a real user account.
- `obot.agent` and `safety.viz` repo-local git config both carry `223504588+obotclaw[bot]@…`, which accounts for 93 of the 301.
- `skills/obot-identity/SKILL.md` carries the correct number and tells the reader "user ID 299836032 is fixed — look-up not needed". It has been correct and prominent throughout. Thirty-eight fabrications happened anyway, and that is the finding: documenting a magic number does not stop it being retyped.

### Why the four repos that "default to him" default to him

`user.name = Jeremy Wildfire` is not set in those four repos. It is not set in any repo. Four of six checkouts have no local identity at all and fall through to `--global`, which is right for him and wrong for an agent working in the same clone.

That rules out the obvious fix. Setting the bot identity repo-wide in his clones would attribute his own commits to the bot — the same defect pointing the other way, and worse, because it puts words in his mouth rather than taking credit for his.

### The other direction, measured

Across the same seven checkouts, 110 commits are authored as `Jeremy Wildfire <jwildfire@gmail.com>` while carrying an agent marker in their trailers — 106 with a `Co-Authored-By: Claude …` line, 4 with a `Worker:` line. Those are provably agent commits wearing his name, and the marker is what makes them provable: he does not write those trailers. 87 further commits are authored as him with no marker, and those are his.

That asymmetry is the check. A commit with an agent trailer whose author is not a linkable bot identity is mis-attributed, and it cannot produce a false positive against his own work.

### Scope of this issue

- The canonical identity resolved from one place in code, never typed.
- The one live hardcode fixed.
- A check that reports mis-attributed agent commits, on the five-minute sweep.
- The design for where the identity comes from, written up with its trade-offs, and the parts only @jwildfire can decide handed to him rather than guessed.

Git config changes in any checkout, and the push lane, are proposals in this issue — not changes in its pull request. `scripts/policy.json` names the workspace `.claude/settings.json` as a governed unversioned surface enforced through `hooks/install.sh`, which is a carve-out path, so the mechanism the design lands on is his to approve either way.

### Board

Off the board — ProjectsV2 writes are refused for the App under jwildfire/obot.roadmap#252.

---

Drafted by 👯🤖 W0060 using Opus 5
