#!/usr/bin/env python3
# attribution-guard.sh - PreToolUse guard (matcher: Bash) for the obot2 workspace.
#
# Refuses a GitHub WRITE that is about to run on the ambient `gh` token, because
# that token authenticates as @jwildfire and GitHub then records him as having
# done it. The admitted lanes are the wrapper obot.agent/scripts/obot-gh (mints an
# obotclaw[bot] installation token), obot-merge (mints its own), and an explicit
# GH_TOKEN= assignment, which is a deliberate and legible statement about identity.
#
# WHY (obot.agent#197). For two days every structural roadmap edit - labels,
# milestones, sub-issue links, project additions, board moves - went out under
# @jwildfire's own account, across roughly a hundred issues. Issue *bodies* read
# `obotclaw` because the app token was passed to `gh issue create`; the pattern
# was simply never carried to the rest. And it is invisible in the place people
# look: the body reads correctly and only the timeline disagrees, so nobody finds
# it unless they are already suspicious.
#
# The fix could not be another line in a skill file telling agents to remember.
# Two days of evidence say remembering does not work - the same shape as the
# `bash ` prefix habit that broke obot-merge and ops-answers. So the write is
# refused at the moment it is about to happen, by the one component that sees
# every command before it runs.
#
# DENIED (per command segment, so one wrapped call does not launder its neighbours):
#   gh issue|pr edit|create|comment|close|...   gh label create|edit|delete|clone
#   gh project item-add|item-edit|...           gh release create|edit|delete|...
#   gh api with -X/--method POST|PATCH|PUT|DELETE, or with -f/-F/--input (gh
#     defaults those to POST), or gh api graphql carrying a mutation
#   curl to api.github.com with a write method
#   GH_TOKEN=$(gh auth token), which launders his own credential into the write
#
# ADMITTED (defer to normal permission evaluation):
#   anything whose segment runs obot-gh or obot-merge, or carries GH_TOKEN=
#   reads - gh issue view/list, gh api with no write method, item-list, gh search
#   every quoted string and heredoc body, which are stripped before matching, so
#     an agent writing *about* `gh issue edit` in a draft, a commit message or a
#     scratchpad line is never blocked. A guard that cannot tell prose from a
#     command gets switched off within a day, and then it protects nothing.
#
# GraphQL is the one payload read raw: a mutation lives inside the quoted -f
# query=, so stripping quotes would hide it. It is only scanned when a segment
# genuinely invokes `gh api graphql`, so prose naming a mutation stays free.
#
# Parse failures defer. This guard must never block unrelated work.

import json
import re
import sys

try:
    payload = json.load(sys.stdin)
    command = payload.get("tool_input", {}).get("command", "") or ""
except Exception:
    sys.exit(0)  # defer

if not command.strip():
    sys.exit(0)

# --------------------------------------------------------------- text preparation


def strip_heredocs(text):
    """Blank out heredoc bodies. Draft issue bodies and PR descriptions arrive this
    way, and they are full of the very command strings this guard matches on."""
    out = []
    lines = text.split("\n")
    i = 0
    while i < len(lines):
        line = lines[i]
        out.append(line)
        delims = re.findall(r"""<<[-~]?\s*(?:"([^"]+)"|'([^']+)'|([A-Za-z_]\w*))""", line)
        if delims:
            wanted = {d for group in delims for d in group if d}
            i += 1
            while i < len(lines) and lines[i].strip() not in wanted:
                out.append("")
                i += 1
            if i < len(lines):
                out.append(lines[i])
        i += 1
    return "\n".join(out)


