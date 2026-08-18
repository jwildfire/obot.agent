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
// so nothing was published), 1 bad arguments.
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

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const WS = process.env.OBOT_WORKSPACE || join(homedir(), 'Documents', 'obot2')
const HUB = process.env.OBOT_HUB || join(WS, 'obot.roadmap')

// With no watermark, look back one day rather than to the beginning of time: a
// first run should describe the morning he is waking to, not the whole history
// of the project.
const DEFAULT_LOOKBACK_MS = 24 * 60 * 60 * 1000

function parseArgs(argv) {
  const o = { dryRun: false, json: false, force: false, since: null }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--dry-run') o.dryRun = true
    else if (a === '--json') o.json = true
    else if (a === '--force') o.force = true
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

  const state = readState(workspace)
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
    // The watermark advances only on a decided run. An unknown leaves it where it
    // was, so the window the next fold covers still includes whatever this one
    // could not see.
    if (verdict.verdict !== 'unknown') {
      writeState(workspace, {
        lastFoldAt: now.toISOString(),
        queueHash: verdict.briefing ? verdict.hash : state.queueHash,
        sessionLog: sizes,
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
`

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { exit, error, help, report } = await run(process.argv.slice(2))
  // The verdict is the FIRST line, because callers summarise by first line and a
  // check whose headline is swallowed reports nothing while looking healthy
  // (obot.agent#129).
  if (error) { console.error(`fold: ${error}\n\n${USAGE}`); process.exit(1) }
  if (help) { console.log(USAGE); process.exit(0) }
  console.log(process.argv.includes('--json') ? JSON.stringify(report, null, 2) : render(report))
  process.exit(exit)
}
