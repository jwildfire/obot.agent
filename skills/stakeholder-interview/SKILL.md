---
name: stakeholder-interview
description: "Use when Jeremy's input is needed through Telegram for any project decision — architecture, prioritization, requirements, acceptance criteria, release, terminology, process. Guides question writing with a recommendation, capture into interviews/ logs, and propagating decisions into durable artifacts."
---

# Stakeholder Interview Skill

Use this skill when Jeremy's input is needed through Telegram for any project decision, not only requirements.

## Scope

Use for:

- architecture decisions
- open project questions
- requirements clarifications
- prioritization
- acceptance criteria
- release decisions
- terminology
- review follow-up
- workflow/process decisions

## Workflow

1. Identify the durable source of the question: GitHub issue, PR, design doc, project page, requirements matrix, or local note.
2. Create or update an interview file using `templates/interview-log.md`.
3. Assign a stable question ID.
4. Ask 1-3 concise Telegram questions.
5. When Jeremy replies, capture the answer and convert it into an explicit decision.
6. Update the durable artifact that depends on the answer.
7. Mark the question status and list follow-up tasks.

## Question writing rules

- Start with context in one sentence.
- Ask one actionable question.
- If options are known, list 2-4 choices and allow free-form override.
- Avoid leading language.
- Avoid asking for confirmation of obvious implementation details unless they affect scope or validation.

## Output files

Default location:

`interviews/<project-or-topic>.md`

For P004:

`interviews/p004-open-questions.md`

## Recommendation requirement

Whenever possible, include your recommended answer before asking Jeremy to decide. Keep it concise: state the recommendation, why it is preferred, and the main pros/cons of the realistic alternatives. Do not overstate certainty; surface assumptions and ask for correction when needed.

## Telegram formatting rules

Use the interview prefix `😺📝` for interview prompts. Always include the actual question text, not just the question ID. Keep each Telegram message short enough to avoid truncation; if context plus options plus recommendation is long, split into multiple messages. Required split for most interview prompts:

1. First message: `😺📝 Interview <ID>` with the exact question only plus minimal context.
2. Immediate follow-up message: recommendation, short justification, and pros/cons/options if useful.

Do not combine the question and recommendation in one long message. Do not send a question without the immediate recommendation follow-up unless Jeremy explicitly asks for question-only mode.
