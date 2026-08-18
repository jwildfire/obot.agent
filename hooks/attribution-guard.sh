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
#   GH_TOKEN= set to the empty string, which is the absence of an identity rather
#     than a statement of one: `gh` reads it as unset and falls back to his credential
#   GH_TOKEN=$(...) in front of a write, which cannot fail safely - see below
#   GH_TOKEN=$T where nothing in the same call assigns $T and the environment does
#     not carry it: a fresh shell per Bash call means it expands to nothing
#
# ADMITTED (defer to normal permission evaluation):
#   anything whose segment runs obot-gh or obot-merge
#   a token resolved before the write in the SAME call - GH_TOKEN=$T after a
#     T=$(...) assignment, an exported variable that is really set, or a literal
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
# WHY `GH_TOKEN=$(...)` IS REFUSED RATHER THAN TRUSTED (obot.agent#207). This guard
# used to admit any segment carrying a GH_TOKEN= prefix, reasoning that writing one
# down is a deliberate statement about identity. It is - but the shell does not
# deliver what it promises. A command substitution in an assignment *prefix* has its
# exit status discarded, so when the mint fails (expired installation, no network, a
# one-hour token running out mid-sequence) GH_TOKEN is set to the empty string, `gh`
# reads empty as unset, and the write goes out as @jwildfire while exiting 0. The
# guard graded the spelling and never asked whether a credential arrived. One write
# reached his history that way, and it cannot be reattributed afterwards.
#
# The fix is not for this hook to mint a token and check it. A hook cannot hand its
# result to the command it is judging, so any check here is a guess about a mint that
# has not happened yet - and it would put a GitHub API call in front of every write.
# It cannot answer "is this the App's credential rather than his" either; only the
# thing holding the token can, which is why the wrapper and obot-merge check their
# own mints. What this hook can do is refuse the three shapes in which an empty
# credential passes unnoticed - an empty assignment, a substitution whose failure the
# shell swallows, and a variable nothing in reach assigns - and name the lanes that
# cannot fail that way: the wrapper, which mints and runs in one process, and a plain
# assignment in the same call, whose status `&&` and `set -e` can see.
#
# Parse failures defer. This guard must never block unrelated work.

