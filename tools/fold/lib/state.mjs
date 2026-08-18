// The fold's own durable state (jwildfire/obot.roadmap#238, task obot.agent#200).
//
// Everything the fold owns lives under {workspace}/.claude/fold/. The Navigator's
// sweep declares itself the sole writer of .claude/session-hub/ in its own state
// file's header, and its ledger audits report a second writer as a fault. The one
// shared file the fold touches is the timing ledger, which the bookends already
// share by design.
//
// The state exists because the clock cannot be trusted to say what window this
// run covers. launchd does not defer a StartCalendarInterval fire missed while
// the machine slept — it runs once on wake, at whatever hour that is, and D0019
// measured that missed runs are lost rather than replayed. This host does sleep:
// `pmset -g custom` reads `sleep 0` on both power sources and the power log still
// records real sleeps, and the sweep's log carries eight observation gaps over
// fifteen minutes in three days. So the fold folds the window its watermark
// defines and never the window its wall clock implies.
import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs'
import { join, dirname } from 'node:path'

export const STATE_REL = '.claude/fold/state.json'
export const RUNS_REL = '.claude/fold/runs.jsonl'

const FIRST_RUN = { lastFoldAt: null, queueHash: null, sessionLog: {}, corrupt: false }

export function readState(workspace) {
  let raw
  try {
    raw = readFileSync(join(workspace, STATE_REL), 'utf8')
  } catch {
    return { ...FIRST_RUN }
  }
  try {
    const s = JSON.parse(raw)
    return {
      lastFoldAt: s.lastFoldAt ?? null,
      queueHash: s.queueHash ?? null,
      sessionLog: s.sessionLog ?? {},
      corrupt: false,
    }
  } catch {
    // A corrupt state file reads as first-run so one bad write cannot stop the
    // record accruing — but it SAYS so, because "we started over" and "we have
    // never run" are different facts and only one of them is good news.
    return { ...FIRST_RUN, corrupt: true }
  }
}

export function writeState(workspace, next) {
  const p = join(workspace, STATE_REL)
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, JSON.stringify({
    lastFoldAt: next.lastFoldAt ?? null,
    queueHash: next.queueHash ?? null,
    sessionLog: next.sessionLog ?? {},
  }, null, 2) + '\n')
}

/**
 * One line per run, including quiet ones — local, never committed.
 *
 * A quiet night and a dead fold produce identical output, which is nothing. This
 * file is the only thing that tells them apart from the inside, so it is written
 * even when the verdict is that there was nothing to write.
 */
export function recordRun(workspace, run) {
  const p = join(workspace, RUNS_REL)
  mkdirSync(dirname(p), { recursive: true })
  appendFileSync(p, JSON.stringify(run) + '\n')
}
