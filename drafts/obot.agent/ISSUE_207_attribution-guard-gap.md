<!-- STATUS: Posted to https://github.com/jwildfire/obot.agent/issues/207 on 2026-08-18 01:02 EDT -->
<!-- GITHUB_PROPERTIES: Milestone: v0.5.0, Labels: bug -->

## What happened, once, tonight

`gh issue edit 200` went out as **@jwildfire**. Nobody typed a command intending that, and the attribution guard allowed it.

The command was the documented form:

```
GH_TOKEN=$(obot.agent/scripts/obot-app-token) gh issue edit 200 -R jwildfire/obot.agent --body-file …
```

The path is relative, the shell had reset its working directory, so the substitution failed with `no such file or directory` on stderr — and `GH_TOKEN` was set to the empty string. `gh` treats an empty `GH_TOKEN` as absent and falls back to the keyring, so the write went out on @jwildfire's credential.

Verified from the primary record rather than inferred:

```
gh api graphql … issue(number:200){ userContentEdits }
  edit by jwildfire at 2026-08-18T04:58:53Z     <- the failed mint
  edit by obotclaw  at 2026-08-18T04:46:52Z
  edit by obotclaw  at 2026-08-18T04:46:13Z
```

The two earlier edits, from the same session with the same intent, are correctly the bot. Only the one whose mint failed is his.

## Why the guard let it through

`hooks/attribution-guard.sh`, `EXPLICIT_TOKEN`:

```python
EXPLICIT_TOKEN = re.compile(r"""^\s*\(?\s*(?:\w+=\S*\s+)*(?:GH_TOKEN|GITHUB_TOKEN)=""")
```

with the reasoning above it: *"a token from anywhere else is a choice someone made on purpose, in writing, that can be read back later. Either way the identity question was faced."*

That is right about the text and cannot be right about the outcome. The guard is a PreToolUse hook: it sees the command string before anything runs, so it sees `GH_TOKEN=$(…)` and reads a deliberate statement of identity. It cannot see that the substitution will exit non-zero and leave the variable empty. The one shape that reliably produces a misattributed write is the shape the guard is most confident about.

This is not the `gh auth token` laundering case the guard already denies by name. It is the opposite: a correct command that fails open.

## Why it matters beyond one edit

The requirement this guard was built for ([#197](https://github.com/jwildfire/obot.agent/issues/197)) exists because roughly a hundred structural events are recorded as @jwildfire having done them. A guard that denies the wrong form but passes the right form when it silently fails leaves the count growing, and leaves it growing specifically on the commands written by agents who were doing it correctly.

It is also the house failure mode in miniature — an operation reporting success while doing something other than what it said. The mint printed its error to stderr, the write returned a URL, and the only way to find out was to query GitHub afterwards.

## What would close it

- The mint must fail the write, not the variable. `obot-app-token` printing nothing should stop the command rather than degrade it — a non-empty check before the `gh` call, or a wrapper that mints and execs so a failed mint is a failed exec.
- `obot-gh` is the obvious home for this and already exists in [#198](https://github.com/jwildfire/obot.agent/pull/198). If it mints internally and refuses on an empty token, the whole class disappears and the guard's job becomes routing rather than judging.
- Until then, the guard could treat a bare `GH_TOKEN=$(…)` as insufficient on its own and require the wrapper — a stricter rule that costs a little friction and removes the failure open.

Found while filing sub-issues for [obot.roadmap#238](https://github.com/jwildfire/obot.roadmap/issues/238). The one misattributed edit is recorded here rather than quietly corrected, because an edit cannot be re-attributed after the fact and the record should say who actually made it.

---

Filed by 👯🤖 W0045 (Claude Code using Opus 5), whose own command caused the instance above. Not reviewed by @jwildfire.
