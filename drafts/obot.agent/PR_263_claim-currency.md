<!-- STATUS: Posted to https://github.com/jwildfire/obot.agent/pull/263 on 2026-08-18 08:34 EDT -->
<!-- GITHUB_PROPERTIES: Milestone: v0.5.0, Assignee: @me -->

A config item said it was still blocking. A decision page said a release was held. Both were assertions somebody wrote down once, and nothing on this machine had checked either since. This makes them checked claims instead — on a five-minute cadence, in one mechanism serving both.

Closes #262

## Roadmap context

Requirements [obot.roadmap#264](https://github.com/jwildfire/obot.roadmap/issues/264) and [#266](https://github.com/jwildfire/obot.roadmap/issues/266). #266 says the two are the same problem one artifact class apart and asks for one mechanism by name, "or they will be solved twice and differently".

The evidence behind them, none of it re-derived here:

- Three of the last six config items left the list for being stale or mis-specified rather than for being done. c0014 was not a blocker at all; c0015's verify was wrong; c0016 exists only because c0015's was wrong.
- D0021's page said a release was held pending the decision. The release published sixteen minutes before the page was written. Not the artifact, not the discussion, not the config list, not the delivery record noticed.
- A worker writing three config cards found that the hard part was never the steps — it was establishing whether the item was still true, and in all three cases the list could not tell it.

## What a claim is

A sentence and a proof:

```
<what is claimed> | <read-only command> → <what its output should say>
```

The right-hand half is the config list's own `Verify:` grammar, unchanged, so there is one parser rather than two. A decision artifact declares one per line in its head, beside the description its contract already requires:

```html
<meta name="premise" content="v1.1.0 is published, not a draft | gh release view v1.1.0 -R jwildfire/gsm.safety --json isDraft --jq .isDraft → prints false">
```

One line, because a premise that costs a section or a schema does not get written — which is the failure mode #266 names.

What differs between the classes is only what a verdict means. A config claim that holds is done and leaves his queue; a premise that holds still frames its question correctly.

## Three states, and the collapse this repairs

`holds` / `does not hold` / `unknown`. Four distinct things land in `unknown` and not one of them is a fail:

- The command is not on the read-only allowlist, or is manual.
- The command produced no exit status — not installed, or killed by the timeout. **This was live in the code being replaced:** `runVerify` coerced a spawn failure to `exitCode: 1` and judged it, so an item nothing could check read as an item still waiting on him.
- The claim asserts `prints X`, and the command exited non-zero having either printed nothing or reported an error. There was no answer to compare.
- The last recorded reading proved a different command. A reworded verify starts again rather than inheriting its predecessor's verdict.

The third of those came from 👯🤖 W0071's missing-file control, and it is worth recording that the control's own premise was wrong in a way that made it more valuable: `gh api` with `--jq` attached prints the API's error object to **stdout** on a 404 and exits 1, so an emptiness test alone would have missed exactly the case the control was built to catch. Both halves are tested.

It is deliberately narrow. `grep -c x file` prints `0` and exits 1 when the answer is "none, which is what we wanted" — two live config items depend on that reading as a pass, and it still does.

## A real run, on real items

Not a fixture. `node tools/navigator/currency.mjs` against this machine, this morning:

```
config: 13 open · 0 done · 6 still outstanding · 7 unchecked · newest reading just now
  still outstanding, measured: c0001, c0002, c0003, c0008, c0012, c0013
  c0004 unchecked — exited non-zero and reported an error, so what it printed is the
        failure rather than the answer (gh: Resource protected by organization SAML
        enforcement … (HTTP 403)). Unknown, not outstanding and not done.
  c0005 unchecked — osascript is not on the read-only allowlist — run it yourself.
  c0009 unchecked — manual check — nothing to run.
  c0016, c0017, c0018 unchecked — shell redirection or chaining — run it yourself.
  c0019 unchecked — manual check — nothing to run.

premises: 5 declared across 3 artifacts still awaiting him · 5 hold · 0 expired · 0 unchecked
  holding: D0020.p1, D0021.p1, D0021.p2, D0021.p3, D0021.p4
```

And the run twenty minutes before 👯🤖 W0071's correction of D0021 landed, which is the case #266 was written about:

```
**PREMISE BROKEN** — D0021 states a premise that no longer holds (checked just now):
  "gsm.safety v1.1.0 is still held at the tag, unpublished". The evidence on that page
  may be sound and its framing is not.
  reports/decisions/2026-08-17-safetycensus-stay-or-go/ · proof: `gh release view v1.1.0
  -R jwildfire/gsm.safety --json isDraft --jq .isDraft` → prints true
```

All three states, live, on real items, rendering distinguishably — and the alarm cleared by the page being fixed rather than by anything here being adjusted.

Two things the run says that are worth reading as findings rather than as output:

- **No config item passes today.** Not a gap in the mechanism: none of them is done. It is the first time the list has had a measured answer to that question at all — the ledger held two records in three days before this morning, both on the same item, both run by hand.
- **c0004 changed state.** It read as "still outstanding" until the no-answer rule landed; it is a SAML 403, and "could not be checked, here is the error" is the more actionable line.

## Where it renders

- **The sweep**, above the RC queue rather than below it: its findings are about things in the queue, so they belong where they are read before he goes to the keyboard.
- **Every config row and card**, which now say when the claim was last checked instead of when somebody filed it. Three states get three colours and three sentences; a card's line travels with the phone summary, since the dashboard is not reachable from a phone.
- **An item its own check proves done leaves the queue** — as a view, with nothing written to `.claude/blockers.md` and nothing closed on GitHub. The line naming what left is there so nothing can vanish silently, which would be its own kind of lie.

## On the sweep, and at publish time

```bash
node tools/navigator/currency.mjs                    # the pass, as the sweep runs it
node tools/navigator/currency.mjs --artifact <slug>  # one artifact; exits 1 if a premise does not hold
```

They fail differently and neither substitutes. Cadence catches the world moving under a page that was right when written — and the config half, where nothing else ever will. Publish-time catches a page born wrong, which cadence can only report forever with no path to green: the first draft of D0021's premise was the corrected-away claim, and a five-minute check on it would have been a permanent alarm.

What actually closes the window is not the evaluation, though — the premise that expired was never in a field to evaluate. Declaring one forces the author to state it as a command, so a belief becomes a measurement at the moment of writing. The gate is worth having; the declaration is the part doing the work.

## Five surfaces, not one

👯🤖 W0071 measured this while correcting D0021: the expired premise was stated in five places and true in none — the page, the artifact's README, the published index row, `registry.json`, and the discussion title. Four of them reach him through a different door than the page does.

So a broken premise's finding names all five, and reads when each of the three that are files was last modified, flagging any older than the moment the premise broke. The discussion title is named without a reading and says so. Refusing to claim a check nobody ran is what makes the other three believable.

A declaration that cannot be parsed at all is counted and reported rather than vanishing — a premise nobody can read looks exactly like a page with nothing wrong.

## Technical briefing

- `tools/lib/claims.mjs` — the shared core. `iq.mjs` keeps the config list's field grammar and imports the rest, so there is one implementation and every existing importer is unaffected.
- `tools/navigator/currency.mjs` — the two readers, the runner's orchestration, the section, the publish-time gate. Bounded in wall time; a claim the budget did not reach keeps its previous reading and its previous age, and says so.
- Shell metacharacters are judged **outside quotes only**. A shell is never involved — `execFile` takes argv — so the guard exists against silent wrongness: `grep -q x f > /dev/null` run without a shell passes `>` and `/dev/null` to grep and answers a different question. Inside quotes they are characters in an argument, which is what lets `gh api … --jq '.content | @base64d | test("x")'` run as one command with three jq pipes and no shell.
- The premise extractor is quote-aware on both the tag and the value. Measured on the real page before the fix: it cut `gh api … --jq '…'` down to `gh api … --jq` and then judged the fragment.
- Alarm headlines are asserted against `ALARM_RE` **imported** from `tools/ops-dashboard/lib/navigator.mjs`, and once more through `parseNavigatorState` itself, so a headline that would render as grey text fails the suite.
- The hub clone is read as files and never as code — importing anything from that repo arms a local-only guard that replaces `node:fs` for the whole process (obot.agent#206).
- 37 tests in `tools/navigator/test/currency.test.mjs`; full suite 1274 passing.

Contract for artifact authors is in `reports/decisions/README.md` on the hub ([ce7ae54](https://github.com/jwildfire/obot.roadmap/commit/ce7ae54)); mechanism documentation in `tools/ops-dashboard/README.md` here.

## Next steps

- The hub deploy can enforce the half it can do without the runner: a premise line must parse and must either name a command or say `manual —`. Pure text, and it catches the failure that would kill this quietly.
- `launchctl print` and `pmset -g` are genuine read-only commands and are two of the seven unchecked items. Adding them to the allowlist is a decision with a real blast radius on a file agents write, so it is named here rather than taken.
- Three items are unchecked only because their verify was written with a shell pipe where a pipe-free equivalent exists. Rewriting those is list hygiene, not mechanism work.

---

Drafted by 👯🤖 W0072 using Opus 5. NOT reviewed by @jwildfire.
