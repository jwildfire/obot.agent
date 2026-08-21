// What crosses to the public site, and what the hub is entitled to assume about it.
//
// jwildfire/obot.roadmap#266, task #301. The hub parses the same `<meta name="premise">`
// grammar this side does, because a build there cannot import from this clone. These
// tests pin the two things that seam depends on: the shape of the payload, and the
// fingerprint being a plain sha256 over the proof — so a change on either side that
// would silently stop the two agreeing fails here first.
import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const HERE = path.dirname(new URL(import.meta.url).pathname)
const TOOL = path.join(HERE, '..', '..', 'premise-status')

const PAGE = `<!doctype html><html><head><title>t</title>
<meta name="premise" scope="live" content="the issue is still open | gh issue view 1 -R jwildfire/obot.roadmap --json state --jq .state → prints OPEN">
<meta name="premise" scope="history" content="the release published | gh release view v1 -R jwildfire/gsm.safety --json isDraft --jq .isDraft → prints false">
<meta name="premise" scope="live" content="the board still shows it | manual — open the board and look">
<meta name="premise" scope="live" content="the backup ran | tmutil latestbackup → prints something">
</head><body><section id="decisions" data-state="open"></section></body></html>`

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'premise-cli-'))
  const hub = path.join(root, 'obot.roadmap')
  const dir = path.join(hub, 'reports', 'decisions', '2026-08-21-a-page')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'index.html'), PAGE)
  fs.writeFileSync(path.join(hub, 'reports', 'decisions', 'registry.json'), JSON.stringify({
    artifacts: [{ id: 'D0099', slug: '2026-08-21-a-page', date: '2026-08-21', title: 'A page', state: 'open' }],
  }))
  return { root, hub }
}

const run = (args, ws, hub) => spawnSync(TOOL, ['--workspace', ws, '--hub', hub, ...args], { encoding: 'utf8', timeout: 20000 })

test('the payload is ids, hex, dates and closed enums — and carries no prose at all', () => {
  const { root, hub } = fixture()
  const r = run(['--dry-run'], root, hub)
  assert.equal(r.status, 0, r.stderr)
  const doc = JSON.parse(r.stdout)

  assert.deepEqual(Object.keys(doc).sort(), ['_schema', 'asOf', 'readings'])
  assert.equal(doc._schema, 'obot.roadmap/premise-status@1')
  assert.match(doc.asOf, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)
  assert.equal(doc.readings.length, 4, 'every premise the page declares, whatever its scope')

  for (const row of doc.readings) {
    assert.deepEqual(Object.keys(row).sort(), ['at', 'id', 'sha', 'state', 'why'])
    assert.match(row.id, /^D\d{4}\.p\d{1,3}$/)
    assert.match(row.sha, /^[0-9a-f]{12}$/)
    assert.ok(['holds', 'fails', 'unknown'].includes(row.state))
    assert.ok(row.why === null || ['manual', 'refused', 'errored'].includes(row.why))
    assert.ok(row.at === null || /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(row.at))
  }
  // The sentences on the page must not appear anywhere in what crosses.
  const wire = JSON.stringify(doc)
  for (const said of ['the issue is still open', 'the release published', 'open the board and look', 'gh issue view']) {
    assert.ok(!wire.includes(said), `"${said}" must not cross the channel`)
  }
})

test('the fingerprint is sha256 over the proof, so the hub can compute the same one', () => {
  const { root, hub } = fixture()
  const doc = JSON.parse(run(['--dry-run'], root, hub).stdout)
  const fp = (proof) => crypto.createHash('sha256').update(proof, 'utf8').digest('hex').slice(0, 12)
  const by = Object.fromEntries(doc.readings.map((r) => [r.id, r.sha]))
  assert.equal(by['D0099.p1'], fp('gh issue view 1 -R jwildfire/obot.roadmap --json state --jq .state prints OPEN'))
  assert.equal(by['D0099.p2'], fp('gh release view v1 -R jwildfire/gsm.safety --json isDraft --jq .isDraft prints false'))
  assert.equal(by['D0099.p3'], fp('manual open the board and look'), 'a manual premise fingerprints its instruction')
})

test('a premise nothing can run is unknown with a reason, and never dated', () => {
  const { root, hub } = fixture()
  const doc = JSON.parse(run(['--dry-run'], root, hub).stdout)
  const by = Object.fromEntries(doc.readings.map((r) => [r.id, r]))
  assert.equal(by['D0099.p3'].state, 'unknown')
  assert.equal(by['D0099.p3'].why, 'manual', 'a manual premise says a person has to look')
  assert.equal(by['D0099.p3'].at, null, 'nothing was measured, so there is no time to state')
  assert.equal(by['D0099.p4'].why, 'refused', 'a proof off the read-only allowlist is refused, not failed')
  assert.notEqual(by['D0099.p4'].state, 'fails', 'unknown is never reported as expired')
})

test('a registry that cannot be read refuses to publish rather than publishing nothing', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'premise-cli-'))
  const hub = path.join(root, 'obot.roadmap')
  fs.mkdirSync(hub, { recursive: true })
  const r = run(['--dry-run'], root, hub)
  assert.equal(r.status, 1)
  assert.match(r.stderr, /refusing to write/)
  assert.match(r.stderr, /not an absence of premises/)
})

test('--dry-run writes nothing', () => {
  const { root, hub } = fixture()
  run(['--dry-run'], root, hub)
  assert.equal(fs.existsSync(path.join(hub, 'data', 'premise-status.json')), false)
  run([], root, hub)
  assert.equal(fs.existsSync(path.join(hub, 'data', 'premise-status.json')), true)
})

test('an unchanged reading inside the heartbeat window is not rewritten', () => {
  const { root, hub } = fixture()
  run([], root, hub)
  const file = path.join(hub, 'data', 'premise-status.json')
  const first = fs.readFileSync(file, 'utf8')
  const again = run([], root, hub)
  assert.equal(again.status, 0)
  assert.match(again.stdout, /nothing to write/)
  assert.equal(fs.readFileSync(file, 'utf8'), first, 'the timestamp does not churn a commit every five minutes')
})
