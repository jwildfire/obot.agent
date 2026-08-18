// The acceptance the requirement actually asks for (jwildfire/obot.roadmap#238,
// task obot.agent#200): a quiet night is PROVABLY quiet.
//
// Not "the gate returned quiet" — that is the tool grading its own homework, and
// this programme has nine instances in one night of an operation reporting
// success while having no effect. The assertion here is on the filesystem: after
// a quiet run, nothing anywhere has changed except the one line in the fold's own
// run log that distinguishes a quiet night from a dead scheduler.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, statSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { run } from '../fold.mjs'
import { queueHash } from '../lib/decide.mjs'

const put = (w, rel, body) => {
  mkdirSync(join(w, rel, '..'), { recursive: true })
  writeFileSync(join(w, rel), body)
}

// A workspace with a live sweep snapshot, a blockers file and a scratchpad, all
// readable — so nothing is "unknown" and the verdict is a real quiet, not an
// absence of information.
function quietWorkspace({ swept = '2026-08-18T10:55:00.000Z' } = {}) {
  const w = mkdtempSync(join(tmpdir(), 'foldcli-'))
  put(w, '.claude/session-hub/cache/navigator-rc.json', JSON.stringify({
    sweptIso: swept, snapshot: {}, events: [],
  }))
  put(w, '.claude/blockers.md', '# blockers\n\n## Open\n\n')
  put(w, '.claude/session-notes/2026-08-18.md', '# s\n\n## Todo\n\n## Session log\n')
  put(w, '.claude/fold/state.json', JSON.stringify({
    lastFoldAt: '2026-08-18T10:00:00.000Z',
    // The real hash of an empty queue. A made-up value would make every run
    // look like a change and quietly turn this into a fold test.
    queueHash: queueHash({ rcs: [], decisions: [], todos: [], blockers: 0 }),
    sessionLog: { '2026-08-18.md': 0 },
  }))
  return w
}

const snapshotTree = (root) => {
  const out = new Map()
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else out.set(relative(root, p), statSync(p).size + ':' + statSync(p).mtimeMs)
    }
  }
  walk(root)
  return out
}

const HUB = '/nonexistent-hub-so-decisions-are-unknown'

test('a quiet night writes nothing but its own one-line proof of life', async () => {
  const w = quietWorkspace()
  // A decision collector that answers, so the queue is known and genuinely empty.
  const before = snapshotTree(w)
  const { exit, report } = await run([], {
    workspace: w, hub: HUB, now: new Date('2026-08-18T11:00:00.000Z'),
  })
  // The hub clone is absent here, so decisions are unknown and the honest verdict
  // is unknown rather than quiet. That is itself the contract: see the next test.
  assert.equal(report.verdict, 'unknown')
  assert.equal(exit, 3, 'exit 3 = a source could not answer, distinct from 0 = decided')

  const after = snapshotTree(w)
  const changed = [...after.keys()].filter((k) => after.get(k) !== before.get(k))
  assert.deepEqual(changed.sort(), [
    '.claude/fold/runs.jsonl',
    '.claude/session-hub/cache/init-timings.jsonl',
  ], 'only the run log and the timing ledger move')
})

test('a genuinely quiet night: verdict quiet, exit 0, and still only those two files', async () => {
  const w = quietWorkspace()
  // Give it a hub whose collector answers with an empty open list.
  const hub = mkdtempSync(join(tmpdir(), 'foldhub-'))
  mkdirSync(join(hub, 'scripts/lib/collect'), { recursive: true })
  writeFileSync(join(hub, 'scripts/lib/collect/decision-log.mjs'),
    'export async function collectDecisionLog() { return { open: [] } }\n')

  const before = snapshotTree(w)
  const { exit, report } = await run([], {
    workspace: w, hub, now: new Date('2026-08-18T11:00:00.000Z'),
  })
  assert.equal(report.verdict, 'quiet')
  assert.equal(exit, 0)
  assert.equal(report.diary, false)
  assert.equal(report.briefing, false)
  assert.equal(report.push, false)

  const after = snapshotTree(w)
  const changed = [...after.keys()].filter((k) => after.get(k) !== before.get(k))
  assert.deepEqual(changed.sort(), [
    '.claude/fold/runs.jsonl',
    '.claude/fold/state.json',
    '.claude/session-hub/cache/init-timings.jsonl',
  ], 'no diary, no page, no push — the watermark advances and nothing else')

  const runs = readFileSync(join(w, '.claude/fold/runs.jsonl'), 'utf8').trim().split('\n')
  assert.equal(JSON.parse(runs.at(-1)).verdict, 'quiet',
    'a quiet night is recorded, because silence must be distinguishable from a dead scheduler')

  const ledger = readFileSync(join(w, '.claude/session-hub/cache/init-timings.jsonl'), 'utf8').trim()
  assert.equal(JSON.parse(ledger).bookend, 'fold')
})

test('a stale sweep is not a quiet night — the observer being dead is unknown', async () => {
  const w = quietWorkspace({ swept: '2026-08-18T09:00:00.000Z' })   // two hours before "now"
  const { exit, report } = await run([], {
    workspace: w, hub: HUB, now: new Date('2026-08-18T11:00:00.000Z'),
  })
  assert.equal(report.verdict, 'unknown')
  assert.equal(exit, 3)
  assert.ok(report.unknowns.some((u) => /stale/i.test(u)))
})

test('--dry-run touches nothing at all, including the run log', async () => {
  const w = quietWorkspace()
  const before = snapshotTree(w)
  const { report } = await run(['--dry-run'], {
    workspace: w, hub: HUB, now: new Date('2026-08-18T11:00:00.000Z'),
  })
  assert.equal(report.dryRun, true)
  const after = snapshotTree(w)
  assert.deepEqual([...after.keys()].filter((k) => after.get(k) !== before.get(k)), [])
})

test('a second run inside the same window is a no-op, because launchd fires late', async () => {
  const w = quietWorkspace()
  const hub = mkdtempSync(join(tmpdir(), 'foldhub2-'))
  mkdirSync(join(hub, 'scripts/lib/collect'), { recursive: true })
  writeFileSync(join(hub, 'scripts/lib/collect/decision-log.mjs'),
    'export async function collectDecisionLog() { return { open: [] } }\n')

  await run([], { workspace: w, hub, now: new Date('2026-08-18T11:00:00.000Z') })
  const mid = snapshotTree(w)
  const { report } = await run([], { workspace: w, hub, now: new Date('2026-08-18T11:05:00.000Z') })
  assert.equal(report.verdict, 'quiet', 'five minutes later is not new news')
  assert.equal(report.briefing, false)
  const after = snapshotTree(w)
  const changed = [...after.keys()].filter((k) => after.get(k) !== mid.get(k))
  assert.ok(!changed.includes('.claude/session-notes/2026-08-18.md'))
})

test('bad arguments fail loudly rather than folding something unintended', async () => {
  const w = quietWorkspace()
  const bad = await run(['--sinse', 'yesterday'], { workspace: w, hub: HUB })
  assert.equal(bad.exit, 1)
  assert.match(bad.error, /unknown argument/)
  const notADate = await run(['--since', 'yesterday'], { workspace: w, hub: HUB })
  assert.equal(notADate.exit, 1)
  assert.match(notADate.error, /not a date/)
  assert.ok(!existsSync(join(w, '.claude/fold/runs.jsonl')), 'and writes nothing on the way out')
})
