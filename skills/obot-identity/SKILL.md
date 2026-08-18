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

Every `gh` write goes through the wrapper. It mints a fresh token, runs the command
under it, and stores nothing:

```bash
obot.agent/scripts/obot-gh issue edit 197 -R jwildfire/obot.agent --add-label bug
obot.agent/scripts/obot-gh issue create -R jwildfire/obot.roadmap --title "..." --body-file draft.md
obot.agent/scripts/obot-gh api -X POST /repos/jwildfire/obot.roadmap/issues/215/sub_issues -F sub_issue_id=123
obot.agent/scripts/obot-gh --who        # prints obotclaw[bot]
```

The wrapper is not a convention to remember. `hooks/attribution-guard.sh` refuses a
GitHub write that is about to run on the ambient token and names the wrapper in the
refusal — see [Why the wrapper exists](#why-the-wrapper-exists-obotagent197) below.

Mint the token directly only where the wrapper cannot reach — inside a script doing many
writes. Tokens are short-lived by design; never store one:

```bash
# git push as the bot — the wrapper, not the URL
obot.agent/scripts/obot-push          # current branch; add -u to set upstream

# inside a script doing many writes: mint once, and the wrapper reuses it
export OBOT_GH_TOKEN=$(obot-app-token)
```

`obot-push` exists because every remote here is SSH, so a plain `git push` authenticates
as @jwildfire whatever token is set — no token fixes it. It mints, refuses on an empty
token instead of falling through to his keyring, refuses a remote outside the jwildfire
org, and refuses `--force` and `--delete`. The SSH remote is deliberately left alone so
his own pushes stay his.

One consequence worth knowing before it costs you a detour: a branch the wrapper has
already pushed cannot be rebased and re-pushed through it, because that needs a force.
Merge the integration branch into your branch instead — which is the right flow here
anyway, since every PR is squashed. The refusal stays deliberately: an escape hatch on a
force-push tool gets used once for a good reason and then always
(🧭🤖 obot-navigator, 2026-08-18).

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

## Why the wrapper exists (obot.agent#197)

For two days every structural roadmap edit — labels, milestones, sub-issue links, project
additions, board moves — was attributed to @jwildfire's own account, across roughly a
hundred issues he had not read. Issue and comment *bodies* were correct, because the app
token was passed to `gh issue create`; the pattern was never carried to anything else, and
the ambient `gh` token authenticates as him.

It was sharpest on hub#215 — the requirement about not letting an agent's inference read
as his approval — whose own timeline said he applied a label he has never seen. And it was
invisible where anyone looks: the body reads `obotclaw`, only the timeline disagrees, and
nobody reads a timeline unless already suspicious.

The mechanism was never in doubt. What was missing is that it cannot be forgotten, so the
fix is a guard rather than a paragraph: two days of evidence say remembering does not work,
the same way the `bash ` prefix habit broke `obot-merge` (#162) and `ops-answers` (#180).

### The board is the one thing the bot cannot sign

A GitHub App installed on a **user** account cannot reach a user-owned ProjectsV2 board at
all. Verified 2026-08-17: the installation token gets `FORBIDDEN` — "Resource not
accessible by integration" — on the board's node id, and `NOT_FOUND` on
`user(login:"jwildfire"){projectV2(number:1)}`. It is a platform limit, not a missing flag.

So a board move has no honest bot identity available today. It is not passed through
silently: `obot-gh project ...` refuses and explains, and the only route is the explicit
`--as-jeremy`, which requires a reason, records the write to
`.claude/attribution.journal`, and says on stderr whose name it is going out under. An
invisible default becomes a counted exception.

Lifting it is @jwildfire's call — move the board to an organisation, or grant the app
project access if GitHub ever offers it for user-account installations.

## Failure modes

- `no Keychain item` — the key isn't seeded on this machine; see the script header for the
  `security add-generic-password` seed command (requires the PEM, which only Jeremy can
  regenerate from the app settings page).
- `token mint failed` + 401 — clock skew or a rotated/revoked key; regenerate via
  https://github.com/settings/apps/obotclaw.
- Token works but a repo 404s — the repo isn't in the installation whitelist; adding it is
  a one-click owner action on the installation page (never switch to "all repositories").
