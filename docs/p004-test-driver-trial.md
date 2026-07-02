# P004 Test-driver Trial: Safety Histogram Reviewed Rows

## Test-driver evidence

- Renderer: Safety Histogram (`safety-histogram`)
- Source requirements: `docs/requirements/safety-histogram.md`
- Reviewed requirement IDs covered: `SH-FUNC-004A`, `SH-FUNC-004B`, `SH-FUNC-004C`, `SH-FUNC-005A`, `SH-FUNC-005B`, `SH-FUNC-005C`, `SH-FUNC-005D`, `SH-FUNC-010`, `SH-FUNC-011`, `SH-FUNC-012`
- Implementation/demo URL: none available in this repository
- Commands run:
  - `git -C /private/tmp/safety-agent-edit status --short --branch`
  - `find /private/tmp/safety-agent-edit -maxdepth 3 -type f | sort`
  - `sed -n ... skills/p004-test-driver/SKILL.md docs/test-framework.md docs/requirements/safety-histogram.md`
- Tests added/proposed: proposed only; no executable renderer package exists in this repository
- Results: blocked from execution until a renderer implementation, package scripts, selectors, and demo fixture route exist
- Console result: not run; no browser demo exists
- Screenshots/artifacts: none; no rendered target exists
- Blockers:
  - No Safety Histogram renderer source, demo app, or test harness exists in this repository.
  - No canonical fixture file exists for the reviewed rows.
  - DOM/test selectors are not defined for controls, histogram bars, normal-range band, selected-bar state, footnote/count text, or linked detail table.
  - Exact histogram bin boundaries are implementation-dependent and must be deterministic for linked-table tests.
- Recommended implementation fixes:
  - Expose stable `data-testid` or equivalent selectors for all controls and rendered states listed below.
  - Add a deterministic fixture and a demo route that renders it without network dependencies.
  - Add unit/integration helpers for domain calculation, normal-range availability, selected-bin record mapping, and listing row projection.
  - Add Playwright browser tests for the full user-facing workflow once the renderer exists.

## Trial scope

This trial intentionally covers only rows that are already `reviewed` in `docs/requirements/safety-histogram.md` and named in the prompt. It does not cover `ai-reviewed`, `needs-jeremy-review`, `blocked`, `replaced`, or unrelated regression rows.

## Required fixture

Create `test/fixtures/safetyHistogram.normalRange.json` or equivalent CSV-derived rows with these fields mapped by renderer settings:

- `USUBJID`: participant identifier.
- `TEST`: measure name.
- `STRESN`: numeric result.
- `STRESU`: unit.
- `STNRLO`: lower limit of normal.
- `STNRHI`: upper limit of normal.

Minimum fixture shape:

- Measure `ALT (U/L)` with complete normal-range values: lower `10`, upper `40`.
- At least six `ALT (U/L)` records distributed across three deterministic bins:
  - below normal, for example result `5`;
  - within normal, for example results `12`, `20`, `30`;
  - above normal, for example results `45`, `60`.
- Measure `BILI (mg/dL)` or similar with missing/blank normal-range columns for every row, to prove the Normal Range control is hidden/unavailable.
- Distinct subject IDs per record so linked-table assertions can verify exact row membership.
- Values near proposed x-axis bounds, for example `5` and `60`, to verify lower/upper limit changes visibly alter bar inclusion or axis ticks.

Recommended deterministic renderer settings for the tests:

```js
const settings = {
  measure_col: 'TEST',
  value_col: 'STRESN',
  id_col: 'USUBJID',
  unit_col: 'STRESU',
  normal_col_low: 'STNRLO',
  normal_col_high: 'STNRHI',
  start_value: 'ALT (U/L)',
  normal_range: true,
  display_normal_range: false,
  x: { domain: [0, 70] },
  binning: { boundaries: [0, 10, 20, 40, 70] },
  details: [
    { value_col: 'USUBJID', label: 'Subject Identifier' },
    { value_col: 'STRESN', label: 'Result' },
    { value_col: 'STNRLO', label: 'Lower Limit of Normal' },
    { value_col: 'STNRHI', label: 'Upper Limit of Normal' }
  ]
};
```

