---
name: obot-identity
description: "Use when an agent action should be attributed to the obot automation identity (obotclaw[bot]) rather than @jwildfire, when deciding which of the two identities applies, or when naming/colouring a session (lead, sibling, ultracode, --auto) and pinning the lead in the agents view. Covers minting installation tokens with scripts/obot-app-token, the git/gh usage patterns for bot-attributed commits, pushes, issues, and PRs, and the session naming conventions."
---

# obot Identity Skill

Use when an agent action should be attributed to the obot automation identity
(`obotclaw[bot]`) rather than @jwildfire — or when deciding which of the two identities
applies. Covers minting tokens with `scripts/obot-app-token` and the git/gh usage patterns.

## Which identity, when

| Actor | Identity |
|---|---|
| Jeremy acting himself: his comments, reviews, sign-offs, merges | **@jwildfire** — existing `gh` auth, unchanged |
| Agent-authored development work: commits, branch pushes, and the PRs the agent drafts — working sessions included (Jeremy's call, 2026-07-09; first: safety.viz#11) | **obotclaw[bot]** — token from `obot-app-token`, bot-attributed commits below |
| Automation acting on its own (scheduled workflows, cross-repo rollups, bot status comments) | **obotclaw[bot]** — same |

The AGENTS.md attribution convention (drafted-by line in the body) applies to the *content*
of issues, PRs, and comments regardless of which identity posts them. Jeremy still reviews
and merges as @jwildfire — the bot authors the work; it never approves or merges it.

## Session identity and naming

Who a session *is*, in the terminal and in the `claude agents` view. This is
**housekeeping, not startup** — it never sits ahead of a bookend's first paint (see
[`docs/session-framework.md`](../../docs/session-framework.md)).

- **Names and colours**:
  - lead / main session — `😺🤖 {YYYY-MM-DD} {session # (only if > 1 that day)}`, **orange**
  - spawned siblings — `👯🤖 {date} {slug}`, **green** (@jwildfire, 2026-07-11)
  - ultracode / Workflow jobs — `⚡️🤖 {description}`, description-based, no date (2026-07-12)
  - `--auto` autonomous sessions — `🦾🤖 {YYYY-MM-DD} {slug}`, **purple**
- **Setting them**: interactive sessions use the built-in `/name` and `/color` slash
  commands, which the model **cannot run** — remind @jwildfire to type them if the session
  isn't named yet. A background session sets `name` and `color` directly in its own
  `~/.claude/jobs/{id}/state.json`.
- **Pinning the lead**: the lead pins itself to the top of the `claude agents` view by
  appending its own job id to `~/.claude/jobs/pins.json` — the view's persistent pin store,
  a plain JSON array of job ids. Manually-added entries render as pinned and survive view
  restarts (verified live 2026-07-24). While editing, drop ids that no longer have a
  `~/.claude/jobs/{id}` directory (inert pins from deleted jobs). Siblings stay unpinned so
  the pinned group stays the lead-session lane; `ctrl+T` in the view remains for ad-hoc
  pins (@jwildfire, 2026-07-23).

### Attribution mechanics (D2, resolved 2026-07-11)

`obotclaw[bot]` is the **git author** of agent-authored commits, AND commits keep the
agent `Co-Authored-By` trailer (e.g.
`Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`). This is an explicit, documented
divergence-plus-extension of gsm.agent's trailer-only attribution convention: upstream
attributes via the trailer alone, while here the bot takes authorship and the trailer stays
so the drafting model remains visible. The drafted-by body line convention is unchanged.

## The app, in one paragraph

`obotclaw` is a GitHub App owned by @jwildfire (App ID 4215246, installation 144370633),
installed only on the whitelisted portfolio repos: obot.roadmap, obot.agent, safety.viz,
gsm.safety, safety-histogram. Tokens are installation tokens — 1-hour TTL, capped at the
app's permissions (Contents/Issues/PRs/Discussions/Workflows RW, Actions read, Metadata).
The private key never leaves the macOS Keychain (service `obot-github-app`). Design:
obot.roadmap#3, `requirements/design/3_design.html`.

## Usage patterns

Mint fresh per command — tokens are short-lived by design; never store one:

```bash
# API calls, issues, PRs, comments — as the bot
GH_TOKEN=$(obot-app-token) gh api ...
GH_TOKEN=$(obot-app-token) gh issue comment 3 -R jwildfire/obot.roadmap --body "..."

# git push as the bot
git push "https://x-access-token:$(obot-app-token)@github.com/jwildfire/<repo>.git" <branch>
```

Bot-attributed commits (user ID 299836032 is fixed — look-up not needed):

```bash
git -c user.name='obotclaw[bot]' \
    -c user.email='299836032+obotclaw[bot]@users.noreply.github.com' commit ...
```

In GitHub Actions, do not use this script — use `actions/create-github-app-token@v2` with
the `OBOT_APP_ID` / `OBOT_APP_PRIVATE_KEY` repo secrets instead.

## Failure modes

- `no Keychain item` — the key isn't seeded on this machine; see the script header for the
  `security add-generic-password` seed command (requires the PEM, which only Jeremy can
  regenerate from the app settings page).
- `token mint failed` + 401 — clock skew or a rotated/revoked key; regenerate via
  https://github.com/settings/apps/obotclaw.
- Token works but a repo 404s — the repo isn't in the installation whitelist; adding it is
  a one-click owner action on the installation page (never switch to "all repositories").
