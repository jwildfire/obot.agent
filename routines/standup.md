# Standup routine

The nightly standup is a scheduled Claude Code cloud routine
([docs](https://code.claude.com/docs/en/routines)) on the `jwildfire/obot.roadmap`
repository. It reads GitHub and nothing else, and it asks nothing that is not a blocked
issue.

## Schedule it

From any Claude Code session signed in to @jwildfire's account:

```text
/schedule nightly at 21:00 America/New_York: run the standup routine in routines/standup.md of jwildfire/obot.agent against jwildfire/obot.roadmap
```

Or at [claude.ai/code/routines](https://claude.ai/code/routines): repository
`jwildfire/obot.roadmap`, environment `obot.roadmap`, schedule nightly, prompt below.
Routines run autonomously with no permission prompts; the connected GitHub account is the
actor.

## The prompt

```text
You are rendering tonight's standup for the obot program. Read GitHub only; do not read
or write any local state other than the file you publish.

1. List open issues labelled `objective` on jwildfire/obot.roadmap. For each objective, walk
   its requirements (its sub-issues) and their tasks (theirs) — GET
   /repos/{owner}/{repo}/issues/{n}/sub_issues, paginated, across repositories. Count
   nodes closed, open without the `blocked` label, and open with the `blocked` label. For
   each requirement, read its `status:` label (backlog, ready, in session, review,
   released — exactly one; two or none is drift, say so) and its latest comment whose
   body starts with "### Complete"; take the three sections verbatim and roll them up
   under the objective.

2. List every open issue labelled `blocked` across jwildfire/obot.roadmap,
   jwildfire/safety.viz, jwildfire/gsm.safety, jwildfire/open.csr,
   jwildfire/open.gismo and jwildfire/demo-301. For each, take the latest comment's
   first paragraph as the question, and the objective it belongs to by walking parents.

3. Write standup.md, plain text, no markup beyond headings, in this shape:

   # Standup — <date>

   ## Objectives
   ### <objective title> (#N) — <complete>/<in progress>/<blocked> of <total>
   Requirements: #N <status>, #N <status>, …
   Complete: <the sentences from the requirements' nightly comments, one per line>
   In progress: <one per line>
   Blocked: <one per line, "#N — question">

   ## Questions for Jeremy
   - <repo>#N (<objective title>): <the question, quoted>
   (If no issue is blocked: "No open questions.")

   ## Release candidates waiting on Jeremy
   - <repo>#N <title> — open <days> days
   (open PRs whose title matches `{package} vX.Y.Z-RCn`, any of the repositories above)

4. Publish the file as `standup.md` on the `session-state` branch of
   jwildfire/obot.roadmap via the contents API (PUT /repos/jwildfire/obot.roadmap/
   contents/standup.md with the branch and the current sha). If the content below the
   date line is identical to what is already there, do not commit.

5. Do not comment on any issue, open any PR, or change any label. The standup is
   read-only except for the file it publishes.
```

## Why this shape

@jwildfire, 2026-09-10: "standup should give a summary of which objectives are
complete/in progress/blocked. All questions in standup should be tied to blocked
issues." The daily check-in reads `standup.md` aloud in voice mode, so the file stays
plain text with no client-side rendering, as it did under the retired publisher.
