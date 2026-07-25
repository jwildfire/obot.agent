# Renderer requirements — moved to safety.viz

**The requirement matrices now live in [`jwildfire/safety.viz`](https://github.com/jwildfire/safety.viz) under [`requirements/`](https://github.com/jwildfire/safety.viz/tree/HEAD/requirements).** Edit them there.

They moved in [obot.roadmap#64](https://github.com/jwildfire/obot.roadmap/issues/64): every safety.viz feature used to need two coordinated PRs — the implementation in safety.viz and its matrix rows here — merged in a fixed order and followed by a requirement-extract regen. With the matrices next to the code, a behavior change and the requirement rows that describe it land in one PR, and safety.viz CI checks the extract against the matrix in the same checkout.

| Was here                                                                          | Now                                              |
| --------------------------------------------------------------------------------- | ------------------------------------------------ |
| `docs/requirements/<renderer>.md`                                                 | `safety.viz` → `requirements/<renderer>.md`      |
| `npm run requirements` in safety.viz reading this directory via `REQUIREMENTS_SRC` | the same command reading `requirements/` in-repo |

Pre-move history for each matrix is in this repo's git history (`git log --follow -- docs/requirements/<renderer>.md`). Filenames are unchanged, so the history lines up with the files in their new home.

## What stayed here

- [`agentic-ai-review.md`](agentic-ai-review.md) — the harvest-phase AI review record: reviewer summaries and recommended edits per renderer. It documents how the matrices were prepared for human review, which is obot.agent program history rather than a safety.viz artifact.
- [`../../interviews/p004-grill-queue.md`](../../interviews/p004-grill-queue.md) — the Jeremy-facing grill-me questions that came out of that review.
- [`../../skills/requirements-harvesting/SKILL.md`](../../skills/requirements-harvesting/SKILL.md) and [`../../scripts/harvest_wiki_requirements.py`](../../scripts/harvest_wiki_requirements.py) — the harvesting workflow that bootstraps a new matrix from wiki sources. Harvesting is agent tooling and stays here; it now writes into a safety.viz checkout.

## Review sequence (unchanged)

1. **Harvest** wiki content into broad source-backed matrices.
2. **Agentic AI review** assigns renderers to sub-agents for line-by-line judgment. This is not a parser/script step.
3. **Grill-me review** asks Jeremy only the decisions that remain ambiguous or product-sensitive.
4. **Matrix cleanup** applies accepted split/merge/drop/reword decisions.
5. **Implementation** maps reviewed requirements to tests, demos, and evidence — now in the same repo, and the same PR, as the matrix edit.

## Status rule (unchanged)

A requirement is not considered Jeremy-approved just because AI review flagged it. AI review only makes the human review tractable by identifying likely artifacts, proposed splits, and explicit questions.