import json
import os
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
    from being admitted wholesale on the strength of its first half.

    Returns (start, end) spans rather than substrings, because two views of the same
    command have to be judged: the quote-stripped one, which is how a command shape is
    told apart from prose about one, and the raw one, which is where a GraphQL payload
    still exists. `strip_quotes` preserves length exactly, so a span cut from either
    view names the same segment - and #234 was the guard reading a mutation out of one
    segment while judging another."""
    spans, depth, start = [], 0, 0
    i, n = 0, len(text)
    while i < n:
        ch = text[i]
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth = max(0, depth - 1)
        if depth == 0:
            if text[i:i + 2] in ("&&", "||"):
                spans.append((start, i))
                i += 2
                start = i
                continue
            if ch in ";&|\n":
                spans.append((start, i))
                i += 1
                start = i
                continue
        i += 1
    spans.append((start, n))
    return [(a, b) for a, b in spans if text[a:b].strip()]


# Two views of the same text, the same length as each other, so one set of spans cuts
# both. RAW keeps quoted payloads, because a GraphQL mutation lives inside a quoted
# -f query= and nowhere else; STRIPPED blanks them, because that is what tells a
# command apart from prose about one. Heredoc bodies are gone from both.
RAW = strip_heredocs(command)
stripped = strip_quotes(RAW)
SPANS = split_segments(stripped)
SEGMENTS = [(stripped[a:b], RAW[a:b], a) for a, b in SPANS]

# ------------------------------------------------------------------ admitted lanes

# An env-assignment prefix. The value may be quoted and so contain spaces:
# strip_quotes turns `PATH="/x:$PATH"` into `PATH="      "`, which a bare `\S*` can
# never match, so the wrapper was refused over the spelling of an assignment standing
# in front of it. A guard that refuses correct commands teaches agents to route
# around it, which is how a guard stops protecting anything.
ENV_PREFIX = r"""(?:\w+=(?:"[^"]*"|'[^']*'|\S*)\s+)*"""

# The wrapper as an actual command head - optionally path-qualified, optionally
# behind env assignments - rather than merely named somewhere in the text.
WRAPPED = re.compile(r"""^\s*\(?\s*""" + ENV_PREFIX + r"""(?:\S*/)?obot-(?:gh|merge)\b""")

# A token assignment in front of the command, capturing the *value* so it can be
# judged. Whether an identity was really chosen depends entirely on what stands to
# the right of the `=`, which is what obot.agent#207 was made of.
TOKEN_PREFIX = re.compile(
    r"""^\s*\(?\s*""" + ENV_PREFIX
    + r"""(?:GH_TOKEN|GITHUB_TOKEN)=(?P<value>"[^"]*"|'[^']*'|\S*)"""
)

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

# Stated in the refusal itself, because the accepted spelling was being found by
# trial: three correct commands were refused in one night before the working one was
# guessed. A guard that will not say what it wants is a guessing game with a cost.
SPELLING = (
    "The accepted spellings, exactly:\n"
    "  - `obot-gh ...` or `obot.agent/scripts/obot-gh ...`, both recognised.\n"
    "  - Env assignments in front of it are fine, quoted or not:\n"
    "    `OBOT_WORKER_ID=w1 PATH=\"/x:$PATH\" obot-gh ...`.\n"
    "  - A token minted and used in the SAME Bash call, passed by name:\n"
    "    `T=$(obot.agent/scripts/obot-app-token) && test -n \"$T\" && "
    "GH_TOKEN=$T gh ...`.\n"
    "    The same call matters: every Bash call gets a fresh shell, so a `$T` set by\n"
    "    an earlier call is empty here and `gh` reads empty as no token at all.\n"
    "  - Each segment is judged on its own, so a write may share the invocation with\n"
    "    anything else: `gh issue view 1 && obot-gh issue edit 1 --add-label bug` is\n"
    "    admitted. What is refused is an unwrapped write anywhere in the command,\n"
    "    however correct its neighbours are."
)


def token_value_kind(raw_seg):
    """What credential does this segment's GH_TOKEN= prefix actually deliver?

    Returns (kind, detail): 'empty', 'substitution', 'variable' with the variable's
    name, 'opaque' for a literal, or (None, None) when there is no prefix.

    Judged against the RAW segment, not the quote-stripped one. Stripping blanks the
    inside of a quoted span, so `GH_TOKEN="$T"` and `GH_TOKEN="ghs_real"` arrive
    looking identical - and they are the two cases furthest apart in what they mean."""
    m = TOKEN_PREFIX.search(raw_seg)
    if not m:
        return None, None
    raw = m.group("value")
    if len(raw) >= 2 and raw[0] in "\"'" and raw[-1] == raw[0]:
        raw = raw[1:-1]
    if raw.strip() == "":
        return "empty", None
    if "$(" in raw or "`" in raw:
        return "substitution", None
    var = re.match(r"^\$\{?(\w+)\}?$", raw.strip())
    if var:
        return "variable", var.group(1)
    return "opaque", None


def wrapper_advice():
    """Name the lane that exists on this checkout, not the one that ought to.

    The guard can be armed in a workspace whose obot.agent checkout predates the
    wrapper - during the change that introduces both, or on a machine that has not
    pulled. A guard that refuses a write and then sends the agent to a command which
    is not there has not removed the class; it has replaced it with a dead end, and
    the next agent works around the guard instead of around the problem."""
    root = os.environ.get("CLAUDE_PROJECT_DIR") or os.path.expanduser("~/Documents/obot2")
    wrapper = os.path.join(root, "obot.agent/scripts/obot-gh")
    if os.path.exists(wrapper):
        return (
            "Run it through the wrapper. It mints an obotclaw[bot] installation token, "
            "checks the mint actually produced one, and refuses rather than falling "
            "back to his credential:\n\n"
            "  obot.agent/scripts/obot-gh <the same gh args>\n\n"
            + SPELLING +
            "\n\nBoard writes are the one thing no spelling fixes. The obotclaw App gets "
            "FORBIDDEN on a user-owned ProjectsV2 board, so no bot identity for one "
            "exists. The only route is `obot-gh --as-jeremy --reason '<why>' project "
            "...`, which runs it under his name and records it in "
            ".claude/attribution.journal. Whether that should happen at all is his "
            "decision, open at obot.roadmap#252 - it is not a hatch to take quietly."
        )
    return (
        "This checkout has no obot.agent/scripts/obot-gh yet, so mint the token "
        "yourself - in two steps, so that a failed mint stops the write instead of "
        "emptying it:\n\n"
        "  T=$(obot.agent/scripts/obot-app-token) && test -n \"$T\" && "
        "GH_TOKEN=$T gh <the same args>\n\n"
        "The two steps are the whole point. `GH_TOKEN=$(obot-app-token) gh ...` reads "
        "as though it checks the mint and does not: a command substitution in an "
        "assignment prefix has its exit status discarded, so a failed mint leaves "
        "GH_TOKEN empty, `gh` reads empty as unset, and the write goes out as "
        "@jwildfire while exiting 0 (obot.agent#207). Assigning to a plain variable "
        "first is what makes the failure visible to `&&`.\n\n"
        + SPELLING +
        "\n\nBoard writes have no route on this checkout at all: the App gets FORBIDDEN "
        "on a user-owned ProjectsV2 board, and an unwrapped `gh project ...` is what "
        "this guard refuses. That deadlock is his to resolve, open at obot.roadmap#252."
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


for seg, raw_seg, seg_start in SEGMENTS:
    if LAUNDERING.search(seg):
        deny(
            "attribution-guard: `GH_TOKEN=$(gh auth token)` runs the write as @jwildfire "
            "using his own credential - which is precisely what obot.agent#197 is about. "
            "Agent writes go out as obotclaw[bot].\n\n" + wrapper_advice()
        )

    if WRAPPED.search(seg):
        continue  # the wrapper enforces its own mint and refuses on failure

    # Identify the write first. A segment that is not a write is none of this guard's
    # business, whatever its token prefix says - `GH_TOKEN=$(...) gh issue view` is a
    # read, and reads were never the problem.
    label = None
    for pattern, pattern_label in PATTERNS:
        if pattern.search(seg):
            label = pattern_label
            break
    if label is None and GRAPHQL_CALL.search(seg) and MUTATION.search(raw_seg):
        label = ("a GraphQL mutation - sub-issue links and board writes are mutations, "
                 "and they were the bulk of what went out under his name")
    if label is None:
        continue

    kind, var = token_value_kind(raw_seg)

    if kind == "opaque":
        continue  # a credential was resolved before this point; its failure was visible

    if kind == "variable":
        # `GH_TOKEN=$T` is the recommended spelling, and it is only a credential when
        # something in reach actually set $T. Each Bash tool call gets a fresh shell, so
        # a variable assigned in an earlier call is gone by the time this one runs: the
        # write resolves to an empty token, `gh` reads empty as unset, and it goes out
        # as @jwildfire - #207 again, reached by following the instructions. So the
        # assignment has to travel with the write, or the variable has to be exported
        # into the environment this hook can see.
        # Searched in the quote-stripped text, so `echo "T=nonsense"` earlier in the
        # command is not mistaken for an assignment. A real one survives stripping:
        # `T=$(mint)` keeps its substitution, and `T="literal"` keeps its `T=`.
        assigned_here = re.search(
            r"(?:^|[\s;&|(])" + re.escape(var) + r"=", stripped[:seg_start])
        if assigned_here or os.environ.get(var, "").strip():
            continue
        deny(
            "attribution-guard: this is {}, and its token is `${}`, which nothing in "
            "this command assigns and which is not set in the environment. Each Bash "
            "call runs in a fresh shell, so a variable set by an earlier call is gone "
            "by now: `${}` expands to nothing, `gh` reads an empty GH_TOKEN as unset, "
            "and the write goes out as @jwildfire while reporting success "
            "(obot.agent#207).\n\nMint and write in the same Bash call, so a failed "
            "mint stops the write:\n\n"
            "  T=$(obot.agent/scripts/obot-app-token)\n"
            "  test -n \"$T\" || exit 1\n"
            "  GH_TOKEN=$T gh <the same args>\n\n{}".format(
                label, var, var, wrapper_advice())
        )

    if kind == "empty":
        deny(
            "attribution-guard: this is {}, and GH_TOKEN is set to the empty string. "
            "`gh` reads an empty GH_TOKEN as unset and falls back to the ambient "
            "credential, which is @jwildfire's - so this lands in his history as his. "
            "An empty assignment is not a statement about identity; it is the absence "
            "of one (obot.agent#197, #207).\n\n{}".format(label, wrapper_advice())
        )

    if kind == "substitution":
        deny(
            "attribution-guard: this is {}, and its token comes from `GH_TOKEN=$(...)`, "
            "which cannot fail safely. A command substitution in an assignment prefix "
            "has its exit status discarded, so when the mint fails - expired "
            "installation, no network, a one-hour token running out mid-sequence - "
            "GH_TOKEN is set to the empty string, `gh` reads it as unset, and the write "
            "goes out as @jwildfire while reporting success. That is obot.agent#207, "
            "and it has already put one write in his history that cannot be "
            "reattributed.\n\n{}".format(label, wrapper_advice())
        )

    deny(
        "attribution-guard: this is {}, and with no token set it authenticates as "
        "@jwildfire - so his GitHub history records him doing it. Two days of "
        "labels, milestones, parent links and board moves landed under his name on "
        "~100 issues that way, none of which he made (obot.agent#197).\n\n{}"
        .format(label, wrapper_advice())
    )

sys.exit(0)  # defer
