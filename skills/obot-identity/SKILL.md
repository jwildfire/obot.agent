# obot Identity Skill

Use when an agent action should be attributed to the obot automation identity
(`obotclaw[bot]`) rather than @jwildfire — or when deciding which of the two identities
applies. Covers minting tokens with `scripts/obot-app-token` and the git/gh usage patterns.

## Which identity, when

| Actor | Identity |
|---|---|
| Jeremy working interactively; agent work Jeremy reviews before it posts (requirement drafting, working-session PRs, sign-offs, merges) | **@jwildfire** — existing `gh` auth, unchanged |
| Automation acting on its own; agent actions that should read as obot's (scheduled workflows, cross-repo rollups, bot status comments) | **obotclaw[bot]** — token from `obot-app-token` |

The AGENTS.md attribution convention (drafted-by line in the body) applies to the *content*
of issues, PRs, and comments regardless of which identity posts them.

## The app, in one paragraph

`obotclaw` is a GitHub App owned by @jwildfire (App ID 4215246, installation 144370633),
installed only on the whitelisted portfolio repos: obot.roadmap, safety.agent, safety.viz,
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
