---
name: renderer-modernization
description: "Use when planning or implementing migration work in a legacy SafetyGraphics renderer. Sequences the work — requirements matrix first, baseline tests, extracting pure logic from Webcharts callbacks, compatibility wrapper, incremental replacement — and lists the hard don'ts."
---

# Renderer Modernization Skill

Use when planning or implementing migration work in a legacy SafetyGraphics renderer.

## Sequence

1. Build a requirements matrix first.
2. Establish baseline build/test behavior.
3. Remove unsafe or nondeterministic build steps.
4. Extract pure data and settings logic from Webcharts callbacks.
5. Add tests around extracted logic.
6. Introduce a modern renderer API and compatibility wrapper.
7. Replace Webcharts rendering incrementally.
8. Update examples, docs, and traceability.

## Do not

- Rewrite the renderer before baseline tests exist.
- Remove legacy behavior without a documented requirement decision.
- Claim validation without a formal validation package.
