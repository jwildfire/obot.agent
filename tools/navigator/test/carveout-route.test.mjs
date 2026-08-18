// The router end to end (obot.agent#264, under jwildfire/obot.roadmap#220).
//
// Everything here runs the REAL `tools/blocker-log` against a temporary workspace,
// because the property this file exists to hold is not one a mock can hold: the
// second run must produce no second entry, and "no second entry" is a fact about the
// file, the id allocator and the append-only journal together.
//
// Raising c0016 again every five minutes would be worse than never raising it. The
// item would still say the right thing; the list would stop being readable, and a
// list he stops reading takes the true entries down with the false ones. That is the
// failure the three-bucket rule was written against, arriving from the inside.
//
// The wrapper is stubbed and only the wrapper: `obot-merge --check` reaches GitHub
// four ways and is @jwildfire's file besides — this work reads its OUTPUT and may not
// touch it. The stub prints output captured verbatim from a real run, so what the
// parser is proved against is what the real tool really prints.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROUTER = join(HERE, '..', '..', 'carveout-route')
const BLOCKER_LOG = join(HERE, '..', '..', 'blocker-log')

// Captured from the real run on 2026-08-18 and trimmed of its `closes:` line, so the
// blocker-log call this test makes reaches no network: `--blocks` is the one field
// that asks GitHub, and it is proved separately in carveout.test.mjs.
const attested = (title = 'Structural GitHub writes go out as obotclaw[bot]') =>
`PR #198 https://github.com/jwildfire/obot.agent/pull/198
  title: ${title}
  base:  main   state: OPEN   draft: False   files: 17
  head:  b1ae6d4200a708aeca86662797674135cddfc1ba
  policy: profile auto, role integration
  policy: carve-out path touched, attested lane forced (hooks/attribution-guard.sh, hooks/install.sh, scripts/obot-merge)
  PR milestone: v0.5.0
  policy:       PASS - merging is permitted on the approval tier (explicit Jeremy approval + --jeremy-approved required)
  mergeability: READY - GitHub will merge this now
obot-merge: CHECK PASSED - policy permits merging PR #198 in jwildfire/obot.agent
`

const STANDARD = `PR #263 https://github.com/jwildfire/obot.agent/pull/263
  title: An ordinary change
  base:  main   state: OPEN   draft: False   files: 4
  policy: profile auto, role integration
  policy:       PASS - policy and the milestone gate permit merging
  mergeability: READY - GitHub will merge this now
obot-merge: CHECK PASSED - policy permits merging PR #263 in jwildfire/obot.agent
`

/** A workspace with a stub wrapper in it, and nothing else. */
function bench(output) {
  const ws = mkdtempSync(join(tmpdir(), 'carveout-route-'))
  const stub = join(ws, 'obot-merge-stub')
  writeFileSync(stub, `#!/bin/sh\ncat <<'OUT'\n${output}OUT\n`)
  chmodSync(stub, 0o755)
  return { ws, stub }
}

const run = ({ ws, stub }, args) => spawnSync(process.execPath, [ROUTER, ...args], {
  encoding: 'utf8',
  env: { ...process.env, OBOT_WORKSPACE: ws, OBOT_CARVEOUT_MERGE: stub,
         OBOT_CARVEOUT_BLOCKER_LOG: BLOCKER_LOG, OBOT_ACTOR: 'carveout-route-test' },
})

const list = (ws) => { try { return readFileSync(join(ws, '.claude', 'blockers.md'), 'utf8') } catch { return '' } }
const entries = (ws) => [...list(ws).matchAll(/^-\s+\[ \]\s*(c\d{4})\b/gm)].map((m) => m[1])
const journalOps = (ws) => {
  try {
    return readFileSync(join(ws, '.claude', 'blockers.journal'), 'utf8')
      .split('\n').filter(Boolean).map((l) => JSON.parse(l).op)
  } catch { return [] }
}

// ---- the effect --------------------------------------------------------------

