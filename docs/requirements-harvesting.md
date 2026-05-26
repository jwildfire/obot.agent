# Requirements Harvesting

## Source priority

1. Functional specs in the upstream wiki.
2. Data specification and settings schema.
3. Existing regression tests and test notes.
4. Example pages and default settings.
5. README and package metadata.
6. Historical issues/PRs if they clarify expected behavior.

## Extraction rules

- Split compound bullets into atomic requirements.
- Preserve exact clinical intent, but rewrite as testable statements.
- Keep a source URL or source file path for every requirement.
- Mark requirements as automated, manual, deferred, or unresolved.
- Do not silently drop requirements that depend on Webcharts behavior.

## Output format

Use the template in `templates/requirements-matrix.md`.

## AI review stage

Raw harvesting is intentionally broad. Before human review, perform an agentic AI review. Assign one or more sub-agents disjoint renderer scopes and provide each reviewer with:

- the harvested requirement matrix;
- the package README, configuration/API docs, and source wiki pages;
- the instruction to review each row as a potential standalone requirement.

The reviewer should remove obvious non-requirements, merge orphaned code/settings snippets into nearby rows, propose wording edits, flag ambiguous rows as `needs-jeremy-review`, and create/update `interviews/p004-grill-queue.md` for Telegram/grill-me follow-up.

Rows marked `needs-jeremy-review` should not block documentation, but they should be resolved before implementation is called complete for that renderer.