If the implementation uses different setting names, keep the same semantic fixture and update only the adapter layer in test setup.

## Proposed Vitest coverage

Use Vitest for deterministic logic that should not require a real browser. Suggested file: `test/safety-histogram.requirements.test.js`.

| Requirement ID | Test layer | Proposed test name | Fixture needed | Expected assertions | Blocked dependency |
|---|---|---|---|---|---|
| `SH-FUNC-004A` | unit/integration | `SH-FUNC-004A derives normal range band extents from selected measure limits` | `ALT (U/L)` rows with `STNRLO=10`, `STNRHI=40` | normal-range model exists; lower bound is `10`; upper bound is `40`; band is behind bars in render order metadata if exposed | normal-range derivation/render-state API |
| `SH-FUNC-004B` | unit/integration | `SH-FUNC-004B initializes normal range hidden until control is enabled` | `ALT (U/L)` rows with limits | initial state has `displayNormalRange` false; control state false; band render state absent/hidden; toggling state makes band render state visible | settings normalization and control state API |
| `SH-FUNC-004C` | unit/integration | `SH-FUNC-004C suppresses normal range control when selected measure lacks limits` | `BILI (mg/dL)` rows with blank/missing limits | normal-range availability is false; control model excludes Normal Range or marks disabled/hidden; no band model is generated | measure availability helper |
| `SH-FUNC-005A` | unit/integration | `SH-FUNC-005A lower limit updates x domain minimum` | `ALT (U/L)` rows, deterministic domain | applying lower input `15` produces x-domain minimum `15`; maximum unchanged; bins/data are recalculated against new domain | domain update helper |
| `SH-FUNC-005B` | unit/integration | `SH-FUNC-005B upper limit updates x domain maximum` | same | applying upper input `50` produces x-domain maximum `50`; minimum unchanged; bins/data are recalculated against new domain | domain update helper |
| `SH-FUNC-005C` | unit/integration | `SH-FUNC-005C x-axis limit controls increment and decrement by one` | settings/control config only | lower and upper controls are numeric; `step` is `1`; step-up/down events or control config change values by exactly one | control config API or DOM integration |
| `SH-FUNC-005D` | integration | `SH-FUNC-005D typed valid x-axis limits apply on blur and redraw histogram state` | `ALT (U/L)` rows | typing value without blur does not commit if design requires blur; blur commits value; x-domain updates; chart redraw/version/bin state changes | lifecycle/redraw API |
| `SH-FUNC-010` | unit/integration | `SH-FUNC-010 selected bin maps to exact linked detail table rows and columns` | deterministic bins with known subject IDs | selecting bin `[10,20)` returns only expected subjects; listing columns include subject identifier, result, lower limit, upper limit; values match raw rows | selected-bin-to-listing helper |
| `SH-FUNC-011` | integration | `SH-FUNC-011 selected bin marks unselected bars de-emphasized` | deterministic bins | selected bar state remains emphasized; every other bar state has reduced opacity/class/flag; selected state resets correctly when another bin is selected | bar state model or jsdom render |
| `SH-FUNC-012` | unit/integration | `SH-FUNC-012 selected bin count text reports represented records` | deterministic bins | selecting a bin with two records produces count value `2` and display text matching product copy | count-text helper/product copy |

### Vitest skeleton

