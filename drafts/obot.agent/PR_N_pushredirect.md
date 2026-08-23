<!-- STATUS: Drafted on 2026-08-22 -->
<!-- GITHUB_PROPERTIES: Milestone: v0.5.0 -->

## Summary

`obot-push` decided which organisation owned a repository by reading its remote's URL text. For a repository that has been transferred, that text is stale by design and stays stale for as long as the clone lives — so it refused a write to `gsm.safety` that was correct and would have landed in the right place. The check now asks GitHub where the remote actually points and answers on that, with three outcomes rather than two: resolves inside the org, resolves outside it, cannot be resolved. Every refusal names the remote in the same clone that would accept the push, where one exists.

Closes #320

## Roadmap context

Two release candidates for `gsm.safety` — a clinical package — were held on this, because release mechanics push to that repository and `obot-push` refused there. The refusal was worse than a blocked push: an agent told "refused, with no exceptions" that still needs a branch pushed reaches for `git push`, which authenticates as @jwildfire whatever token is in the environment and is the exact path this wrapper exists to close. One three-hour window on 2026-08-18 recorded four actions in his name that way ([jwildfire/obot.roadmap#260](https://github.com/jwildfire/obot.roadmap/issues/260)).

Milestone v0.5.0, set by 🧭🤖 obot-navigator on 2026-08-22 before implementation began.

## Evidence

Three states, each proven twice — once against a stub in `scripts/test/obot-push.test.mjs`, once against live GitHub from the real clone.

**State 1 — resolves inside the org, and now pushes.** Live, in `~/Documents/obot2/gsm.safety`, whose `origin` is `git@github.com:obot-claw/gsm.safety.git`:

```
$ obot-push refs/remotes/origin/dev:refs/heads/w0122-push-proof
obot-push: obot-claw/gsm.safety redirects to jwildfire/gsm.safety — pushing there.
To https://github.com/jwildfire/gsm.safety.git
 * [new branch]      origin/dev -> w0122-push-proof
```

The same command on `main` refuses, and creates nothing:

```
$ obot-push refs/remotes/origin/dev:refs/heads/w0122-would-never-exist
obot-push: remote 'origin' is obot-claw/gsm.safety — writes outside the jwildfire org
are refused, with no exceptions. Hand the change to @jwildfire instead.
$ git ls-remote --heads origin w0122-would-never-exist | wc -l
       0
```

Attribution, from the repository's own activity feed — this is the property the wrapper exists for, and it holds through the redirect:

```
2026-08-23T00:51:15Z  branch_creation  ref=refs/heads/w0122-push-proof  actor=obotclaw[bot]
```

**State 2 — resolves outside the org, and still refuses.** Live, in `~/Documents/obot2/open.gismo`:

```
obot-push: remote 'origin' is Gilead-BioStats/open.gismo, which resolves to
Gilead-BioStats/open.gismo — writes outside the jwildfire org are refused, with no exceptions.
  Remote 'fork' in this same clone resolves to jwildfire/open.gismo, which does accept
  the push. If that is the one you meant:
    OBOT_PUSH_REMOTE=fork /path/to/obot.agent/scripts/obot-push
```

And in `~/Documents/obot2/safety-histogram`, which looks identical from the URL and is not:

```
obot-push: remote 'origin' is obot-claw/safety-histogram, which resolves to
obot-claw/safety-histogram — writes outside the jwildfire org are refused, with no
exceptions. It is also archived, so it would reject a push in any case.
  Remote 'jwildfire' here does resolve inside the jwildfire org, to
  jwildfire/safety-histogram — but that is archived too, so it cannot accept a push
  either. Hand the change to @jwildfire instead.
```

**State 3 — cannot be resolved, and refuses for a reason that says so.** Live, in the very repository that now succeeds, with the resolver taken away:

```
$ OBOT_PUSH_GH_BIN=/nonexistent/gh obot-push refs/remotes/origin/dev:refs/heads/w0122-must-not-exist
obot-push: remote 'origin' is obot-claw/gsm.safety, and where it points could not be
resolved: no '/nonexistent/gh' on PATH, so there is no way to ask where this remote points
  Refusing. An unresolvable remote is not a jwildfire remote, and a push made on a guess
  is recorded as @jwildfire permanently. Nothing was pushed.
  Remote 'jwildfire' here could not be resolved either, so whether anything in this clone
  would accept the push is unknown rather than answered. Hand the change to @jwildfire instead.
$ git ls-remote --heads origin w0122-must-not-exist | wc -l
       0
```

And against a real 404, in a scratch clone whose `origin` reads `jwildfire/no-such-repo-w0122` — a URL that passes the old text check and is refused anyway:

```
obot-push: remote 'origin' is jwildfire/no-such-repo-w0122, and where it points could
not be resolved: gh: Not Found (HTTP 404)
```

Suite: 23 tests in `scripts/test/obot-push.test.mjs`, up from 7, every new one labelled with the state it proves. `scripts/obot-test` — 1949 tests, 1947 pass; the two failures are the diary-date and unregistered-palette tests, both already red on `main` at 5665557 and untouched by this change. `scripts/obot-test policy` clean, 30 verdicts identical to the baseline.

## Technical briefing

- `scripts/obot-push` — the org check reads GitHub instead of the URL. One `gh api repos/<slug>` call returns `full_name` and `archived`; the decision is made on the resolved owner, case-insensitively, and the push goes to the resolved name rather than relying on GitHub's redirect to carry it there.
- Resolution runs for every remote, including one whose URL already reads `jwildfire/…`. A repository that leaves the account keeps its old path resolving too, so trusting that text would be the same stale-text bug pointed the permissive way. There is no fast path and no trusted prefix. The lane already could not work offline — minting the token needs the network — so no new class of outage is introduced.
- The token is minted before anything is asked of GitHub, so the resolution read goes out as the app and not on whatever credential is ambient. `GH_TOKEN="$token"` is assigned from a variable already checked non-empty, never from a command substitution on the `gh` line (obot.agent#207).
- The remedy scan runs only on the refusal path, so the passing path costs one API call. It reports four distinct things: a remote that resolves in-org and can take the push (named, with the command); one that resolves in-org but is archived (named as that, never offered); one that could not be resolved (named as unknown, not as ruled out); and only failing all three, that there is no local way round.
- `OBOT_PUSH_GH_BIN` overrides the resolver binary — used by the tests to prove the no-resolver case, and by the live demonstration above.
- `skills/obot-identity/SKILL.md` gains a section on the three states and the way-out messages; `NEWS.md` gains the v0.5.0 entries.
- `origin` was not repointed in any clone. That is @jwildfire's machine and his remote, and the brief rules it out; nothing in this change touches a `.git/config`.

## Next steps

- The two held `gsm.safety` release candidates can proceed through the lane once this merges.
- `jwildfire/gsm.safety` carries a branch `w0122-push-proof` from the demonstration above. It points at `origin/dev`'s existing head — no new commits, no content — and it is left in place under the no-delete rule. Say the word and it goes.
- **Correction to the brief.** It records `safety-histogram`'s second remote as a legitimate write path. Both copies are archived — `obot-claw/safety-histogram` and `jwildfire/safety-histogram` — so there is no way out in that clone, and the refusal says so rather than pointing at a repository that would reject the push at the far end. Everything else in the brief was verified and holds.

---

This PR was drafted by 👯🤖 W0122 (Claude Code using Opus 5) and reviewed by @jwildfire
