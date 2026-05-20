# Interview Framework

## Purpose

The interview framework is a general mechanism for capturing Jeremy's input through Telegram and turning it into durable project state. It is not limited to requirements. Use it for architecture decisions, prioritization, terminology, design tradeoffs, review questions, release decisions, scope boundaries, and open issues that need human judgment.

## Design goals

- Make it easy for Jeremy to answer in Telegram.
- Keep each question small and answerable.
- Preserve context and links so the answer can be interpreted later.
- Convert answers into explicit decisions, follow-up tasks, or unresolved questions.
- Sync durable outcomes back to GitHub, project pages, requirement matrices, design docs, or issue comments as appropriate.

## Core objects

### Interview

A collection of related questions tied to a project, repo, issue, PR, or design document.

### Question

One focused prompt with a stable ID, context, source, status, answer, decision, and follow-up path.

### Answer

Jeremy's Telegram response, captured verbatim or summarized with a link/reference to the originating chat when possible.

### Decision

The operational interpretation of the answer. Decisions should be written as implementation guidance, not just a transcript.

## Question ID format

Use stable IDs:

`P<project-number>-<topic>-Q###`

Examples:

- `P004-ARCH-Q001`
- `P004-TEST-Q003`
- `P004-API-Q004`

## Status values

- `draft` - question prepared but not asked
- `asked` - sent to Jeremy in Telegram
- `answered` - Jeremy replied, answer captured
- `decided` - answer converted into implementation guidance
- `deferred` - intentionally postponed
- `closed` - no further action needed

## Telegram asking rules

- Ask at most 1-3 questions at a time.
- Prefer one question when the topic is architectural or nuanced.
- Include just enough context to answer without opening GitHub.
- Offer options only when they are real choices.
- If a free-form answer is better, ask free-form.
- Do not bury the actual question under long background.

## GitHub/project sync rules

After an answer is captured, update the durable target:

- design docs for architecture decisions
- requirements matrix for requirement decisions
- GitHub issues for task scope or acceptance criteria
- PR comments for review decisions
- project overview for major direction changes
- daily diary for important project decisions

## Minimal workflow

1. Identify open question.
2. Create or update interview file.
3. Ask Jeremy in Telegram.
4. Capture answer in interview file.
5. Convert answer into decision and follow-up action.
6. Update durable project artifact.
7. Mark question status.

## Quality bar

A completed interview entry should let a future agent understand:

- what was asked
- why it mattered
- what Jeremy answered
- what decision was made
- what implementation or documentation changed as a result

## Recommendation requirement

When asking Jeremy an interview question, include obot's recommendation whenever possible, along with a short justification and concise pros/cons for the realistic options. Skip a recommendation only when the question is purely factual or when there is not enough context to form a defensible position.

## Telegram formatting rules

Use the interview prefix `😺📝` for interview prompts. Always include the actual question text, not just the question ID. Keep each Telegram message short enough to avoid truncation; if context plus options plus recommendation is long, split into multiple messages. Preferred split:

1. `😺📝 Interview <ID>` with context and exact question.
2. Recommendation and short pros/cons.
3. Options, if needed.

Do not rely on one long message for nuanced architectural questions.
