# obot.agent

The core of the obot program's semi-autonomous approach: the skill a working session
runs, the routine that reports on every goal, and the cloud environments the sessions run
in. Standards — the issue contract, ways of working and developer guidelines — live in
[jwildfire/obot.roadmap](https://github.com/jwildfire/obot.roadmap/tree/main/docs), and
[`AGENTS.md`](AGENTS.md) makes complying with them the first rule.

## How work runs

Since 2026-09-10 the program runs as goal-based sessions: one clearly defined goal per
session, running in the cloud for as long as the goal takes, steered by @jwildfire
through the issues on the hub. The plan that installed the model and the five goals it
runs is [Goal Sessions: the Mid-October Plan](https://jwildfire.github.io/obot.roadmap/reports/goal-sessions-plan-2026-09-10/).

| What | Where |
|---|---|
| The rules a session follows | [`AGENTS.md`](AGENTS.md) — three rules, and how a session uses Claude Code |
| The procedure from goal issue to closing comment | [`skills/goal-session/SKILL.md`](skills/goal-session/SKILL.md) |
| The nightly standup, rendered from GitHub | [`routines/standup.md`](routines/standup.md) |
| Where sessions run and what installs there | [`docs/cloud-environments.md`](docs/cloud-environments.md) |
| The issue contract, ways of working, developer guidelines | [obot.roadmap `docs/`](https://github.com/jwildfire/obot.roadmap/tree/main/docs) |
| Live program status | [roadmap site](https://jwildfire.github.io/obot.roadmap/) |

## Releases

Overlay releases are tagged `vX.Y.Z` from the lagging `stable` branch by a
`main → stable` release-candidate PR that @jwildfire reviews; notes are drafted in
[`NEWS.md`](NEWS.md) and published verbatim. See the
[releases page](https://github.com/jwildfire/obot.agent/releases). The fully autonomous
prototype this replaced was retired in v0.5.0; the v0.4.0 tag and the git history are
its archive.