```js
import { describe, expect, test } from 'vitest';
import fixture from './fixtures/safetyHistogram.normalRange.json';
import {
  createSafetyHistogramState,
  applyXAxisLimit,
  getLinkedDetailsForBin,
  getNormalRangeState
} from '../src/safetyHistogram';

describe('safety-histogram reviewed requirements', () => {
  test('SH-FUNC-004A derives normal range band extents from selected measure limits', () => {
    const state = createSafetyHistogramState(fixture, settings);
    const band = getNormalRangeState(state, 'ALT (U/L)');

    expect(band).toMatchObject({ available: true, lower: 10, upper: 40 });
  });

  test('SH-FUNC-005A lower limit updates x domain minimum', () => {
    const state = createSafetyHistogramState(fixture, settings);
    const next = applyXAxisLimit(state, { lower: 15 });

    expect(next.xDomain[0]).toBe(15);
    expect(next.xDomain[1]).toBe(state.xDomain[1]);
    expect(next.renderVersion).toBeGreaterThan(state.renderVersion);
  });

  test('SH-FUNC-010 selected bin maps to exact linked detail table rows and columns', () => {
    const state = createSafetyHistogramState(fixture, settings);
    const details = getLinkedDetailsForBin(state, { lower: 10, upper: 20 });

    expect(details.columns.map(column => column.label)).toEqual([
      'Subject Identifier',
      'Result',
      'Lower Limit of Normal',
      'Upper Limit of Normal'
    ]);
    expect(details.rows.map(row => row.USUBJID)).toEqual(['ALT-002', 'ALT-003']);
  });
});
```

This is intentionally illustrative. The implementer should adapt imports and state helpers to the actual renderer API rather than adding test-only behavior.

## Proposed Playwright coverage

Use Playwright for visible browser behavior and interaction. Suggested file: `tests/browser/safety-histogram.requirements.spec.js`. Default viewport: Chromium `1440x900`.

Recommended stable selectors:

- Renderer root: `[data-testid="safety-histogram"]`
- Measure control: `[data-testid="measure-control"]`
- Normal Range checkbox: `[data-testid="normal-range-toggle"]`
- Normal-range band: `[data-testid="normal-range-band"]`
- Lower Limit input: `[data-testid="x-lower-limit"]`
- Upper Limit input: `[data-testid="x-upper-limit"]`
- X-axis: `[data-testid="x-axis"]`
- Histogram bars: `[data-testid="histogram-bar"]`
- Selected histogram bar: `[data-selected="true"]`
- De-emphasized bar state: `[data-muted="true"]` or opacity/class equivalent
- Selected-bin count text: `[data-testid="selected-bin-count"]`
- Linked detail table: `[data-testid="linked-detail-table"]`

| Requirement ID | Test layer | Proposed test name | Expected browser assertions | Blocked dependency |
|---|---|---|---|---|
| `SH-FUNC-004A` | browser/visual | `SH-FUNC-004A renders normal range band when enabled` | after checking Normal Range, band is visible; bounding box x-position spans values `10` to `40`; band appears before/behind bars by DOM order/z-index; screenshot stable enough for visual artifact | renderer demo and selectors |
| `SH-FUNC-004B` | browser | `SH-FUNC-004B normal range is hidden by default and shown by checkbox` | on load checkbox exists and is unchecked; no visible band; click checkbox; band becomes visible; click again hides band | renderer demo and selectors |
| `SH-FUNC-004C` | browser | `SH-FUNC-004C hides normal range control for measure without limits` | switch measure to no-limit fixture; Normal Range checkbox is absent or disabled and hidden per product decision; no band visible | measure control and no-limit fixture |
| `SH-FUNC-005A` | browser | `SH-FUNC-005A lower limit input updates histogram x-axis minimum` | fill lower input `15`, blur; x-axis minimum/tick/domain reflects `15`; bars redraw; console has no unexpected errors | axis selectors/copy decision |
| `SH-FUNC-005B` | browser | `SH-FUNC-005B upper limit input updates histogram x-axis maximum` | fill upper input `50`, blur; x-axis maximum/tick/domain reflects `50`; bars redraw; console has no unexpected errors | axis selectors/copy decision |
| `SH-FUNC-005C` | browser | `SH-FUNC-005C limit inputs support stepper increments of one` | numeric inputs have `step="1"`; `ArrowUp` or `input.evaluate(el => el.stepUp())` changes value by `1`; `stepDown()` changes by `1` | numeric input implementation |
| `SH-FUNC-005D` | browser | `SH-FUNC-005D typed limit changes apply on blur and redraw` | typed value remains pending until blur if applicable; after blur x-domain updates and bar geometry/count changes; valid input is not reverted | blur handler/redraw lifecycle |
| `SH-FUNC-010` | browser | `SH-FUNC-010 bar click populates linked detail table with represented raw records` | click known bin; detail table appears; header/columns include subject ID, result, lower normal, upper normal; rows equal expected subject IDs for clicked bin | deterministic bins and table selectors |
| `SH-FUNC-011` | browser | `SH-FUNC-011 selected bar visually de-emphasizes non-selected bars` | after click, one selected bar remains full emphasis; all non-selected bars have muted opacity/class; selected table rows correspond to selected bar only | visual state selectors |
| `SH-FUNC-012` | browser | `SH-FUNC-012 selected bar displays represented record count under chart` | after clicking known bin with expected `2` rows, count text below chart includes `2` and matches product copy | count text selector/copy decision |

