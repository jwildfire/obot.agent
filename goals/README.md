# Standing goals

Goals are **hub issues**, not files, since hub #53/#71 (2026-07-24, superseding
[#18 design](https://jwildfire.github.io/obot.roadmap/requirements/design/18_design.html)
decision O2). A goal issue carries the standing **direction** of work — intent,
boundaries, membership — where the work itself is tracked; goal pages on the
hub site render them (`https://jwildfire.github.io/obot.roadmap/goals/`).

What remains here is [`registry.json`](registry.json), the **policy binding**
that `--auto` selection reads first:

```json
"goals": {
  "<slug>": { "issue": <hub issue #>, "status": "active|paused", "grant_profile": "standard" }
}
```

## How the pieces fit

- **Hub goal issue** (label `goal`, template `.github/ISSUE_TEMPLATE/goal.yml`
  in the hub) — direction + membership. Body opens with a fenced YAML block:
  `slug`, ordered `anchors` (priority feed), repo-level `backlog` refs.
  Requirement membership is mirrored as native sub-issue links. @jwildfire
  edits goal issues directly — no PR ceremony.
- **`registry.json`** (here) — slug → issue number, `status`, `grant_profile`.
  `--auto` only selects within goals listed here with `status: active`; the
  `grant_profile` names the row set in
  [`scripts/autonomy-grants.json`](../scripts/autonomy-grants.json). A goal
  issue without a registry entry is display-only (visible on the site, never
  selected from).
- **Selection** (`scripts/obot-auto` pre-flight + `session-init --auto`):
  resolve slug via the registry, fetch the goal issue live, read `anchors`
  first, then `backlog`, never outside the grant matrix — rules unchanged
  from #18.

## Semantics

- **Pausing** a goal is a one-line `status: paused` registry edit; **retiring**
  one is closing its hub issue plus removing the registry entry (removal needs
  @jwildfire's approval, as everywhere).
- The registry sits inside the policy-file carve-out (with
  `autonomy-grants.json`, `merge-policy.json`): **PRs touching `goals/` always
  wait for @jwildfire**, even at autonomy level A1.
- **Autonomous sessions never edit goal issues** — not the body, not the
  sub-issue links. Membership changes are proposed as comments on the goal
  issue for @jwildfire to apply. This keeps `--auto` from consuming a goal it
  widened itself; the mechanical backstops remain the grant matrix, the merge
  policy, and this carve-out.

---

History: goal *files* (`charts.md`, `app.md`) lived here 2026-07-22 → 07-24
(#18 O2); migrated to hub issues [#78](https://github.com/jwildfire/obot.roadmap/issues/78)
and [#79](https://github.com/jwildfire/obot.roadmap/issues/79) per #53/#71.
