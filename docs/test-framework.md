# Test Framework

This framework defines how nextgen SafetyGraphics renderers should prove behavior before replacing legacy Webcharts renderers. The goal is not formal validation by itself; the goal is repeatable, inspectable evidence that can support later qualification decisions.

## Test layers

1. **Static checks**
   - lint, format, type/JSDoc checks, dependency audit, and build.
   - Evidence: command output in PR or CI.
2. **Unit tests**
   - pure data transforms, settings normalization, derived variables, filters, summaries, and validation warnings.
   - Evidence: Vitest/Jest tests tagged with requirement IDs.
3. **Renderer integration tests**
   - lifecycle API, DOM/control creation, chart dataset construction, listing/export generation, and state transitions.
   - Evidence: jsdom or lightweight browser tests tagged with requirement IDs.
4. **Browser functional tests**
   - real rendered demos: controls, filters, hover/click/brush, listing search/sort/pagination/export, console warnings/errors.
   - Evidence: Playwright or OpenClaw browser QA notes with URL, cache-busting token, steps, and requirement IDs.
5. **Visual regression tests**
   - screenshots for stable baseline states and critical interactions.
   - Evidence: screenshot diffs with explicit thresholds and accepted-review notes.
6. **Manual clinical review checkpoints**
   - behaviors that require SME judgment, statistical interpretation, or product direction.
   - Evidence: linked interview decision, issue comment, or review note.
7. **Traceability checks**
   - every requirement row has a status, evidence type, and test/evidence link before a migration is considered complete.
   - Evidence: requirements matrix completeness check.


## AI review stage

After raw harvesting and before Jeremy review, run an agentic AI review, preferably with one or more sub-agents assigned disjoint renderer scopes. The reviewer receives the harvested matrix, package README/config/API context, and source wiki pages, then performs line-by-line sanity review.

The AI review should:

- verify each row is a standalone, testable requirement;
- merge obvious line-break/settings artifacts into the correct parent row;
- remove link/image/overview rows that are not requirements;
- propose wording edits for confusing rows;
- flag legacy CAT/viz-library/Webcharts-specific rows that need scope decisions;
- flag statistical or validation-sensitive rows needing explicit review;
- write grill-me candidates to `interviews/p004-grill-queue.md`.

AI review is not approval. It is a judgment/triage step that makes Jeremy's review tractable. Do not implement it as a purely programmatic parser.

## Evidence types

Use these values consistently in requirement matrices:

- `unit` - deterministic pure-function test.
- `integration` - DOM/renderer lifecycle test.
- `browser` - end-to-end rendered UI test.
- `visual` - screenshot or image comparison.
- `manual` - SME or reviewer confirmation.
- `deferred` - intentionally out of scope with a rationale.
- `not-applicable` - legacy behavior intentionally removed or replaced.

## Requirement status values

- `harvested` - auto-extracted from wiki; not reviewed yet.
- `reviewed` - accepted as a real requirement and de-duplicated.
- `implemented` - behavior exists in nextgen code.
- `tested` - automated or manual evidence exists.
- `deferred` - explicitly not part of the current migration.
- `replaced` - legacy behavior has a documented replacement.
- `blocked` - implementation needs a decision or dependency.

## Minimum definition of done per renderer

A nextgen renderer is not ready for review until:

1. All wiki sources have been harvested into `docs/requirements/<renderer>.md`.
2. The matrix has passed AI review to remove obvious parsing artifacts and flag unclear rows.
3. Jeremy has reviewed or deferred rows marked `needs-jeremy-review`, usually through the grill-me/interview workflow.
4. A baseline legacy demo link and nextgen demo link exist.
5. Every reviewed requirement has an evidence type.
6. Core behavior has automated or browser evidence.
7. Known gaps are documented in README and PR body.
8. Browser QA confirms no unexpected console errors on the review demo.
9. The PR states what is implemented, deferred, replaced, and still risky.

## Browser QA note template

```markdown
## Browser QA evidence

- Renderer:
- URL:
- Cache token / commit:
- Browser/tool:
- Requirements checked:
- Controls checked:
- Interactions checked:
- Listing/export checked:
- Console result:
- Visible-data sanity check:
- Known gaps:
```

## CI recommendation

Each renderer repo should eventually expose:

```bash
npm run lint
npm run test
npm run test:browser
npm run build
```

Short-term spikes may not have all commands yet, but PRs must state which layers are missing.

## Traceability pattern

Test names should include requirement IDs:

```js
test('SSP-INT-001 brush selection shows linked participant listing', async () => {
  // test steps
});
```

For browser/manual evidence, add the requirement IDs to the QA note or PR checklist.

## Handling approximations

If nextgen behavior approximates a legacy statistical or visual feature, label it explicitly:

- What is approximated.
- Why exact parity is not implemented yet.
- Whether the approximation is acceptable for review only.
- What evidence would be required before production use.

Do not present screening approximations as validated statistical procedures.
