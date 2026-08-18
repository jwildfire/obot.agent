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
  - spawned siblings — `👯🤖 {W-id} {date} {slug}` (e.g. `👯🤖 W0042 2026-08-16 workerids`),
    **green** (@jwildfire, 2026-07-11; the W-id added 2026-08-16). The id is claimed by
    `tools/worker-id` before the spawn and is permanent — never reused, not even after the
    worker dies. It goes first because it must survive truncation in a narrow `claude agents`
    row, and because the counter is monotonic, sorting by id sorts chronologically anyway.
  - ultracode / Workflow jobs — `⚡️🤖 {description}`, description-based, no date (2026-07-12)
  - `--auto` autonomous sessions — `🦾🤖 {W-id} {YYYY-MM-DD} {slug}`, **purple** (the
    autonomous lead writes as obotclaw[bot] like any other agent, so it is a worker and
    carries an id too)
  - obot-prime concierge — `🎩🤖 obot-prime`, no date (standing singleton, launched by
    `scripts/obot-prime`; contract in
    [`session-prime`](../session-prime/SKILL.md)), **blue**
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

That trailer turns out to be load-bearing for detection as well as for credit: it is the
one thing @jwildfire never writes, so a commit carrying it whose author is not the bot is
provably mis-attributed, with no way to false-positive on his own work. 110 commits
authored as him carry one; 87 authored as him carry none, and those 87 are his. Keep
writing it, and keep writing the `Worker: {W-id}` trailer beside it.

## The app, in one paragraph

`obotclaw` is a GitHub App owned by @jwildfire (App ID 4215246, installation 144370633),
installed on a whitelist of his own repos — twelve as of 2026-08-18, covering every active
one: obot.roadmap, obot.agent, safety.viz, gsm.safety, open.gismo, open.csr, demo-301,
safety-histogram, scaffold, cv, jwildfire.github.io, RPharma2026-AIKeynote. Ask rather than
remember: `GH_TOKEN=$(obot-app-token) gh api /installation/repositories`. This line read
"five" until 2026-08-18, three repos after it stopped being true. Tokens are installation
tokens — 1-hour TTL, capped at the
app's permissions (Contents/Issues/PRs/Discussions/Workflows RW, Actions read, Metadata).
The private key never leaves the macOS Keychain (service `obot-github-app`). Design:
obot.roadmap#3, `requirements/design/3_design.html`.

## Usage patterns

Mint fresh per command — tokens are short-lived by design; never store one:

```bash
# API calls, issues, PRs, comments — as the bot
GH_TOKEN=$(obot-app-token) gh api ...
GH_TOKEN=$(obot-app-token) gh issue comment 3 -R jwildfire/obot.roadmap --body "..."

# git push as the bot — the wrapper, not the URL
obot.agent/scripts/obot-push          # current branch; add -u to set upstream
```

`obot-push` exists because every remote here is SSH, so a plain `git push` authenticates
as @jwildfire whatever token is set — no token fixes it. It mints, refuses on an empty
token instead of falling through to his keyring, refuses a remote outside the jwildfire
org, and refuses `--force` and `--delete`. The SSH remote is deliberately left alone so
his own pushes stay his.

### The commit identity is resolved, never typed

**Do not type the user id.** Take it from `tools/lib/identity.mjs`:

```js
import { identityEnv, identityArgs, BOT_EMAIL } from '../lib/identity.mjs'
execFileSync('git', ['commit', '-m', msg], { env: identityEnv(process.env) })
execFileSync('git', [...identityArgs(), 'commit', '-m', msg])
```

From a shell, where the module is out of reach, the id-less form is the safe one — it
links to the bot and has no number in it to get wrong:

```bash
git -c user.name='obotclaw[bot]' -c user.email='obotclaw[bot]@users.noreply.github.com' commit ...
```

This section used to read "user ID 299836032 is fixed — look-up not needed", with the
correct number beside it. Counting every commit in the seven active checkouts on
2026-08-18 found thirty-eight distinct wrong ids across 301 commits anyway — one of
them reading `223456789`, twenty-six of them belonging to real GitHub accounts. A wrong id
still renders the right name in `git log` and in the GitHub UI, and links to nobody, so
the failure is invisible exactly where someone would check. Documenting the number more
emphatically has been tried; it is not what fixes this (obot.agent#241,
jwildfire/obot.roadmap#260).

The five-minute Navigator sweep reports any commit carrying a `Co-Authored-By: Claude …`
or `Worker:` trailer whose author does not link to the bot, under `## Commit identity` in
`navigator-state.md`.

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
