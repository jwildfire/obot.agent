<!-- STATUS: Posted to https://github.com/jwildfire/obot.agent/pull/67 on 2026-07-29 -->
<!-- GITHUB_PROPERTIES: Assignee: @jwildfire -->

## Summary

Adds a **Refresh analytics usage data** bullet to `session-wrapup` step 7: regenerate the hub Analytics page's Cost data (`python3 obot.roadmap/scripts/build_usage_data.py`) at post time, so the refreshed `site/usage/usage.json` commits together with the diary entry under the standard-update grant.

Closes #66

## Roadmap context

The [Analytics page](https://jwildfire.github.io/obot.roadmap/analytics/index.html) shipped 2026-07-25 with its Cost data built from this machine's local transcripts and committed — the daily deploy cron can only re-render the last committed data, so the page froze at the ship-day snapshot. @jwildfire's decision (2026-07-29): the wrapup is the heartbeat, chosen over a launchd job or leaving it manual.

## Evidence

- Manual refresh that motivated this: [obot.roadmap@46817bd](https://github.com/jwildfire/obot.roadmap/commit/46817bd60b7889630cb9a9bfab1999d6022a5045) brought the data current through 07-29; the deployed page now shows it.
- The one changed skill section: [`skills/session-wrapup/SKILL.md`](https://github.com/jwildfire/obot.agent/blob/wrapup-usage-refresh/skills/session-wrapup/SKILL.md) step 7, between **Session report** and **Post**.

## Tech briefing

- `build_usage_data.py` resolves its output path from its own location (`__file__`), so the workspace-root invocation in the skill writes `obot.roadmap/site/usage/usage.json` regardless of cwd.
- The bullet sits before **Post** so the refreshed file rides the diary-entry commit and one deploy renders both.
- The `--auto` variant runs step 7 in full, so autonomous wrapups inherit the refresh with no extra wording.
- Accepted limit (recorded in #66): refresh cadence = wrapup cadence; sessions that end without a wrapup leave the page stale until the next one.

## Next steps

- Merge via `obot-merge` on your approval (obot.agent merges to `main`).
- After merge, `git pull` in the main `obot.agent` clone so the workspace-symlinked skill serves the new step.

---

This PR was drafted by Claude Code using Fable 5 and reviewed by @jwildfire
