# Renderer requirements

Requirement matrices harvested from RhoInc wiki sources and prepared for agentic AI review.

The current matrices are working drafts. The initial harvest intentionally captured too much source text, including line-break artifacts, legacy Webcharts/CAT implementation details, and exploratory notes. Agentic review findings are tracked in:

- [`agentic-ai-review.md`](./agentic-ai-review.md) — reviewer summaries and recommended edits by renderer.
- [`../../interviews/p004-grill-queue.md`](../../interviews/p004-grill-queue.md) — Jeremy-facing grill-me questions and recommendations.

| Renderer | Current matrix rows | Agentic review status | Primary follow-up |
|---|---:|---|---|
| [ae-timelines](./ae-timelines.md) | 43 | reviewed by sub-agent | resolve sort/custom-mark/API questions |
| [aeexplorer](./aeexplorer.md) | 74 | reviewed by sub-agent | resolve input timing, highlight style, detail-table scope |
| [paneled-outlier-explorer](./paneled-outlier-explorer.md) | 114 | reviewed by sub-agent | separate exploratory ideas from P004 requirements |
| [safety-delta-delta](./safety-delta-delta.md) | 48 | reviewed by sub-agent | resolve visit/config semantics and detail placement |
| [safety-histogram](./safety-histogram.md) | 125 | reviewed by sub-agent | invalid-data handling remains open; p-value rows blocked pending exact method/fixtures |
| [safety-outlier-explorer](./safety-outlier-explorer.md) | 84 | reviewed by sub-agent | resolve custom marks and legacy API scope |
| [safety-results-over-time](./safety-results-over-time.md) | 58 | reviewed by sub-agent | merge tooltip rows and repair unscheduled-visit config rows |
| [safety-shift-plot](./safety-shift-plot.md) | 39 | reviewed by sub-agent | split brush/invalid-data behavior and define visual viewport |
| [web-codebook](./web-codebook.md) | 223 | reviewed by sub-agent | split large interaction rows and resolve initial visibility/type indicators |

## Review sequence

1. **Harvest** wiki content into broad source-backed matrices.
2. **Agentic AI review** assigns renderers to sub-agents for line-by-line judgment. This is not a parser/script step.
3. **Grill-me review** asks Jeremy only the decisions that remain ambiguous or product-sensitive.
4. **Matrix cleanup** applies accepted split/merge/drop/reword decisions.
5. **Implementation** maps reviewed requirements to tests, demos, and evidence.

## Status rule

A requirement is not considered Jeremy-approved just because AI review flagged it. AI review only makes the human review tractable by identifying likely artifacts, proposed splits, and explicit questions.
