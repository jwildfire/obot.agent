#!/usr/bin/env node
// obot fold — the morning fold's gate (jwildfire/obot.roadmap#238, task obot.agent#200).
//
//   node obot.agent/tools/fold/fold.mjs --dry-run     decide and explain; touch nothing
//   node obot.agent/tools/fold/fold.mjs --json        the verdict as data
//   node obot.agent/tools/fold/fold.mjs --since ISO   fold a stated window
//   node obot.agent/tools/fold/fold.mjs --force       fold regardless of the gate
//   node obot.agent/tools/fold/fold.mjs               fold
//
// THIS INCREMENT DECIDES AND RECORDS. It writes no diary entry, renders no page
// and sends no push — those are obot.agent#202, obot.roadmap#247 and
// obot.agent#205, and each acts on the verdict this produces.
//
// Why it is a script and not a session: the open readiness question (D0019,
// answer "not yet") and scripts/policy.json's A2 both concern whether a
// scheduled job may start an AGENT unattended. Neither concerns a scheduled
// script, and this machine already runs one with @jwildfire's acceptance —
// com.obot.navigator-sweep, a node script under launchd every 300 seconds. The
// fold is that class of thing. The single part of the requirement that needs a
// model is the diary entry's narrative paragraph, and it is deliberately the only
// piece held behind A2.
//
// Exit codes: 0 decided (fold or quiet), 3 unknown (a source could not answer,
// so nothing was published), 4 halted (.claude/autonomy-halt present), 1 bad arguments.
import { homedir } from 'node:os'
import { join } from 'node:path'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { decide, queueHash } from './lib/decide.mjs'
import { readState, writeState, recordRun } from './lib/state.mjs'
import { sweptEvents, openBlockerCount, sessionLogSizes, scratchpadTodos, grownSince } from './lib/collect.mjs'
import { policyRepos, commitsSince } from './lib/repos.mjs'
import { openDecisions } from './lib/decisions.mjs'
import { stampBookend } from './lib/ledger.mjs'
import { writeDayBoundary } from './lib/marker.mjs'
import { existsSync, readFileSync } from 'node:fs'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const WS = process.env.OBOT_WORKSPACE || join(homedir(), 'Documents', 'obot2')
const HUB = process.env.OBOT_HUB || join(WS, 'obot.roadmap')

// With no watermark, look back one day rather than to the beginning of time: a
// first run should describe the morning he is waking to, not the whole history
// of the project.
const DEFAULT_LOOKBACK_MS = 24 * 60 * 60 * 1000

// 26 rather than 24: launchd fires a missed calendar job once on wake, at an
// arbitrary hour, so a couple of hours of drift is normal and is not a stopped
// clock. Past this it is worth saying out loud.
const OVERDUE_HOURS = 26

// The marker's date and time come from the run's own clock at the moment it
// runs, formatted here once. Never from a model, and never from a string parsed
// out of the scratchpad (obot.agent#57).
const two = (n) => String(n).padStart(2, '0')
const localDate = (d) => `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`
const localTime = (d) => `${two(d.getHours())}:${two(d.getMinutes())}`

function parseArgs(argv) {
  const o = { dryRun: false, json: false, force: false, since: null }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--dry-run') o.dryRun = true
    else if (a === '--json') o.json = true
    else if (a === '--force') o.force = true
    else if (a === '--status') o.status = true
    else if (a === '--since') o.since = argv[++i]
    else if (a === '--help' || a === '-h') o.help = true
    else return { error: `unknown argument: ${a}` }
  }
  if (o.since && Number.isNaN(Date.parse(o.since))) return { error: `--since is not a date: ${o.since}` }
  return o
}