def strip_quotes(text):
    """Replace the contents of quoted spans with spaces, keeping the quote characters
    and the length so the surrounding command shape is unchanged.

    Command substitutions are preserved even inside double quotes, because the shell
    runs them: `GH_TOKEN="$(gh auth token)" gh ...` really does execute `gh auth
    token`, and blanking it would hide the one form this guard most needs to see."""
    out = []
    i, n = 0, len(text)
    quote = None
    subst = 0  # depth inside $( ), where text is preserved verbatim
    while i < n:
        ch = text[i]
        if subst:
            out.append(ch)
            if ch == "(":
                subst += 1
            elif ch == ")":
                subst -= 1
            i += 1
            continue
        if quote is None:
            if ch == "$" and text[i + 1:i + 2] == "(":
                out.append("$(")
                subst = 1
                i += 2
                continue
            if ch in "\"'`":
                quote = ch
            out.append(ch)
            i += 1
            continue
        # inside a quoted span
        if quote == '"':
            if ch == "\\" and i + 1 < n:
                out.append("  ")
                i += 2
                continue
            if ch == "$" and text[i + 1:i + 2] == "(":
                out.append("$(")
                subst = 1
                i += 2
                continue
        if ch == quote:
            quote = None
            out.append(ch)
        else:
            out.append("\n" if ch == "\n" else " ")
        i += 1
    return "".join(out)


def split_segments(text):
    """Split into command segments on ; && || | and newline, but never inside a
    substitution or subshell - `$(obot-app-token | tr -d ...)` is one command, and
    splitting it would strand the `gh` call in a segment with no token in front of it.

    Judging each segment on its own is what stops
      obot-gh issue edit 1 --add-label a && gh issue edit 2 --add-label b
    from being admitted wholesale on the strength of its first half."""
    segs, buf, depth = [], [], 0
    i, n = 0, len(text)
    while i < n:
        ch = text[i]
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth = max(0, depth - 1)
        if depth == 0:
            if text[i:i + 2] in ("&&", "||"):
                segs.append("".join(buf))
                buf = []
                i += 2
                continue
            if ch in ";&|\n":
                segs.append("".join(buf))
                buf = []
                i += 1
                continue
        buf.append(ch)
        i += 1
    segs.append("".join(buf))
    return [s for s in segs if s.strip()]


stripped = strip_quotes(strip_heredocs(command))
SEGMENTS = split_segments(stripped)

# ------------------------------------------------------------------ admitted lanes

# The wrapper as an actual command head - optionally path-qualified, optionally
# behind env assignments - rather than merely named somewhere in the text.
WRAPPED = re.compile(r"""^\s*\(?\s*(?:\w+=\S*\s+)*(?:\S*/)?obot-(?:gh|merge)\b""")

# An explicit token assignment: `GH_TOKEN=$(obot-app-token) gh ...` is the bot, and
# a token from anywhere else is a choice someone made on purpose, in writing, that
# can be read back later. Either way the identity question was faced.
EXPLICIT_TOKEN = re.compile(r"""^\s*\(?\s*(?:\w+=\S*\s+)*(?:GH_TOKEN|GITHUB_TOKEN)=""")

# ...except this one form, which is not a statement about identity but a way around
# the question: it hands his own credential to the write.
LAUNDERING = re.compile(
    r"""(?:GH_TOKEN|GITHUB_TOKEN)\s*=\s*[\$"'(]*\s*gh\s+auth\s+token"""
)

# ------------------------------------------------------------------- write shapes

GH_SUBCOMMAND_WRITES = [
    (r"(?:issue|pr)\s+(?:edit|create|comment|close|reopen|lock|unlock|pin|unpin|"
     r"transfer|delete|develop|ready)", "a `gh issue`/`gh pr` write"),
    (r"label\s+(?:create|edit|delete|clone)", "a `gh label` write"),
    (r"project\s+(?:item-add|item-edit|item-delete|item-archive|create|edit|delete|"
     r"copy|link|unlink|field-create|field-delete|mark-template)", "a `gh project` board write"),
    (r"release\s+(?:create|edit|delete|upload|delete-asset)", "a `gh release` write"),
]

PATTERNS = [(re.compile(r"\bgh\s+" + body + r"\b"), label)
            for body, label in GH_SUBCOMMAND_WRITES]

