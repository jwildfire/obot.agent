<!-- STATUS: Posted to https://github.com/jwildfire/obot.agent/pull/150 on 2026-08-17 06:05 CEST -->
<!-- GITHUB_PROPERTIES: Labels: bug, Milestone: v0.5.0, Assignee: @me -->

Running a second dashboard to test a change can no longer take @jwildfire's status-line link away from the dashboard that is actually serving.

Closes #142

## Roadmap context

Requirement [obot.roadmap#180](https://github.com/jwildfire/obot.roadmap/issues/180) — the Operations Dashboard. Milestone v0.5.0.

Five instances in one evening, from three workers ([#142](https://github.com/jwildfire/obot.agent/issues/142) and both comments), and every one of them was an agent doing the right thing: running a second instance while changing the dashboard. Two of the five were repaired only because the worker happened to notice. One left the status line on a dead link for about thirty minutes and nobody noticed at all.

This is the house failure mode in a new place — an operation that succeeds while destroying something it did not own — so the fix is written to remove the failure rather than to detect it.

## What changed

The marker at `.claude/session-hub/serve.json` says one thing: *this is the machine's dashboard, here*. It is a claim on a role, and it was a claim anything could take. Now a second instance declines it.

**A server told an explicit non-default `--port` never claims the marker.** This is W0012's proposal from the second comment and it is the whole primary fix: it needs no liveness check, no lock, and no correct behaviour from anyone else. `--port 7399` serves the entire site and touches nothing the status line reads.

**A server that did not get the port it asked for is not the dashboard either.** Without this, the case that keeps recurring survives in a second form: start a second dashboard with no flags at all, it rolls forward to 7327, and takes the marker anyway. Something else already owns the dashboard's address, so this process is by definition not it.

**A live marker held by another process is never overwritten**, and **an instance removes only the marker it owns** — recorded pid *and* recorded port. The port half is not decoration: pids are reused, and the second comment records an exit hook deleting a marker "because the pid matched" that it had never written.

**A reader is told `stale` rather than handed a URL.** A marker left by a killed server is byte-identical to a healthy one, so the file alone cannot answer the question anything reading it is actually asking. `node obot.agent/tools/serve-marker` answers `none` / `unreadable` / `stale` / `live`, and `--url` prints a URL only for `live`, exiting non-zero otherwise so a shell fallback fires.

**Declining is announced, not silent.** A test server prints what it did not do, before the URL:

```
ops-dashboard: not claiming the serve marker — an explicit --port (7399) names a test server, not the machine dashboard
ops-dashboard: http://127.0.0.1:7399/
```

Both servers share one module, so neither can drift from the other. The two skills that read the marker were themselves carrying the instruction that produced the failure: `/session-dashboard` opened whatever URL the file held, and `/ops-dashboard` told agents that a rolled-forward port lands in the marker — which is now the opposite of what happens. Both ask the tool instead.

## Evidence

- <a href="https://github.com/jwildfire/obot.agent/blob/w0017-serve-marker/tools/ops-dashboard/lib/serve-marker.mjs">`lib/serve-marker.mjs`</a> — the rules, and why each removes a failure rather than detecting one
- <a href="https://github.com/jwildfire/obot.agent/blob/w0017-serve-marker/tools/serve-marker">`tools/serve-marker`</a> — the reader that answers with a state
- <a href="https://github.com/jwildfire/obot.agent/blob/w0017-serve-marker/tools/ops-dashboard/test/serve-marker.test.mjs">`test/serve-marker.test.mjs`</a> — 8 tests, including a real second dashboard process started and killed beside a live marker
- <a href="https://github.com/jwildfire/obot.agent/blob/w0017-serve-marker/tools/ops-dashboard/README.md">`ops-dashboard/README.md`</a> — "A second instance cannot take the marker"

Verified by running it against @jwildfire's own machine, with his dashboard (pid 28160, port 7326) serving throughout — the marker was compared byte-for-byte before, after each start, and after each exit:

| second instance | announced | marker after start | marker after exit |
|---|---|---|---|
| `ops-dashboard --serve --port 7399` | not claiming — explicit `--port` | unchanged | unchanged |
| `ops-dashboard --serve` (rolled to 7327) | not claiming — bound 7327 after 7326 was taken | unchanged | unchanged |
| `session-hub --serve --port 7398` | not claiming — explicit `--port` | unchanged | unchanged |

The 7399 dashboard was opened in Chrome and rendered the full site, its provenance chip reading `code: 8faa5bd` — this branch's commit, so the run proved the new code rather than the old. `serve-marker` reported `state: live · pid 28160 · port 7326` throughout, and the status line still resolved to `http://127.0.0.1:7326/live.html`. His dashboard was never restarted, never killed, and its marker never restored, because it never needed to be.

431 tests pass (423 before this branch, 8 added).

## Next steps

- The one hole left open deliberately: a dashboard whose port is taken by something that is *not* a dashboard rolls forward and declines the marker, so the status line falls back to `file://`. It says so on stdout rather than failing quietly, and a link that admits it is a file beats one that confidently names a dead port.
- @jwildfire's running dashboard is on the old code; it picks up the new exit rule whenever it is next restarted. Nothing needs restarting for the fix to hold, because the rules that matter run in the *second* instance.

---

Drafted by 👯🤖 W0017 (Claude Code using Opus 5) and reviewed by @jwildfire.