export async function run(argv = [], { workspace = WS, hub = HUB, now = new Date() } = {}) {
  const started = Date.now()
  const opts = parseArgs(argv)
  if (opts.error) return { exit: 1, error: opts.error }
  if (opts.help) return { exit: 0, help: true }

  // The kill switch, re-read at run time. obot-auto reads it once in its
  // pre-flight and no registered hook references it, so a lane that does not
  // route through obot-auto is not covered unless it looks for itself
  // (obot.agent#204). This one looks, on every run, before touching anything.
  const halt = join(workspace, '.claude', 'autonomy-halt')
  if (existsSync(halt)) {
    let why = ''
    try { why = readFileSync(halt, 'utf8').trim().split('\n')[0] } catch { /* the file is enough */ }
    return { exit: 4, halted: true, report: { at: now.toISOString(), verdict: 'halted', why, dryRun: opts.dryRun } }
  }

  const state = readState(workspace)

  // --status answers the one question a clock cannot answer about itself: did it
  // fire? A fold that stopped and a night with nothing in it produce the same
  // output, which is none, so something has to be able to ask. Local only — the
  // off-machine version of this is D0019's H2 and still unanswered.
  if (opts.status) {
    const last = state.lastFoldAt ? Date.parse(state.lastFoldAt) : null
    const ageH = last ? (now.getTime() - last) / 3600000 : null
    const overdue = ageH === null || ageH > OVERDUE_HOURS
    return {
      exit: overdue ? 5 : 0,
      status: true,
      report: {
        at: now.toISOString(),
        lastFoldAt: state.lastFoldAt,
        ageHours: ageH === null ? null : Math.round(ageH * 10) / 10,
        overdue,
        why: last
          ? `last fold ${Math.round(ageH)}h ago${overdue ? ` — over the ${OVERDUE_HOURS}h bar, so the clock may have stopped` : ''}`
          : 'no fold has ever run on this machine',
      },
    }
  }

  const since = opts.since ?? state.lastFoldAt ?? new Date(now.getTime() - DEFAULT_LOOKBACK_MS).toISOString()

  // --- activity, since the last fold ---------------------------------------
  const repos = policyRepos(REPO_ROOT)
  const git = commitsSince(workspace, repos, since)
  const swept = sweptEvents(workspace, since, { now })
  const sizes = sessionLogSizes(workspace)
  const grown = grownSince(sizes, state.sessionLog)

  const activity = {
    commits: git.commits,
    events: swept.events,
    scratchpad: grown,
    // Only the git scan makes activity unknown. A stale or missing sweep costs us
    // the queue, which is handled below; it does not on its own mean the night
    // was unobserved, because commits and the scratchpad were still readable.
    unknown: git.unknown,
    why: [...git.failed, swept.unknown ? swept.why : null].filter(Boolean),
  }

  // --- the queue, as it stands now -----------------------------------------
  const decisions = await openDecisions(hub)
  const blockers = openBlockerCount(workspace)
  const todos = scratchpadTodos(workspace)
  const rcs = Object.entries(swept.snapshot ?? {}).map(([key, v]) => ({ key, title: v.title, url: v.url }))

  const queueUnknown = swept.unknown || decisions.unknown || blockers.unknown
  const queue = { rcs, decisions: decisions.items, todos: todos.items, blockers: blockers.count ?? 0 }

  const verdict = decide({ activity, queue, queueUnknown, lastHash: state.queueHash })
  if (opts.force && verdict.verdict !== 'unknown') {
    verdict.diary = verdict.briefing = true
    verdict.verdict = 'fold'
    verdict.reasons.forced = '--force: the gate was overridden for a rehearsal'
  }

  const report = {
    at: now.toISOString(),
    window: { since, until: now.toISOString() },
    verdict: verdict.verdict,
    diary: verdict.diary,
    briefing: verdict.briefing,
    push: verdict.push,
    counts: {
      rcs: rcs.length,
      decisions: decisions.items.length,
      todos: todos.items.length,
      blockers: blockers.count,
      commits: git.commits.length,
      events: swept.events.length,
    },
    reasons: verdict.reasons,
    unknowns: [
      ...git.failed.map((f) => `git: ${f}`),
      swept.unknown ? `sweep: ${swept.why}` : null,
      decisions.unknown ? `decisions: ${decisions.why}` : null,
      blockers.unknown ? `blockers: ${blockers.why}` : null,
      state.corrupt ? 'state: the fold state file was unreadable and was treated as first-run' : null,
    ].filter(Boolean),
    dryRun: opts.dryRun,
  }

  if (!opts.dryRun) {
    recordRun(workspace, report)
    stampBookend(workspace, { step: `gate-${verdict.verdict}`, ms: Date.now() - started })
    // The day boundary the dashboard reads (obot.agent#201). Written on every
    // DECIDED run, quiet nights included: the boundary is about where one day's
    // record ends, which is true whether or not the night had anything in it.
    // Not written on an unknown run — a fold that could not see the night has no
    // business declaring where it ended.
    if (verdict.verdict !== 'unknown') {
      try {
        report.boundary = writeDayBoundary(workspace, {
          date: localDate(now), time: localTime(now), ifAbsent: true,
        })
      } catch (e) {
        report.unknowns.push(`boundary: could not write the day marker — ${e.message}`)
      }
    }
    // The watermark advances only on a decided run. An unknown leaves it where it
    // was, so the window the next fold covers still includes whatever this one
    // could not see.
    if (verdict.verdict !== 'unknown') {
      // Sizes are RE-MEASURED after the boundary write, not reused from before
      // it. The stored value is the baseline the next run compares against, and
      // it has to describe the file as this fold left it — otherwise the fold's
      // own writing reads as activity five minutes later.
      writeState(workspace, {
        lastFoldAt: now.toISOString(),
        queueHash: verdict.briefing ? verdict.hash : state.queueHash,
        sessionLog: sessionLogSizes(workspace),
      })
    }
  }

  return { exit: verdict.verdict === 'unknown' ? 3 : 0, report }
}

