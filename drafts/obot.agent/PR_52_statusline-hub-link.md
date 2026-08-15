<!-- STATUS: Posted to https://github.com/jwildfire/obot.agent/pull/52 on 2026-07-25 21:32 EDT -->
<!-- GITHUB_PROPERTIES: Assignee: @jwildfire, Reviewers: @jwildfire -->

## Summary

Every agent's status line now ends with a clickable hub link. Working inside the obot workspace, it points at the **live session ops hub**; anywhere else, at the **deployed obot hub**. Cmd+click opens it.

```
[a1554f0d] Opus 5 ~/Documents/obot2 (main) 68% left $1.20 ↗ ops hub
[deadbeef] Opus 5 ~/Documents/github/blog 91% left $0.02 ↗ obot hub
```

The ops hub link is served over loopback HTTP (`http://127.0.0.1:7325/live.html`) rather than `file://`, because Ghostty hands a `file://` hyperlink to **Finder** instead of the browser — reported after the first round, fixed here with a `--serve` mode on the session-hub watch loop.

The status line also becomes a tracked artifact instead of an untracked file on one machine: `tools/statusline/` holds the script, an idempotent installer, a README, and tests — the same source/installed split `hooks/` uses.

No linked issue: this is scaffold work from a direct ask ("add the clickable link to the session ops hub in the footer for all agents; if I'm working outside a session, just link to the obot hub").

## Reviewer notes

