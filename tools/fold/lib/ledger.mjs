// The timing ledger's third bookend (jwildfire/obot.roadmap#238, task obot.agent#200).
//
// The schema is docs/session-framework.md: one JSON line per step at
// {workspace}/.claude/session-hub/cache/init-timings.jsonl, created on first
// write, appended, never committed. The documented enum was `init|wrapup`; this
// change adds `fold` and moves that sentence in the same commit, because a doc
// that says init|wrapup makes every fold row a schema violation to the next
// reader.
//
// Two warnings this file inherits rather than repeats. The ledger has had a
// writer emit the wrong shape before — the 2026-08-04 session reports record a
// writer that omitted `ms` entirely, "so the #91 SLA cannot be scored numerically
// from the ledger it exists to prove" — so the shape is built here, once, rather
// than hand-rolled per caller. And nothing reads this file today: a `fold` row is
// telemetry until something scores it, which is honest to say and dishonest to
// leave unsaid.
import { appendFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'

export const LEDGER_REL = '.claude/session-hub/cache/init-timings.jsonl'

export function stampBookend(workspace, { step, ms, session, ts }) {
  const p = join(workspace, LEDGER_REL)
  mkdirSync(dirname(p), { recursive: true })
  appendFileSync(p, JSON.stringify({
    ts: ts ?? new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
    bookend: 'fold',
    step,
    tier: 0,
    ms: Math.round(ms ?? 0),
    session: session ?? 'fold',
  }) + '\n')
}
