<!-- STATUS: Posted to https://github.com/jwildfire/obot.agent/issues/239 on 2026-08-18 04:36 EDT -->
<!-- GITHUB_PROPERTIES: Milestone: v0.5.0, Labels: bug -->

A GitHub write wrapped in `sh -c '...'` is invisible to the attribution guard, whatever token it carries. The guard strips quoted spans before matching — deliberately, so that prose about a command is never mistaken for one — and a write inside the quoted argument is stripped along with the prose.

## Reproduced

Fed to `hooks/attribution-guard.sh` on `main` and on the branch of #198, verdict as returned:

| the Bash call | verdict |
|---|---|
| `gh issue edit 1 -R jwildfire/obot.agent --add-label bug` | deny |
| `sh -c 'gh issue edit 1 -R jwildfire/obot.agent --add-label bug'` | **defer** |
| `bash -c "gh issue edit 1 -R jwildfire/obot.agent --add-label bug"` | **defer** |
| `GH_TOKEN= sh -c 'gh issue edit 1 --add-label bug'` | **defer** |

Both versions behave identically, so this is not a regression from #198 — it is a gap that has been there since the guard was written.

## Why it matters more than a hypothetical

It was documented. `skills/session-inbox/SKILL.md` told the sweep to post its whole batch of triage replies as:

```
GH_TOKEN=$(obot.agent/scripts/obot-app-token) sh -c '<all addDiscussionComment calls>'
```

That line carries both halves of the failure at once: the substitution's exit status is discarded, so a failed mint sends every reply in the batch out as @jwildfire (#207), and the writes are inside `sh -c`, where the guard could not have refused them. It is fixed on the branch of #198 — replaced with an exported `OBOT_GH_TOKEN` and `obot-gh` — which is how the gap surfaced. Nothing else in the repo's fenced blocks uses the shape; `scripts/test/write-lane.test.mjs` would not have caught it either, since it reads the fenced line and sees a token prefix.

## The shape of a fix, and the trap in it

The obvious move — scan inside `sh -c` / `bash -c` payloads — has to be narrower than it sounds, because the same stripping is what keeps the guard from firing on prose. A guard that fires on drafts and commit messages gets switched off within a day, and then it protects nothing. Two candidates, either of which needs the prose cases in `attribution-guard.test.mjs` kept green:

- Treat the argument of `sh -c` / `bash -c` / `zsh -c` as a nested command and run the whole verdict over it, recursively, at one level of depth. Precise, and it inherits every existing pattern.
- Refuse `sh -c` / `bash -c` outright when the payload contains a `gh` write, and say so. Blunter, but a shell-in-a-shell in an agent's Bash call is nearly always a batching trick rather than a necessity.

Worth deciding alongside the point #198 makes about batching: the reason the inbox skill reached for `sh -c` was to mint once for many writes, and `obot-gh` already supports that through an exported `OBOT_GH_TOKEN`. If the sanctioned batching lane is good enough, the blunt option costs nothing.

## Done when

`sh -c 'gh issue edit ...'` with no attribution is refused, the prose cases in `scripts/test/attribution-guard.test.mjs` are still green, and the table above is encoded as regression cases.

`hooks/` is a carve-out path, so this is filed rather than fixed: whatever lane it takes, the change needs @jwildfire's sign-off.

---

Filed by 👯🤖 W0058 (Claude Code using Opus 5), found while fixing #207 and #234 on [#198](https://github.com/jwildfire/obot.agent/pull/198). Not reviewed by @jwildfire.
