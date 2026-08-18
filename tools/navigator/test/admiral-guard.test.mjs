// The delivery record's single-writer rule for VERDICTS (obot.agent#167, under
// jwildfire/obot.roadmap#236, correction 1).
//
// The admiral writes its own actions here, so its work is judged by the same
// standard as any worker's — an overseer whose actions are invisible is the failure
// it exists to prevent. It does NOT write verdicts. Judging delivery stays the
// Navigator's, and a second writer makes this record two-sourced, which is exactly
// the defect this programme spent two days removing from the decisions registry,
// the dashboard queue and the roadmap page.
//
// Enforced in the tool rather than only in the admiral's skill file, because a rule
// that lives only in prose is a rule an agent can talk itself out of at three in the
// morning. These tests exist because the guard is invisible when it works.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const TOOL = join(REPO, 'tools', 'delivery-log')

const ws = () => mkdtempSync(join(tmpdir(), 'admiralguard-'))
const as = (actor, workspace, args) => spawnSync(TOOL, args, {
  env: { ...process.env, OBOT_WORKSPACE: workspace, OBOT_ACTOR: actor },
  encoding: 'utf8',
})
const record = (w) => {
  const f = join(w, '.claude/session-hub/delivery.md')
  return existsSync(f) ? readFileSync(f, 'utf8') : ''
}

const VERDICT = ['verdict', '--worker', 'W0099', '--produced', 'a PR',
                 '--requirement', 'hub#1', '--verdict', 'confirmed']

test('the admiral is REFUSED a verdict, and told what to do instead', () => {
  const w = ws()
  const r = as('admiral', w, VERDICT)
  assert.notEqual(r.status, 0, 'an admiral verdict must not be recorded')
  assert.equal(r.status, 2, 'exit 2 = you may not do this, distinct from 1 = bad arguments')
  assert.match(r.stderr, /never verdicts/)
  assert.match(r.stderr, /Report the closeout gap instead/)
  assert.match(r.stderr, /do not route around this/)
  assert.doesNotMatch(record(w), /W0099/, 'nothing may reach the record')
})

test('the refusal survives a sub-id, so an admiral cannot rename its way past it', () => {
  // 'fleet' is the name this role carried before obot.agent#182 and the bar still
  // covers it, deliberately: a bar that forgets a name is a bar that a session
  // started before the rename walks straight through.
  for (const actor of ['admiral', 'admiral-1', 'admiral:abc', 'fleet', 'fleet-1']) {
    const r = as(actor, ws(), VERDICT)
    assert.equal(r.status, 2, `${actor} must be refused`)
  }
})

test('the same actor CAN record a call — it is barred from judging, not from acting', () => {
  const w = ws()
  const r = as('admiral', w, ['call', '--kind', 'session-closed', '--summary', 'closed W0099'])
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout.trim(), /^n\d{4}$/, 'the bare id on stdout, for $(...)')
  assert.match(record(w), /session-closed · closed W0099/)
})

test('the Navigator is unaffected — this narrows one actor, not the tool', () => {
  const w = ws()
  const r = as('session:b510658b', w, VERDICT)
  assert.equal(r.status, 0, r.stderr)
  assert.match(record(w), /W0099 · produced a PR/)
})

test("a named actor's call is STAMPED in the record he reads, not only in the journal", () => {
  // The requirement's words: the admiral's own actions go in the delivery record
  // actor-stamped. Until now the actor lived only in the journal, so the file
  // @jwildfire actually reads could not answer "who decided this on my behalf".
  const w = ws()
  as('admiral', w, ['call', '--kind', 'pr-landed', '--summary', 'landed obot.agent#170'])
  assert.match(record(w), /· call n0001 · admiral · pr-landed · landed obot\.agent#170/)
})

test('a bare session id is NOT stamped — it would be noise on every Navigator line', () => {
  const w = ws()
  as('session:b510658b', w, ['call', '--kind', 'requirement-filed', '--summary', 'filed hub#236'])
  const line = record(w).split('\n').find((l) => l.includes('· call '))
  assert.match(line, /· call n0001 · requirement-filed · filed hub#236/)
  assert.doesNotMatch(line, /session:/)
})

test('the audit still reconciles when calls carry an actor stamp', () => {
  // The stamp changes the rendered line, and the audit checks that every id the
  // journal issued is still visible in that line. A format change that broke the
  // reconciliation would report a vanished decision on every run.
  const w = ws()
  as('admiral', w, ['call', '--kind', 'pr-held', '--summary', 'CI red on obot.agent#171'])
  as('session:abc', w, ['call', '--kind', 'requirement-filed', '--summary', 'filed hub#237'])
  const a = as('admiral', w, ['--audit'])
  assert.equal(a.status, 0, `audit found a discrepancy: ${a.stdout}`)
  assert.match(a.stdout.split('\n')[0], /record clean/, 'the verdict is the FIRST line')
  assert.match(a.stdout, /2 call\(s\) allocated, 2 present/)
})