function render(r) {
  const L = []
  L.push(`fold: ${r.verdict.toUpperCase()}${r.dryRun ? '  (dry run — nothing written)' : ''}`)
  L.push(`window: ${r.window.since} -> ${r.window.until}`)
  L.push('')
  L.push(`  diary    ${r.diary ? 'YES' : 'no '}  ${r.reasons.activity}`)
  L.push(`  briefing ${r.briefing ? 'YES' : 'no '}  ${r.reasons.change}`)
  L.push(`  push     ${r.push ? 'YES' : 'no '}  ${r.reasons.push}`)
  if (r.reasons.forced) L.push(`  forced        ${r.reasons.forced}`)
  if (r.boundary) L.push(`  boundary ${r.boundary.kept ? "kept" : "SET "}  day marker at ${r.boundary.time}`)
  L.push('')
  L.push(`queue: ${r.counts.rcs} RC · ${r.counts.decisions} decisions · ${r.counts.todos} todos · ` +
         `${r.counts.blockers ?? '?'} config items`)
  if (r.unknowns.length) {
    L.push('')
    L.push('UNKNOWN — a source could not answer. Nothing here is being called quiet:')
    for (const u of r.unknowns) L.push(`  - ${u}`)
  }
  return L.join('\n')
}

const USAGE = `obot fold — decide whether there is anything to say this morning.

  --dry-run    decide and explain; write nothing
  --json       the verdict as data
  --since ISO  fold a stated window instead of the watermark's
  --force      fold regardless of the gate, for a rehearsal
  --status     when did the fold last run, and is the clock still ticking
`

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { exit, error, help, report } = await run(process.argv.slice(2))
  // The verdict is the FIRST line, because callers summarise by first line and a
  // check whose headline is swallowed reports nothing while looking healthy
  // (obot.agent#129).
  if (error) { console.error(`fold: ${error}\n\n${USAGE}`); process.exit(1) }
  if (help) { console.log(USAGE); process.exit(0) }
  if (report?.overdue !== undefined) {
    const line = `fold: ${report.overdue ? 'OVERDUE' : 'ok'} — ${report.why}`
    console.log(line)
    if (report.overdue) console.error(line)
    process.exit(exit)
  }
  if (exit === 4) {
    const line = `fold: HALTED — .claude/autonomy-halt is present${report.why ? `: ${report.why}` : ''}`
    console.log(line)
    console.error(line)
    process.exit(4)
  }
  console.log(process.argv.includes('--json') ? JSON.stringify(report, null, 2) : render(report))
  // An unattended run has no reader. launchd keeps stderr (StandardErrorPath) and
  // keeps nothing else, so the one outcome that must survive a morning nobody
  // watched goes there too: a fold that could not see is otherwise indistinguishable
  // from a night with nothing in it, and both produce no output at all.
  if (exit === 3) {
    console.error(`fold: UNKNOWN at ${report.at} — published nothing, watermark held at ${report.window.since}`)
    for (const u of report.unknowns) console.error(`fold:   ${u}`)
  }
  process.exit(exit)
}
