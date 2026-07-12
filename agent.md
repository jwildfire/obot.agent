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
- `session-note` / `session-todo` / `session-update` — mid-session: notes, the running list, additions
- `session-wrapup` — close: collect → discuss → apply, ending in the diary entry

**Identity and stakeholder input**

- `obot-identity` — act as `obotclaw[bot]`: token minting, git/gh patterns for bot-attributed work
- `stakeholder-interview` — capture Jeremy's decisions through Telegram and land them in durable artifacts

Live program status (active renderers, reviews, what's next):
[obot.roadmap](https://github.com/jwildfire/obot.roadmap) ·
[site](https://jwildfire.github.io/obot.roadmap/). Tiers of agent execution:
[`docs/terminology.md`](docs/terminology.md).