test('a real attested-lane check raises the config item, once', () => {
  const b = bench(attested())
  const first = run(b, ['--pr', '198', '-R', 'jwildfire/obot.agent'])
  assert.equal(first.status, 0, first.stderr)
  assert.deepEqual(entries(b.ws), ['c0001'])
  const md = list(b.ws)
  assert.match(md, /Merge obot\.agent#198/)
  assert.match(md, /Do: .*obot-merge 198 -R jwildfire\/obot\.agent/)
  assert.match(md, /grep -qx MERGED/)
  assert.match(md, /hooks\/attribution-guard\.sh/, 'it names the carve-out paths, which is why it is his')
  assert.match(first.stdout, /raised c0001/)
})

test('THE property — the same run repeated raises nothing and allocates no id', () => {
  const b = bench(attested())
  run(b, ['--pr', '198', '-R', 'jwildfire/obot.agent'])
  const second = run(b, ['--pr', '198', '-R', 'jwildfire/obot.agent'])
  assert.equal(second.status, 0, second.stderr)
  assert.deepEqual(entries(b.ws), ['c0001'], 'one entry, not two')
  // `seed` is the ledger adopting a list that predates its journal, written once on
  // the first capture. What must be exactly one is the ALLOCATION.
  assert.deepEqual(journalOps(b.ws).filter((o) => o === 'file'), ['file'], 'one allocation in the ledger, not two')
  assert.match(second.stderr, /already covered by c0001/)
  assert.match(second.stdout, /already routed: 1 pull request/)
})

test('and a reworded pull request title still does not duplicate it', () => {
  // Coverage is computed from the pull request REFERENCE, not the headline —
  // deliberately, because blocker-log's own dedup probes the first 60 characters of
  // the headline and a retitled pull request would sail straight past it.
  const b = bench(attested())
  run(b, ['--pr', '198', '-R', 'jwildfire/obot.agent'])
  writeFileSync(b.stub, `#!/bin/sh\ncat <<'OUT'\n${attested('A completely different title now')}OUT\n`)
  chmodSync(b.stub, 0o755)
  const second = run(b, ['--pr', '198', '-R', 'jwildfire/obot.agent'])
  assert.deepEqual(entries(b.ws), ['c0001'])
  assert.match(second.stderr, /already covered/)
})

test('an ordinary standard-lane pull request creates no config list at all', () => {
  const b = bench(STANDARD)
  const r = run(b, ['--pr', '263', '-R', 'jwildfire/obot.agent'])
  assert.equal(r.status, 0, r.stderr)
  assert.equal(existsSync(join(b.ws, '.claude', 'blockers.md')), false)
  assert.match(r.stdout, /nothing to route/)
})

test('--check decides and files nothing', () => {
  const b = bench(attested())
  const r = run(b, ['--check', '--pr', '198', '-R', 'jwildfire/obot.agent'])
  assert.equal(r.status, 0, r.stderr)
  assert.equal(existsSync(join(b.ws, '.claude', 'blockers.md')), false)
  assert.match(r.stdout, /DRY RUN, nothing was filed/)
})

test('a wrapper that prints something unreadable routes nothing and says the lane was unread', () => {
  const b = bench('obot-merge: some future wording nobody here anticipated\n')
  const r = run(b, ['--pr', '198', '-R', 'jwildfire/obot.agent'])
  assert.equal(existsSync(join(b.ws, '.claude', 'blockers.md')), false)
  assert.match(r.stdout, /unread: .*no readable verdict/)
})

test('an unreadable config list stops the whole pass rather than raising into the dark', () => {
  const b = bench(attested())
  // A directory where the list should be. Not ENOENT, so not absence.
  spawnSync('mkdir', ['-p', join(b.ws, '.claude', 'blockers.md')])
  const r = run(b, ['--pr', '198', '-R', 'jwildfire/obot.agent'])
  assert.match(r.stdout, /\*\*CONFIG ROUTING FAILED\*\*/)
  assert.match(r.stdout, /Nothing was raised and nothing was suppressed/)
})
