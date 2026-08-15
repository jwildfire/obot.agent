# Standing goals

Goals are **hub issues**, not files, since hub #53/#71 (2026-07-24, superseding
[#18 design](https://jwildfire.github.io/obot.roadmap/requirements/design/18_design.html)
decision O2; v2 amendment same day — see
[#53 design §7](https://jwildfire.github.io/obot.roadmap/requirements/design/53_design.html)).
A goal issue carries the standing **direction** of work as prose; its
**membership is the sub-issue links**, generated at read time — nothing
list-like is hand-maintained anywhere. Goal pages on the hub site render them
(`https://jwildfire.github.io/obot.roadmap/goals/`).

What remains here is [`registry.json`](registry.json), the **policy binding**
that `--auto` selection reads first:

```json
"goals": {
  "<slug>": { "issue": <hub issue #>, "status": "active|paused",
              "grant_profile": "standard", "backlog": ["owner/repo", …] }
}
```

## How the pieces fit

- **Hub goal issue** (label `goal`, template `.github/ISSUE_TEMPLATE/goal.yml`
  in the hub) — prose-only direction (intent, boundaries) plus a hidden
  `<!-- goal-slug: … -->` comment naming the site page. Members are whatever
  is linked as sub-issues — requirements or lightweight tasks (#53 policy). A
  newly linked sub-issue is automatically a member. @jwildfire edits goal
  issues and links directly — no PR ceremony.
- **`registry.json`** (here) — slug → issue number, `status`,
  `grant_profile`, and the repo-level `backlog` feeds that can't be
  sub-issues. `--auto` only selects within goals listed here with
  `status: active`; a goal issue without a registry entry is display-only
  (visible on the site, never selected from).
- **Selection** (`scripts/obot-auto` pre-flight + `session-init --auto`):
  resolve slug via the registry, fetch the goal issue's sub-issues live, then
  **rank members by judgment** — boundary prose, #18 eligibility criteria,
  stages, labels; sub-issue list order carries no priority semantics
  (@jwildfire, #53 v2). Registry `backlog` repos are the secondary feed.
  Never outside the grant matrix.

## Semantics

- **Pausing** a goal is a one-line `status: paused` registry edit; **retiring**
  one is closing its hub issue plus removing the registry entry (removal needs
  @jwildfire's approval, as everywhere).
- The registry sits inside the policy-file carve-out (with
  [`scripts/policy.json`](../scripts/policy.json)): **PRs touching `goals/`
  always wait for @jwildfire**, even at autonomy level A1. Since 2026-08-15
  `obot-merge` enforces that itself — it reads the PR's changed files and
  refuses without his sign-off flag, rather than trusting a session to have
  read this line.
- **Autonomous sessions never edit goal issues** — not the body, not the
  sub-issue links. Membership changes are proposed as comments on the goal
  issue for @jwildfire to apply (the weekly goal review, hub #87, formalizes
  this). This keeps `--auto` from consuming a goal it widened itself; the
  mechanical backstops remain the per-repo profiles in
  [`scripts/policy.json`](../scripts/policy.json) and this carve-out.
- The registry's per-goal **`grant_profile`** is a *goal*-level field and is
  distinct from a *repo*-level profile (`auto` / `protected`) in
  `scripts/policy.json`. Nothing reads `grant_profile` today; a repo's
  authority comes from its own policy entry, never from the goal that selected
  it.

---

History: goal *files* (`charts.md`, `app.md`) lived here 2026-07-22 → 07-24
(#18 O2); migrated to hub issues [#78](https://github.com/jwildfire/obot.roadmap/issues/78)
and [#79](https://github.com/jwildfire/obot.roadmap/issues/79) per #53/#71.
