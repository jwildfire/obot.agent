# obot.agent Entrypoint

Read [`AGENTS.md`](AGENTS.md) first — the overlay contract and program rules. Then reach
for the relevant skill in `skills/`:

**Renderer migration**

- `requirements-harvesting` — extract functional requirements from legacy wikis/schemas into atomic matrix rows
- `gxp-test-framework` — design/review the required test layers and evidence model
- `renderer-modernization` — sequence a legacy renderer's migration (matrix → baseline → extract → replace)
- `chartjs-migration` — replace Webcharts rendering with Chart.js; fit assessment and adapter pattern
- `p004-test-setup` / `p004-write-tests` / `p004-test-driver` — the bounded test-driver lane: verify reviewed matrix rows, then write Vitest/Playwright tests from them

**Session lifecycle** (any working session in the obot2 workspace)

- `session-init` — open: sweep the evidence, persist the prioritized list
- `session-note` / `session-todo` / `session-update` / `session-scaffold` — mid-session: notes, the running list, additions, scaffold candidates
- `session-dashboard` — open the live session dashboard in Chrome (starts the watch loop if needed)
- `session-wrapup` — close: collect → discuss → apply, ending in the diary entry + session report

**Tools**

- [`tools/session-hub/`](tools/session-hub/README.md) — the session dashboard: live view (`--watch`) + frozen wrapup report (`--report`); hub requirement [#24](https://github.com/jwildfire/obot.roadmap/issues/24)

**Identity and stakeholder input**

- `obot-identity` — act as `obotclaw[bot]`: token minting, git/gh patterns for bot-attributed work
- `stakeholder-interview` — capture Jeremy's decisions through Telegram and land them in durable artifacts

Live program status (active renderers, reviews, what's next):
[obot.roadmap](https://github.com/jwildfire/obot.roadmap) ·
[site](https://jwildfire.github.io/obot.roadmap/). Tiers of agent execution:
[`docs/terminology.md`](docs/terminology.md).