PATTERNS += [
    # REST write through gh api: an explicit write method...
    (re.compile(r"""\bgh\s+api\b(?![^\n]*\bgraphql\b)[^\n]*?"""
                r"""(?:-X|--method)\s+["']?(?:POST|PATCH|PUT|DELETE)\b""", re.I),
     "a REST write through `gh api`"),
    # ...or a field/input flag, which makes gh default the method to POST.
    (re.compile(r"""\bgh\s+api\b(?![^\n]*\bgraphql\b)[^\n]*?"""
                r"""(?:\s-f\s|\s-F\s|\s--field\s|\s--raw-field\s|\s--input\s)"""),
     "a REST write through `gh api` (-f/-F/--input defaults the method to POST)"),
    # Raw REST, either flag order.
    (re.compile(r"""\bcurl\b[^\n]*?(?:-X|--request)\s+["']?(?:POST|PATCH|PUT|DELETE)\b"""
                r"""[^\n]*?api\.github\.com""", re.I),
     "a raw REST write to api.github.com"),
    (re.compile(r"""\bcurl\b[^\n]*?api\.github\.com[^\n]*?"""
                r"""(?:-X|--request)\s+["']?(?:POST|PATCH|PUT|DELETE)\b""", re.I),
     "a raw REST write to api.github.com"),
]

GRAPHQL_CALL = re.compile(r"""\bgh\s+api\s+graphql\b|\bcurl\b[^\n]*api\.github\.com/graphql""")

# Scanned against the RAW command, and only when a segment really invokes graphql.
MUTATION = re.compile(
    r"""\bmutation\b\s*[({]|"""
    r"""\b(?:addSubIssue|removeSubIssue|reprioritizeSubIssue|addProjectV2ItemById|"""
    r"""addProjectV2DraftIssue|updateProjectV2ItemFieldValue|updateProjectV2ItemPosition|"""
    r"""deleteProjectV2Item|archiveProjectV2Item|unarchiveProjectV2Item|"""
    r"""addLabelsToLabelable|removeLabelsFromLabelable|clearLabelsFromLabelable|"""
    r"""createLabel|updateLabel|deleteLabel|createIssue|updateIssue|closeIssue|"""
    r"""reopenIssue|addAssigneesToAssignable|removeAssigneesFromAssignable|addComment|"""
    r"""updateIssueComment|createMilestone|updateMilestone|linkProjectV2ToRepository)\s*\("""
)

# ------------------------------------------------------------------------ verdict

WRAPPER_ADVICE = (
    "Run it through the wrapper, which mints an obotclaw[bot] installation token:\n\n"
    "  obot.agent/scripts/obot-gh <the same gh args>\n\n"
    "Board moves are the exception - a GitHub App cannot reach a user-owned ProjectsV2 "
    "board at all, so `obot-gh project ...` refuses and explains why. If a write "
    "genuinely must carry his name, `obot-gh --as-jeremy --reason '<why>' ...` does it "
    "and records it in .claude/attribution.journal."
)


def deny(reason):
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": reason,
        }
    }))
    sys.exit(0)


for seg in SEGMENTS:
    if LAUNDERING.search(seg):
        deny(
            "attribution-guard: `GH_TOKEN=$(gh auth token)` runs the write as @jwildfire "
            "using his own credential - which is precisely what obot.agent#197 is about. "
            "Agent writes go out as obotclaw[bot].\n\n" + WRAPPER_ADVICE
        )

    if WRAPPED.search(seg) or EXPLICIT_TOKEN.search(seg):
        continue  # identity was chosen deliberately

    for pattern, label in PATTERNS:
        if pattern.search(seg):
            deny(
                "attribution-guard: this is {}, and with no token set it authenticates as "
                "@jwildfire - so his GitHub history records him doing it. Two days of "
                "labels, milestones, parent links and board moves landed under his name on "
                "~100 issues that way, none of which he made (obot.agent#197).\n\n{}"
                .format(label, WRAPPER_ADVICE)
            )

    if GRAPHQL_CALL.search(seg) and MUTATION.search(command):
        deny(
            "attribution-guard: this is a GraphQL mutation, and with no token set it "
            "authenticates as @jwildfire - so his GitHub history records him doing it "
            "(obot.agent#197). Sub-issue links and board writes are mutations, and they "
            "are the bulk of what went out under his name.\n\n" + WRAPPER_ADVICE
        )

sys.exit(0)  # defer