**It is already live on your machine.** The installer ran during this session, so your next status-line render shows the link — that is the test. `~/.claude/settings.json` was **not modified** (its `statusLine.command` already pointed at `~/.claude/statusline-command.sh`; only that script's contents changed), and the previous script is saved at `~/.claude/statusline-command.sh.bak-20260725-081953`. To revert: `cp ~/.claude/statusline-command.sh.bak-20260725-081953 ~/.claude/statusline-command.sh`. To keep the status line but drop the link: `OBOT_STATUSLINE_LINK=off`.

**What to click.** In a session working under `~/Documents/obot2`, the link is `http://127.0.0.1:7325/live.html` — the same live view `/session-dashboard` opens, regenerated ~60s by the watch loop. Elsewhere it is the deployed hub. Cmd+click in Ghostty; Terminal.app renders the label but cannot click it (`OBOT_STATUSLINE_LINK=text` prints a copyable URL there).

**The watch loop is already running with `--serve`.** I restarted it from this branch's worktree (pid in `.claude/session-hub/watch.pid`), which is also how it picks up the new code before merge. After merge, restart it once from the main clone — `kill $(cat .claude/session-hub/watch.pid)` then the command in the `/session-dashboard` skill — so it stops executing a worktree copy.

**Code-review anchors.**

- [`tools/statusline/statusline.sh`](https://github.com/jwildfire/obot.agent/blob/statusline-hub-link/tools/statusline/statusline.sh) — the link block is the last ~35 lines. The in-workspace test is a lowercased prefix compare (`~/Documents/obot2` vs the harness's `~/documents/obot2`), and it requires `live.html` to exist, so a machine that has never rendered the dashboard falls back to the hub rather than linking a 404.
- The OSC 8 sequence is emitted unconditionally in `auto` mode. That is deliberate — see the technical briefing: Claude Code owns hyperlink detection and strips the escape itself when the terminal cannot honour it, so a second guess in the script can only be wrong.
- [`tools/session-hub/lib/serve.mjs`](https://github.com/jwildfire/obot.agent/blob/statusline-hub-link/tools/session-hub/lib/serve.mjs) — ~110 lines of stdlib `http`. Loopback bind only (never `0.0.0.0`: the live view carries session names, agent intents, and scratchpad lines), `GET`/`HEAD` only, no directory listings, path escapes rejected, `no-store`. It writes `.claude/session-hub/serve.json` with port and pid and removes it on exit; the status line checks the pid is alive, because a killed server leaves the marker behind.
- [`tools/statusline/install.sh`](https://github.com/jwildfire/obot.agent/blob/statusline-hub-link/tools/statusline/install.sh) — copies to `~/.claude/statusline-command.sh` and *merges* `statusLine` into `settings.json` rather than rewriting it; backs up the replaced script only when it differs; `--check` reports drift for both halves.
- **Drive-by fix**: the git-branch segment never rendered for any repo under `$HOME`, because the `~`-abbreviated display path was handed to `git -C` (an argument does not expand `~`). The branch is real information for agents in worktrees, so it is fixed here and covered by a test.

**Security.** A local status-line script, a local installer, and tests. No credentials, no network calls, no workflows. The installer touches exactly two paths, both under the Claude config dir, and backs up what it replaces.

## Roadmap context

This is session-framework scaffolding, in the same family as the [session hub](https://github.com/jwildfire/obot.agent/blob/main/tools/session-hub/README.md) ([obot.roadmap#24](https://github.com/jwildfire/obot.roadmap/issues/24)) and the workspace hooks: the ops hub is the fastest read on what every agent is doing, and until now getting to it meant running `/session-dashboard` or hunting for the file path. One click from any session — lead, sibling, or ultracode job — closes that gap.

It also moves the status line into version control. It had lived only in `~/.claude/statusline-command.sh`, on one machine, with no history — the same gap `hooks/install.sh` closed for the merge guard and the heartbeat.

## Evidence

- **Tests**: 66/66 pass across both tools (`node --test tools/session-hub/test/*.test.mjs tools/statusline/test/*.test.mjs`) — 13 status-line cases and 6 new server cases on top of the existing session-hub suite. The server cases cover the loopback bind, the 404/405 answers, three flavours of path traversal, port roll-forward when 7325 is taken, and `serve.json` write/cleanup. The status-line cases cover in-session vs out-of-session targeting, the workspace root itself, case-insensitive path matching, a sibling directory that only shares a prefix (`obot2-worktrees/…` must *not* count as inside), the missing-live-view fallback, all three link modes, the git-branch fix, malformed stdin, and that the link is appended to the existing segments rather than replacing them.
- **Rendered output** (`cat -v`, in-workspace): `…$1.20 ^[[2;36m^[[4m^[]8;;file:///Users/jwildfire/Documents/obot2/.claude/session-hub/live.html^G↗ ops hub^[]8;;^G^[[0m` — a well-formed BEL-terminated OSC 8 pair around the label.
- **Live render, confirmed on screen**: your open.csr session's status line during this work read `[bcf4114b] Opus 5 ~/Documents/obot2 75% left $138.99 ↗ ops hub`, one row above the built-in footer badges (`auto mode on · ← 1 agent · PR #51`) — the label renders clean, no stray escape bytes, no layout damage. The link is underlined to match those badges.
- **Served endpoint, live**: `curl http://127.0.0.1:7325/live.html` → `200 text/html 48259 bytes`; `curl 'http://127.0.0.1:7325/../../../.zshrc'` → `404`. The installed status line now renders `…^[]8;;http://127.0.0.1:7325/live.html^G↗ ops hub…`.
- **Installed state**: `install.sh --check` → `ok: statusline-command.sh` / `ok: settings.json statusLine`; a normalized diff of `settings.json` before vs after is empty.
- **Terminal support** was verified against Claude Code v2.1.220 itself rather than assumed — details below.

## Technical briefing

**Which "footer".** Claude Code has two clickable-footer lanes. `footerLinksRegexes` (user settings, v2.1.220) renders up to five badges when a regex matches turn output — event-driven, displaced by newer matches, cleared by `/clear`. The status line is the persistent row above those badges. "Always one click from the ops hub" needs the persistent lane, so the link lives in the status line; the badge lane is documented in the README as the right tool for IDs that appear in conversation (a job id, a run id) without writing a script.

**Who decides if it is clickable.** Claude Code, not the script. Its hyperlink check reads, in order: the capabilities reported by an attached client, `FORCE_HYPERLINK`, then `supports-hyperlinks` detection (`TERM_PROGRAM` of `ghostty` / `iTerm.app` ≥ 3.1 / `WezTerm` / `vscode` ≥ 1.72, `WT_SESSION`, kitty, …). When the answer is no, it drops the escape and leaves the label. Two consequences worth knowing:

- A **background session attached from Ghostty gets a working link** even though the daemon's own environment has no `TERM_PROGRAM` — `claude attach` sends `caps.hyperlinks` computed in the real terminal, and that takes precedence over environment sniffing.
- An early draft of this script did its own `TERM`/`TERM_PROGRAM` sniffing and fell back to printing the bare URL. That was removed: two detectors disagreeing is strictly worse than one, and the surviving detector is the one that actually controls the output.

**Terminal caveats.** Ghostty (yours), iTerm2, kitty, WezTerm, VS Code, Windows Terminal: clickable. Terminal.app: label only. `FORCE_HYPERLINK=1` before launching Claude Code overrides detection where it misses. `file://` opens in the default browser — Chrome, here.

## Next steps

- Cmd+click the link once in a session and confirm the dashboard opens in Chrome (the one thing an automated test cannot assert).
- After merge, restart the watch loop from the main clone so it stops running the worktree copy.
- If the label reads well but the glyph does not, `↗` and the two labels (`ops hub`, `obot hub`) are one-line edits.
- Merge is gated as always: `obot.agent/scripts/obot-merge` after your approval.

---

This PR was drafted by Claude Code using Opus 5 and reviewed by @jwildfire
