---
name: grill-me
description: "Run a resumable, multi-session elicitation interview with @jwildfire to extract what he wants built for a goal — including the parts he holds tacitly and the parts he does not yet know. Use when he says '/grill-me', 'interview me about <goal>', 'grill me on this', or a goal needs his intent captured before requirements can be filed. Do NOT use for a single known question (that is a plain AskUserQuestion), for approval gates (Approval Convention), or for decisions already scoped in a decision artifact (post to its Q&A thread)."
argument-hint: "<goal issue #> [--prep | --resume | --wrap]"
---

# grill-me — resumable goal elicitation

Interview @jwildfire to turn what he wants — stated, tacit, and not-yet-known — into a goal
body he ratifies and requirements the hub can track. The interview is a **first-class
deliverable**: its output must land in durable artifacts or the exercise has failed.

Named for the interview pattern he remembers: the local P004 "grill-me queue"
(`interviews/p004-grill-queue.md`) and Matt Pocock's public `grill-me`/`grilling` skills
([mattpocock/skills](https://github.com/mattpocock/skills)). This skill adapts that
technique to how this program works: reactive artifacts first, short resumable sessions,
AskUserQuestion menus, and a hub capture path. Method evidence:
`obot.roadmap/reports/decisions/2026-08-15-app-elicitation-method/`.

## The five rules (evidence-backed, non-negotiable)

1. **He reacts; he does not generate.** Experts omit up to ~70% of what matters when
   asked to describe from scratch; the CSR precedent's only tacit surfacing (hub#131)
   arrived as an *objection to a concrete proposal*, not an answer to a question. Every
   session puts something concrete and correctable in front of him.
2. **Always a comparison set, never one draft.** A single design gets inflated approval;
   criticism unlocks only when 3 genuinely divergent options sit side by side (Tohidi,
   CHI 2006). Divergent = each option built on a different governing principle, at least
   one option the agent genuinely believes he will reject. Never announce a straw man as
   deliberately wrong — role-played bait gets discounted (Nemeth 2001).
3. **His unprompted answer is recorded before any agent hypothesis is shown** (IDEA
   round-1 discipline). An LLM's default mode is anchor generation; for generative
   questions, ask open first, reveal the agent's candidates after, keep both, and treat
   drift between them as data. Menus are for *convergence* questions only, and every menu
   carries a live "none of these — here is what it actually is" escape.
4. **Facts are never his job.** Anything discoverable from the workspace, the hub, the
   code, or the web is looked up by an agent before the session. Only genuine decisions
   and genuinely tacit knowledge reach him (grilling's facts-vs-decisions split).
5. **No yes/no read-backs.** Chat confirmation manufactures false agreement (81%
   confirmation vs 72% coder agreement, and models paraphrase with plausible inferences).
   Read-backs quote him verbatim, mark everything else `INFERRED`, and ask him to *find
   what is wrong* or choose between candidate readings — never "is this right?".

## Roles (separate turns, not one prompt)

- **Prep agent** (context-rich, offline): builds the reactive artifacts, mines the record
  (issues, diaries, prior sessions) for latent candidate requirements with verbatim
  source quotes, and maintains the fact base. Runs between sessions, costs him nothing.
- **Interviewer** (deliberately context-light, live): runs the rounds. Loaded context
  measurably suppresses clarifying questions — the interviewer gets the state file and
  the current topic's brief only, not the whole program history.
- **Critic** (separate agent/call, mandatory): before each session, classifies the
  drafted questions against interviewer-mistake types (leading, compound, solution-space,
  omission); after each session, runs a **devil's-advocate pass** on the captured answers.
  Dissent must be a *role with disagreement as its job* — "push back" prompt lines are
  empirically worthless (99.2% vs ~55% disagreement).

## State: the elicitation ledger

Lives on the hub (direct-commit-to-main grant; a commit per answer batch, never batched
to session end): `obot.roadmap/reports/goal-<N>-elicitation/` containing:

- `log.md` — per-question ledger. Entry schema (forked from
  `templates/interview-question.md`; `Asked:` not `Asked in Telegram:`):
  `## <GOAL>-<TOPIC>-Q### — title` with **Status** (draft | asked | answered | decided |
  deferred | closed), **Context**, **Question** (exact text), **Options**, **Asked**
  (date/session), **Answer** (his words, VERBATIM), **Decision** (operational reading,
  marked `INFERRED` until he confirms), **Follow-up artifacts** (the issue/PR/commit it
  became — the anti-evaporation field), **Notes**.
- `answers.json` — `[{id, topic, question, answer_verbatim, decision, status,
  followups}]`; the structured feed requirement drafting reads.
- `frontier.md` — the design tree: **Frontier** (askable now — prerequisites settled),
  **Blocked** (waiting on an open answer), **Fog of war** (questions he or the agent can
  tell are coming but cannot yet phrase — graduation test: *can the question be stated
  precisely now*, not answered now), **Done**.
- `index.html` + `README.md` — published view per the hub reports contract, so he can
  review state in Chrome between sessions.

Resumability = the ledger IS the interview. Any session, any day: read the ledger, pick
the top frontier topic, run one session, write back, commit.

## Phase 0 — prep (agent only, no @jwildfire time)

1. Create the ledger; seed the design tree from the goal issue, its decision artifacts,
   and open questions (for #79: A3 + A4 are pre-seeded frontier topics).
2. Build the reactive artifacts (publish to the ledger folder, self-contained HTML):
   - **Fit-gap matrix** with an explicit last column `target` left partly blank — rows =
     capabilities of the thing being replaced (e.g. safetyGraphics surfaces) plus what
     comparable tools ship; his job is to fill/correct the target column. (CSR 14-row
     table precedent — the target column forces positions, not wishes.)
   - **As-is / to-be workflow walkthrough** — a numbered 6–10 step narrative of a real
     user doing the real task, wrong steps instantly visible to a domain expert.
   - **Three divergent goal drafts** — full candidate `Intent` + `Boundaries` prose,
     each under a different governing principle, presented side by side.
   - **Mined candidates** — latent requirements harvested from the program record, each
     with its verbatim source quote, presented accept/reject/edit.
3. Critic pass on all planned round-1 questions. Dry-run the protocol against a
   simulated persona if the topic is large; fix where it goes shallow.

## Phase 1 — reactive review session (~30 min, his demonstrated pattern)

One message: links to the artifacts + the round-1 frontier as an AskUserQuestion batch
(≤4 questions/round; one open-generative question FIRST, menus after). He red-lines the
walkthrough, corrects the matrix target column, reacts to the three drafts. Expect the
most valuable content to be **unsolicited objections** — capture them verbatim as new
ledger entries even (especially) when they answer no asked question.

## Phase 2..n — grill rounds (15–25 min each, one topic per session)

Per session: read ledger → claim ONE frontier topic → up to 3 rounds of ≤4 questions via
AskUserQuestion → write back verbatim → commit → close with: (a) a quote-anchored
read-back framed as "find what's wrong / choose between readings", (b) a fog-of-war
update, (c) a preview of the next frontier so he can veto the direction. Techniques to
rotate by topic type (all survive async chat; see the method artifact for sources):

- **Laddering** (≤5 rungs, echo the chain back numbered) for value/why chains — but
  triangulate every stated "why" against behavioral evidence; introspection is
  unreliable.
- **Critical-incident walkthroughs** — "tell me about a time safetyGraphics burned you /
  you hacked around it"; multi-pass across turns.
- **Teach-a-novice** — the agent plays apprentice, he teaches the task end to end;
  forces articulation of what he has stopped noticing.
- **Repertory-grid triads** over real, familiar elements (the 12 renderers, competing
  tools): "which two group together, and on what dimension?" — his dimensions become the
  axes for later option sets.
- **Premortem** on the emerging goal: "it is 2027 and the app failed — the agent
  proposes 10 reasons, strike the implausible, add the ones only you can see."
- **Forced ranking / budget cut with NO draft position** at least once — the CSR
  precedent shows blanket approval of draft positions costs signal; his actual
  priorities must be recorded, not inferred. (Decide-by-exception draft positions remain
  the default for narrow technical forks — they cost him one message.)
- **Boundary/ownership questions asked explicitly** — both CSR misses were
  where-does-it-live questions no one asked.

Satisficing monitors: answer-length collapse, agreement streaks, always-first-option →
switch modality (comparison, artifact markup, incident), never repeat the question.
Maintain an **ambiguity ledger**: the between-turn review pass catches ~2/3 of
ambiguities; open each session from it.

## Phase W — wrap (goal capture; the part that must not evaporate)

1. Draft the full replacement goal `Intent` + `Boundaries` prose in the ledger, built
   only from `decided` entries, each traceable to question IDs.
2. Approval Convention prompt (Approve / Request changes / Pause). Goal bodies are
   Jeremy-maintained: the default lane is a **proposed-body comment** on the goal issue;
   with his explicit in-session grant (ask as `<GOAL>-META-Q000` at the very start of
   Phase 1) the agent applies it under the exception route — strikethrough not delete,
   exception named in a comment.
3. File requirements via `/requirement-drafting` (read the live template; five exact
   `###` headings; milestone before work). Each requirement names its source question
   IDs; each ledger entry's **Follow-up artifacts** field names the issue it became.
   Bidirectional or it didn't happen.
4. Close any decision-artifact questions the interview answered (status line + index row
   + Q&A thread comment, verbatim-relay format).
5. Ledger README gets a final status; unresolved fog-of-war items become either new
   frontier (schedule another session) or filed issues.

## Time cost (honest)

Phase 0 costs him nothing. Phase 1 ≈ 30 min. Expect 2–4 grill sessions of 15–25 min,
then a wrap review ≈ 20 min. **Total: ~1.5–2.5 h of his attention across 4–6 short
sittings.** One open interview captures roughly a third of a domain and each pass misses
~25% even for an LLM interviewer — plan for multiple passes with different instruments
and let the fog-of-war section carry the tail; do not promise one-session completeness.

## Failure modes this skill exists to avoid

- The blank-page interview ("what do you want?") — loses most of the domain by design.
- The rubber-stamp — all draft positions approved in one clause, zero signal on what he
  actually holds an opinion about.
- The evaporating exercise — answers that live only in a transcript. Commit per batch.
- The passive session — "agreed × 40" producing a plan the agent wrote and he nodded at.
  The critic's devil's-advocate pass and the no-yes/no-read-back rule are the guards.
- The context-loaded interviewer that resolves his ambiguity from priors instead of
  asking.
