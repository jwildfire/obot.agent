# statusline

The Claude Code status line every obot agent runs, and the installer that puts it
in place. One row under the prompt: session id, model, directory, git branch,
context left, cost — and a **clickable hub link**.

```
[a1554f0d] Opus 5 ~/Documents/obot2 (main) 68% left $1.20 ↗ ops hub
```

The link is context-aware:

| Where the session is working | Link target |
|---|---|
| Inside the obot workspace (`~/Documents/obot2`, worktrees included) with a rendered live view | `file://…/.claude/session-hub/live.html` — the [session ops hub](../session-hub/README.md) |
| Anywhere else, or before the live view has ever been rendered | <https://jwildfire.github.io/obot.roadmap/> — the deployed obot hub |

Same script for every agent — lead sessions, spawned siblings, ultracode jobs —
so the hub is one Cmd+click away from wherever an agent happens to be.

## Install

```bash
obot.agent/tools/statusline/install.sh             # into ~/.claude
obot.agent/tools/statusline/install.sh --home DIR  # another config dir
obot.agent/tools/statusline/install.sh --check     # report drift, change nothing
```

The installer copies `statusline.sh` to `~/.claude/statusline-command.sh` and
points that config's `statusLine` at it, **merging** into `settings.json` rather
than replacing it. It is idempotent, and it keeps the script it replaced as a
timestamped `.bak` next to the installed copy.

User-level (`~/.claude`) rather than workspace-level is deliberate: the status
line has to apply to every agent on the machine, and only `~/.claude/settings.json`
is read by all of them. Same source/installed split as [`hooks/`](../../hooks/README.md) —
this repo is the source, the installed copy is what the harness runs. Edit
`statusline.sh` here and re-run the installer; do not hand-edit `~/.claude/statusline-command.sh`.

## Options

Environment variables, read per render:

| Variable | Default | Meaning |
|---|---|---|
| `OBOT_STATUSLINE_LINK` | `auto` | `auto` = OSC 8 hyperlink on the label · `text` = print the bare URL instead · `off` = drop the link segment |
| `OBOT_WORKSPACE` | `~/Documents/obot2` | Workspace root used for the in-session test and the live-view path |
| `OBOT_HUB_URL` | `https://jwildfire.github.io/obot.roadmap/` | The out-of-session target |

## Clickability

The link is an [OSC 8 hyperlink](https://en.wikipedia.org/wiki/ANSI_escape_code#OSC)
(`\e]8;;URL\aLABEL\e]8;;\a`), the form [Claude Code documents](https://code.claude.com/docs/en/statusline#clickable-links)
for status lines and uses for its own clickable file paths. **Cmd+click** on macOS,
Ctrl+click elsewhere.

Whether it renders as a link is Claude Code's call, not this script's — it detects
terminal hyperlink support and drops the escape (leaving the plain label) when the
terminal cannot honour it, so the script emits the sequence unconditionally rather
than second-guessing the detection:

- **Supported**: Ghostty, iTerm2 ≥ 3.1, kitty, WezTerm, VS Code ≥ 1.72, Windows Terminal.
- **Not supported**: Terminal.app — the label renders, the click does not. Use
  `OBOT_STATUSLINE_LINK=text` there to get a URL you can copy.
- **Background sessions**: an attached client (`claude attach`) reports its own
  terminal capabilities in the attach handshake, so a bg agent attached from
  Ghostty gets a working link even though the daemon's own environment has no
  `TERM_PROGRAM`.
- **Detection override**: `FORCE_HYPERLINK=1` in the environment *before* launching
  Claude Code forces hyperlink emission on terminals its auto-detection misses.

A `file://` link opens in the default browser — the ops hub live view is a local
file the [session-hub](../session-hub/README.md) watch loop regenerates about once
a minute, so what opens is current.

### The other footer lane

Claude Code v2.1.220 also ships **footer link badges** — `footerLinksRegexes` in
user settings renders up to five clickable badges when a regex matches turn output
(and `prUrlTemplate` renders the detected PR as the first badge). That lane is
event-driven: a badge appears because an ID showed up in the conversation and is
displaced by newer matches. The status line is the persistent lane, which is what
"always one click from the ops hub" needs, so the link lives here. The badge lane
stays available for IDs worth surfacing as links (a job id, a run id) without
writing a script.

## Tests

```bash
node --test tools/statusline/test/*.test.mjs
```

The tests drive `statusline.sh` with mock stdin payloads over a temporary
workspace: in-session vs out-of-session targeting, the prefix-only sibling
directory that must *not* count as inside, the no-live-view fallback, each link
mode, and that the link is appended to the existing segments rather than replacing
them.