### Playwright skeleton

```js
import { expect, test } from '@playwright/test';

const demoUrl = '/safety-histogram/fixtures/normal-range.html';

test.describe('safety-histogram reviewed requirements', () => {
  test.beforeEach(async ({ page }) => {
    const consoleErrors = [];
    page.on('console', message => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.consoleErrors = consoleErrors;
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${demoUrl}?cacheBust=${Date.now()}`);
    await expect(page.getByTestId('safety-histogram')).toBeVisible();
  });

  test('SH-FUNC-004B normal range is hidden by default and shown by checkbox', async ({ page }) => {
    const toggle = page.getByTestId('normal-range-toggle');
    await expect(toggle).toBeVisible();
    await expect(toggle).not.toBeChecked();
    await expect(page.getByTestId('normal-range-band')).toBeHidden();

    await toggle.check();
    await expect(page.getByTestId('normal-range-band')).toBeVisible();
  });

  test('SH-FUNC-005D typed valid x-axis limits apply on blur and redraw', async ({ page }) => {
    const lower = page.getByTestId('x-lower-limit');
    const firstBar = page.getByTestId('histogram-bar').first();
    const before = await firstBar.boundingBox();

    await lower.fill('15');
    await lower.blur();

    await expect(page.getByTestId('x-axis')).toContainText('15');
    await expect.poll(async () => await firstBar.boundingBox()).not.toEqual(before);
  });

  test('SH-FUNC-010 bar click populates linked detail table with represented raw records', async ({ page }) => {
    await page.getByTestId('histogram-bar').filter({ hasText: '10–20' }).click();

    const table = page.getByTestId('linked-detail-table');
    await expect(table).toBeVisible();
    await expect(table).toContainText('Subject Identifier');
    await expect(table).toContainText('Result');
    await expect(table).toContainText('Lower Limit of Normal');
    await expect(table).toContainText('Upper Limit of Normal');
    await expect(table).toContainText('ALT-002');
    await expect(table).toContainText('ALT-003');
  });
});
```

The skeleton assumes accessible labels or `data-testid` attributes. If the implementation uses semantic roles instead, prefer `getByRole()` selectors while preserving requirement IDs in test names.

## Requirement-by-requirement handoff notes

### `SH-FUNC-004A` — Normal-range band rendering

- Implementation should compute the selected measure's lower/upper normal limits from mapped columns, not hard-code fixture values.
- If multiple rows for a measure repeat the same limits, assert the deduplicated limits are used.
- If rows have conflicting limits, this reviewed requirement does not say how to resolve them; flag that separately before test finalization.
- Browser test should assert both visibility and approximate placement on the x-scale.

### `SH-FUNC-004B` — Hidden by default, shown via control

- Initial state must be hidden even when the selected measure has complete normal-range data.
- Checkbox state and visible band state should remain synchronized after repeated toggles.
- If settings allow initial display, keep this test on default settings where initial display is false.

### `SH-FUNC-004C` — Hide/unavailable control without limits

- Product wording allows either unavailable or hidden. The test should encode the implementation decision: either absent from DOM, hidden from users, or disabled with a clear state.
- The safest user-facing assertion is: the user cannot activate normal-range display for a measure with no limits, and no band is shown.

### `SH-FUNC-005A` / `SH-FUNC-005B` — X-axis lower/upper input domain updates

- Use deterministic tick/domain exposure to avoid brittle SVG pixel-only assertions.
- Also assert a redraw signal: changed bar count/geometry, updated chart state, or updated axis tick labels.
- Do not combine lower and upper changes in the same primary test; these are separate reviewed requirements.

### `SH-FUNC-005C` — Stepper behavior by 1

- Native browser steppers are not always visible to automation, so assert `input[type="number"]` plus `step="1"`, then call `stepUp()`/`stepDown()` or use keyboard `ArrowUp`/`ArrowDown`.
- If the implementation uses custom steppers instead of native number inputs, add stable selectors for increment/decrement buttons and assert exactly one-unit changes.

### `SH-FUNC-005D` — Typed changes apply on blur

- This row specifically names blur; tests should use `fill()` followed by `blur()` or focus transfer.
- Invalid limit behavior is out of this row's scope; keep this test to valid values.
- Redraw assertion should avoid screenshot-only evidence; prefer explicit domain and rendered bar state checks.

### `SH-FUNC-010` — Linked detail table raw records

- The fixture must make the clicked bin's membership unambiguous.
- Test the exact column set named in the requirement: subject identifier, result, lower limit of normal, upper limit of normal.
- Assert raw values, not formatted chart labels only.

### `SH-FUNC-011` — De-emphasize non-selected bars

- Implementation should expose a deterministic selected/muted state for testing, for example `data-selected` and `data-muted`.
- Visual assertions may inspect opacity/class but should not rely only on screenshots.
- Include at least one selected bar and two non-selected bars in the fixture.

### `SH-FUNC-012` — Display selected-bin record count below chart

- Product copy is not fully specified. Recommended handoff: expose/count text such as `2 records selected` under the chart.
- Test should assert the numeric count and location/selector; exact surrounding copy can be finalized once UI text exists.

## Proposed execution commands once implementation exists

```bash
npm install
npm run lint
npm run test -- --run test/safety-histogram.requirements.test.js
npm run test:browser -- tests/browser/safety-histogram.requirements.spec.js --project=chromium
npm run build
```

If script names differ, the PR should document the equivalent commands and why any layer is missing.

## Open blockers before executable tests can be added

1. Renderer package location and public API are not present in this repository.
2. Demo URL or fixture route is not present.
3. Stable selectors and/or accessible roles are not defined.
4. Deterministic binning configuration is needed for exact linked-table expectations.
5. Product copy is needed for selected-bin count text under the chart.
6. Normal-range behavior for conflicting per-row normal limits is not specified; this does not block the reviewed happy-path fixture but should be resolved before broad coverage.

## Coverage summary

| Requirement ID | Proposed evidence | Execution status |
|---|---|---|
| `SH-FUNC-004A` | Vitest state + Playwright browser/visual assertion | Proposed; blocked by missing renderer |
| `SH-FUNC-004B` | Vitest state + Playwright toggle workflow | Proposed; blocked by missing renderer |
| `SH-FUNC-004C` | Vitest availability + Playwright measure switch | Proposed; blocked by missing renderer |
| `SH-FUNC-005A` | Vitest domain helper + Playwright lower-limit blur | Proposed; blocked by missing renderer |
| `SH-FUNC-005B` | Vitest domain helper + Playwright upper-limit blur | Proposed; blocked by missing renderer |
| `SH-FUNC-005C` | Vitest/control config + Playwright stepper interaction | Proposed; blocked by missing renderer |
| `SH-FUNC-005D` | Integration redraw + Playwright blur workflow | Proposed; blocked by missing renderer |
| `SH-FUNC-010` | Vitest bin-to-details + Playwright linked table | Proposed; blocked by missing renderer |
| `SH-FUNC-011` | Integration bar state + Playwright muted bars | Proposed; blocked by missing renderer |
| `SH-FUNC-012` | Vitest count helper + Playwright selected count text | Proposed; blocked by missing renderer |
