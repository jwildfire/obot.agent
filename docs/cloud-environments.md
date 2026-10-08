# Cloud environments

> Parked on 2026-10-07. Sessions run locally for now, from @jwildfire's workspace on his
> own machines, where they write to GitHub as obotclaw[bot]. This page is kept for when
> cloud sessions resume and describes nothing that is running today. Two things here are
> unsolved and are the reason for parking: a cloud session acts as the account that
> connected it, which is @jwildfire's and is admin on every repository, and the bot's
> key cannot be placed in a sandbox without giving it to everything that runs there.

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

The standards and the skills are cloned into the sandbox so a session can read them as
files and run each procedure as a skill:

```bash
# Standards: the hub's docs, readable at ~/obot.roadmap/docs/
git clone --depth 1 https://github.com/jwildfire/obot.roadmap.git "$HOME/obot.roadmap"
# The skills, installed as user skills: requirement-session and release-notes.
# From `stable`, the released branch, which changes only on @jwildfire's approving
# review - never `main`, where a merge would reach every environment on its next start.
git clone --depth 1 --branch stable https://github.com/jwildfire/obot.agent.git "$HOME/obot.agent"
mkdir -p "$HOME/.claude/skills"
for skill in requirement-session release-notes; do
  [ -d "$HOME/obot.agent/skills/$skill" ] || { echo "skill $skill is not in the stable release" >&2; continue; }
  ln -sfn "$HOME/obot.agent/skills/$skill" "$HOME/.claude/skills/$skill"
done
```

The two skills are linked by name. A loop over everything under `skills/` would install
whatever directory a later change added there. `release-notes` reaches `stable` with
v0.6.0; until then the script says it is missing and links the other.

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
3. `ls ~/obot.roadmap/docs ~/.claude/skills/requirement-session ~/.claude/skills/release-notes` — the standards and the skills
   are on disk.

## Release-candidate review

Every release candidate is reviewed before @jwildfire sees it by three independent review
subagents the session spawns itself (developer guidelines → Releases). The review runs
inside the session, so nothing is installed, nothing is billed separately, and no person
has to launch it.

## Idle and expiry

A cloud session's VM is reclaimed after a period of inactivity. A session waiting on
@jwildfire idles; the question it is waiting on is on the blocked issue, so nothing is
lost — the next session reads it there. `/goal` survives a resume, so a reclaimed session
picked up again continues toward the same condition.

The one thing that is lost with the container is its transcript store, the only record
of what the session cost. A cloud session has to publish that itself, by running the
hub's `scripts/usage/publish_session_usage.sh` at its nightly comment and at close; the
analytics page's Cost section carries cloud sessions only through that step. The
`requirement-session` skill had the step in §6 and §8 until cloud sessions were parked,
and it goes back in when they resume.
