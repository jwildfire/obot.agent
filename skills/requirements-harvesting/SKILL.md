---
name: requirements-harvesting
description: "Use when extracting functional requirements from legacy renderer documentation — wiki specs, settings schemas, READMEs, test fixtures — into atomic requirements with stable IDs, grouped by area, feeding docs/requirements/ matrices and traceability."
---

# Requirements Harvesting Skill

Use when extracting functional requirements from legacy renderer documentation.

## Steps

1. Read upstream wiki functional specs, data guidelines, configuration docs, `settings-schema.json`, README, and test fixtures.
2. Convert each behavior into an atomic requirement with a stable ID.
3. Record source URL/path, requirement text, evidence type, automation status, and notes.
4. Group requirements into data, controls, chart, listing, statistics, warnings, accessibility, and performance.
5. Flag ambiguous requirements for Jeremy instead of inventing behavior.

## Output

Create or update `docs/requirements/<renderer>-requirements.md` and a traceability matrix.
