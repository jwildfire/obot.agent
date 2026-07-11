---
name: chartjs-migration
description: "Use when replacing Webcharts rendering with Chart.js or deciding whether Chart.js fits a display. Covers fit-assessment questions, an incremental migration pattern behind a thin adapter, and the gsm.viz validate-configure-structure-render flow."
---

# Chart.js Migration Skill

Use when replacing Webcharts rendering with Chart.js or deciding whether Chart.js fits a display.

## Assessment questions

- Is the display a standard chart type that Chart.js supports well?
- Are required interactions available through Chart.js events/plugins?
- Are overlays easier as Chart.js plugins or custom SVG/HTML layers?
- Can small multiples be represented as multiple Chart.js instances?
- Does the accessibility model remain acceptable?

## Migration pattern

1. Define chart-state inputs independent of Chart.js.
2. Create a minimal Chart.js adapter for one display state.
3. Add tests for data-to-chart transformation.
4. Add browser tests for interactions.
5. Add visual baselines for default and edge states.
6. Keep the adapter thin so another renderer could replace Chart.js if needed.

## gsm.viz pattern

For migrated renderer modules, prefer the gsm.viz flow: validate inputs with schemas, configure defaults, create/replace a canvas, structure data into Chart.js datasets, build plugins/scales separately, instantiate Chart.js, and attach explicit update helpers. Keep clinical requirements outside opaque Chart.js config where possible.
