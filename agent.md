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

- `session-init` — open: paint the carried hand-off immediately, then delegate the delta + ideas sweep to one sibling
- `session-note` / `session-todo` / `session-update` / `session-scaffold` — mid-session: notes, the running list, additions, scaffold candidates
- `session-idea` — file an idea to the hub's Ideas queue for triage (capture; `session-inbox` triages)
- `session-spawn` — fork work to a background sibling (the delegation primitive)
- `session-reviews` — spawn a reviewer that walks @jwildfire through the PRs waiting on his decision
- `session-dashboard` — open the live session dashboard in Chrome (starts the watch loop if needed)
- `session-prime` — run as 🎩🤖 obot-prime, the standing Q&A concierge (launched by `scripts/obot-prime`): answers fast from warm sources, delegates everything slower, never builds
- `session-wrapup` — close: draft the checkpoint from the scratchpad, verify in a sibling during review, then apply

Every session command answers to the responsiveness contract in
[`docs/session-framework.md`](docs/session-framework.md) — first paint in under a minute,
<= 2 lead round trips, anything longer delegated.

Every `session-*` skill answers to a short `/s-*` alias as well — `/s-init`,
`/s-todo`, `/s-idea`, `/s-reviews`, … Both forms load the same skill; see
[`commands/`](commands/) and [`scripts/session-aliases`](scripts/session-aliases).

**Tools**

- [`tools/session-hub/`](tools/session-hub/README.md) — the session dashboard: live view (`--watch`) + frozen wrapup report (`--report`); hub requirement [#24](https://github.com/jwildfire/obot.roadmap/issues/24)

**Identity and stakeholder input**

- `obot-identity` — act as `obotclaw[bot]`: token minting, git/gh patterns for bot-attributed work
- `stakeholder-interview` — capture Jeremy's decisions through Telegram and land them in durable artifacts

Live program status (active renderers, reviews, what's next):
[obot.roadmap](https://github.com/jwildfire/obot.roadmap) ·
[site](https://jwildfire.github.io/obot.roadmap/). Tiers of agent execution:
[`docs/terminology.md`](docs/terminology.md); the responsiveness contract:
[`docs/session-framework.md`](docs/session-framework.md).
