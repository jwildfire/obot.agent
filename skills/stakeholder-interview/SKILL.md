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
