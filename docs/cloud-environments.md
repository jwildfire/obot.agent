# Cloud environments

Every requirement session is a [Claude Code cloud session](https://code.claude.com/docs/en/claude-code-on-the-web)
bound to the repository where the objective's tasks live, running in a
[cloud environment](https://code.claude.com/docs/en/cloud-environments) configured at
claude.ai/code. Nothing runs on a person's machine unattended, and nothing is bridged
through Remote Control.

## The environments

One per repository the objectives touch. Each is created once in the environment selector at
claude.ai/code; the setup script is cached, so the toolchain installs once per
environment version.

| Environment | Repository | Used for | Setup script installs | Network |
|---|---|---|---|---|
| `safety.viz` | jwildfire/safety.viz | execution sessions (Ready → In session → Review) | Node 24, `npm ci`, Playwright's Chromium, the standards and the skill (below) | trusted allowlist |
| `gsm.safety` | jwildfire/gsm.safety | execution sessions | R, `pak`, the package's dependencies from `DESCRIPTION`, the pharmaverse data packages, the standards and the skill | trusted allowlist plus CRAN and the pharmaverse mirrors |
| `obot.roadmap` | jwildfire/obot.roadmap | prep sessions (Backlog → Ready, with @jwildfire) — the hub's `requirement-*` skills are in the clone | Node 24 for the site scripts, the skill | trusted allowlist |

## The common tail of every setup script

The standards and the skill are cloned into the sandbox so a session can read them as
files and run the procedure as a skill:

```bash
# Standards: the hub's docs, readable at ~/obot.roadmap/docs/
git clone --depth 1 https://github.com/jwildfire/obot.roadmap.git "$HOME/obot.roadmap"
# The requirement-session skill, installed as a user skill
git clone --depth 1 https://github.com/jwildfire/obot.agent.git "$HOME/obot.agent"
mkdir -p "$HOME/.claude/skills"
ln -sfn "$HOME/obot.agent/skills/requirement-session" "$HOME/.claude/skills/requirement-session"
```

Each repository's own `CLAUDE.md` stays short and points at the same three documents;
the block the hub's developer guidelines ask every repository to carry is:

```markdown
# Standards
The obot program's standards are mandatory here: the issue contract, ways of working and
developer guidelines in jwildfire/obot.roadmap `docs/` (on disk at ~/obot.roadmap/docs/
in a cloud environment). Work runs one requirement per session (`/requirement-session <hub requirement>`).
```

## Credentials

- GitHub access comes with the cloud session — the Claude GitHub App or the `gh` token
  synced with `/web-setup`. It can reach any repository the connecting account can see,
  so cross-repository writes (a task in gsm.safety, a comment on the hub) need nothing
  extra.
- Any other API key is a proxy-held API credential on the environment, never an
  environment variable: variables are readable by anyone who uses the environment, a
  credential is attached by the proxy and never visible to the session.

## Verify before depending on it

Run one throwaway session in each environment before a requirement session starts there:

1. `/goal the file VERIFY.md exists in the repository root with today's date in it` —
   confirms the goal command arms in a cloud session and the evaluator sees the result.
   Delete the file afterwards.
2. In `gsm.safety`: `Rscript -e 'devtools::check()'` completes inside the environment
   — confirms R and the dependencies installed within the setup's limits. If they do
   not, the fallback is a routine that runs the R checks in GitHub Actions while the
   session edits, or a single local session for that lane only.
3. `ls ~/obot.roadmap/docs ~/.claude/skills/requirement-session` — the standards and the skill
   are on disk.

## Ultrareview

Every release candidate gets an ultrareview before @jwildfire sees it (developer guidelines →
Releases). It runs on Claude Code on the web from any session signed in to his claude.ai
account, bills as usage credits after the free runs, and needs usage credits turned on for
the account (`/usage-credits`). Nothing else to install.

## Idle and expiry

A cloud session's VM is reclaimed after a period of inactivity. A session waiting on
@jwildfire idles; the question it is waiting on is on the blocked issue, so nothing is
lost — the next session reads it there. `/goal` survives a resume, so a reclaimed session
picked up again continues toward the same condition.

The one thing that is lost with the container is its transcript store, the only record
of what the session cost. The session publishes that itself, at its nightly comment and
at close (`requirement-session` §6 and §8), by running the hub's
`scripts/usage/publish_session_usage.sh`; the analytics page's Cost section carries
cloud sessions only through that step.
