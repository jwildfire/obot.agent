<!-- STATUS: Posted to https://github.com/jwildfire/obot.agent/issues/66 on 2026-07-29 -->
<!-- GITHUB_PROPERTIES: Assignee: @jwildfire -->

## Problem

The hub's [Analytics page](https://jwildfire.github.io/obot.roadmap/analytics/index.html) renders its Cost section from `site/usage/usage.json` — a committed artifact built from this machine's local Claude Code transcripts by `obot.roadmap/scripts/build_usage_data.py`. The site deploy cannot regenerate that data (the transcripts exist only locally), so the daily deploy cron just re-renders whatever was last committed.

In practice the data was committed once when the Cost section shipped (2026-07-25) and sat frozen until a manual refresh on 2026-07-29 (jwildfire/obot.roadmap@46817bd). Nothing in the session framework owns keeping it current.

## Decision

@jwildfire (2026-07-29): the session wrapup is the heartbeat — fold the refresh into `session-wrapup` rather than adding a launchd job or leaving it manual.

## Change

Add a **Refresh analytics usage data** bullet to step 7 of `skills/session-wrapup/SKILL.md`: run `build_usage_data.py` at post time and commit the refreshed `usage.json` together with the diary entry under the standard-update grant. The `--auto` variant inherits it for free, since it runs step 7 in full.

Known limit, accepted with the decision: the data only refreshes when a session wraps, so a stretch of sessions ending without a wrapup leaves the page stale until the next one.

---

This Issue was drafted by Claude Code using Fable 5 and reviewed by @jwildfire
