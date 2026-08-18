// Local-only work: the state where work exists and no GitHub-derived signal can see it.
//
// Requirement jwildfire/obot.roadmap#256, issue jwildfire/obot.agent#240.
//
// Four instances in two days, every one of them found by somebody looking at something
// else. What this file holds down is not the detection — that part is a `git status` —
// but the discrimination, because a check that fires on the six worktrees a working
// night leaves behind is muted inside a week and takes the real signal with it.
//
// So the cases that matter most here are the ones that must stay SILENT: a worker
// mid-task, a permanently untracked drafts folder, a `node_modules` nobody ignored,
// a branch a machine publishes and never proposes. Each has its own test, and each is
// a real state measured on this machine on 2026-08-18 rather than an invention.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

import {
  ALARM_BROKEN, ALARM_FINDING, BEHIND_COMMITS, HELD_GRACE_MIN, NOISE_SEGMENTS,
  PUBLISH_BRANCHES, UNPROPOSED_DAYS, UNPUSHED_HOURS,
  ALARM_CREDENTIAL, PRESERVED_TRAILER, classifyStatus, classifyWorktree, claimants, clonePosition, configFiles,
  credentialLines, localSection, newestMtime, readWorktrees, resolveRemote, scanConfigs,
  unproposedBranches, worktreeReading,
} from '../localwatch.mjs'
import { ALARM_RE, parseNavigatorState } from '../../ops-dashboard/lib/navigator.mjs'

const MIN = 60000
const HOUR = 60 * MIN

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'localwatch-'))
const git = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], {
  encoding: 'utf8',
  env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' },
}).trim()

/** An origin with one commit and a clone of it, the shape every case below starts from. */
const pair = () => {
  const root = tmp()
  const origin = path.join(root, 'origin')
  fs.mkdirSync(origin)
  git(origin, 'init', '-q', '-b', 'main')
  fs.writeFileSync(path.join(origin, 'code.txt'), 'one\n')
  git(origin, 'add', '-A')
  git(origin, 'commit', '-qm', 'one')
  const clone = path.join(root, 'clone')
  git(root, 'clone', '-q', origin, clone)
  return { root, origin, clone }
}

const advance = (origin, text) => {
  fs.writeFileSync(path.join(origin, 'code.txt'), text)
  git(origin, 'add', '-A')
  git(origin, 'commit', '-qm', text.trim())
}

// ── What counts as work in a working tree ────────────────────────────────────────

test('a tracked modification is work wherever it is', () => {
  const s = classifyStatus(' M scripts/lib/nav.mjs\n D scripts/spike/board.mjs\n', { main: false })
  assert.equal(s.tracked, 2)
  assert.equal(s.untracked, 0)
  assert.equal(s.substantive, 2)
})

test('untracked content in a linked worktree is work — that is where a dead worker\'s afternoon hides', () => {
  // roadmap-rebuild, 2026-08-16: 1,925 untracked lines that no GitHub signal could see.
  const s = classifyStatus('?? scripts/build_roadmap.mjs\n?? scripts/roadmap/\n', { main: false })
  assert.equal(s.untracked, 2)
  assert.equal(s.substantive, 2)
})

test('untracked content in the MAIN checkout is not work — the drafts folder is permanently full', () => {
  // 81 untracked files in obot.agent/drafts on 2026-08-18, and permanent by convention.
  // selfupdate.mjs made this argument about the same folder: a guard that demanded a
  // spotless tree would refuse every run and be true exactly once.
  const s = classifyStatus('?? drafts/obot.agent/ISSUE_N_x.md\n?? drafts/gsm.safety/\n', { main: true })
  assert.equal(s.untracked, 0)
  assert.equal(s.skippedUntracked, 2)
  assert.equal(s.substantive, 0)
})

test('a tracked change in the MAIN checkout is still work', () => {
  const s = classifyStatus(' M scripts/policy.json\n?? drafts/x.md\n', { main: true })
  assert.equal(s.tracked, 1)
  assert.equal(s.substantive, 1)
})

test('dependency output is not work, and the count of what was filtered is kept', () => {
  // open.csr-worktrees/css-brace-fix-2 has been dirty for 22 days with exactly one
  // untracked path, and that path is node_modules.
  const s = classifyStatus('?? node_modules\n', { main: false })
  assert.equal(s.substantive, 0)
  assert.equal(s.noise, 1)
  assert.ok(NOISE_SEGMENTS.includes('node_modules'))
})

test('a noise segment anywhere in the path is filtered, and a rename keeps its destination', () => {
  const s = classifyStatus('?? site/node_modules/x\nR  old.mjs -> new.mjs\n', { main: false })
  assert.equal(s.noise, 1)
  assert.equal(s.tracked, 1)
  assert.deepEqual(s.paths, ['new.mjs'])
})

// ── Age plus absence of an owner, never dirtiness ────────────────────────────────

const worker = (id, startedAt, status = 'busy') => ({ id, name: `👯🤖 ${id} 2026-08-18 slug`, status, startedAt })
// The fleet as the sweep actually builds it: ledger rows through `claimants`, which is
// where the worker-tagged/busy rule lives. Going round it in a test would prove the
// rule holds in a copy of itself.
const fleet = (...rows) => claimants(rows, [])
const now = Date.parse('2026-08-18T09:00:00Z')
const dirty = (newestMs, over = {}) => ({ repo: 'jwildfire/obot.roadmap', path: '/w/rebuild', branch: 'rebuild', main: false, read: true, tracked: 6, untracked: 2, noise: 0, newestMs, ...over })

test('a worktree written to minutes ago is a worker mid-task and never a finding', () => {
  const c = classifyWorktree(dirty(now - 4 * MIN), { claimants: fleet(worker('W0060', now - HOUR)), now })
  assert.equal(c.kind, 'active')
  assert.equal(c.alarm, false)
})

test('a stale worktree no live worker could have written is stranded', () => {
  // The measured instance: roadmap-rebuild, last written 2026-08-16, every live worker
  // started this morning.
  const c = classifyWorktree(dirty(now - 48 * HOUR), { claimants: fleet(worker('W0060', now - HOUR)), now })
  assert.equal(c.kind, 'stranded')
  assert.equal(c.alarm, true)
  assert.ok(c.ageText.includes('d'), c.ageText)
})

test('a stale worktree a live worker predates is HELD, not an alarm — and still on the page', () => {
  // A worker can read GitHub and run tests for an hour without writing a file. It gets
  // a row, because a suppressed row is the failure this check exists to end; it does
  // not get an alarm, because nagging is how the check gets muted.
  const c = classifyWorktree(dirty(now - 5 * HOUR), { claimants: fleet(worker('W0044', now - 9 * HOUR)), now })
  assert.equal(c.kind, 'held')
  assert.equal(c.alarm, false)
  assert.match(c.why, /W0044/)
})

test('an idle worker holds nothing — a finished session lingers in the ledger for hours', () => {
  const c = classifyWorktree(dirty(now - 5 * HOUR), { claimants: fleet(worker('W0057', now - 9 * HOUR, 'idle')), now })
  assert.equal(c.kind, 'stranded')
})

test('a standing session is never a claimant — the Navigator authors the plan and never touches the work', () => {
  // prime has been running since before every worktree on this machine, so counting a
  // standing session would suppress every finding there is.
  const prime = { id: '5a3ddda9', name: '🎩🤖 obot-prime', status: 'busy', startedAt: now - 40 * HOUR }
  const nav = { id: 'b510658b', name: '🧭🤖 obot-navigator', status: 'busy', startedAt: now - 30 * HOUR }
  const c = classifyWorktree(dirty(now - 5 * HOUR), { claimants: fleet(prime, nav), now })
  assert.equal(c.kind, 'stranded')
})

test('an unreadable fleet ledger is not an empty fleet — the row is stale and unjudged', () => {
  const c = classifyWorktree(dirty(now - 48 * HOUR), { claimants: null, now })
  assert.equal(c.kind, 'unjudged')
  assert.equal(c.alarm, false)
  assert.match(c.why, /could not be read/)
})

test('a change whose age could not be measured is UNKNOWN, never 56 years stranded', () => {
  // The first live run reported `obot.agent w0060-commit-identity` as stranded with one
  // tracked change "untouched for 20683d" — an epoch timestamp wearing a number. The
  // worktree belonged to a worker that was actively committing at that moment, and the
  // path had gone from under `statSync` between the status call and the stat.
  //
  // A failed measurement became a confident, false, alarming one. Unknown is its own
  // answer: zero would read as 1970, and 1970 reads as abandoned.
  const c = classifyWorktree(dirty(0, { newestMs: null }), { claimants: [], now })
  assert.equal(c.kind, 'unknown-age')
  assert.equal(c.alarm, false)
  assert.match(c.why, /could not be/i)
})

test('a deletion is still dated — the parent directory remembers when the file went', () => {
  const dir = tmp()
  fs.mkdirSync(path.join(dir, 'scripts'))
  fs.writeFileSync(path.join(dir, 'scripts', 'kept.txt'), 'x')
  // `gone.txt` never existed on disk: this is the shape `git status` reports for a
  // tracked file the worker deleted, and the only mtime available is its directory's.
  const ms = newestMtime(dir, ['scripts/gone.txt'])
  assert.ok(ms > 0, 'a deleted path must not measure as the epoch')
  assert.equal(ms, fs.statSync(path.join(dir, 'scripts')).mtimeMs)
})

test('a change set where nothing at all can be dated measures as null, not as zero', () => {
  assert.equal(newestMtime('/no/such/place/at/all', ['a/b.txt']), null)
})

test('a clean worktree is clean and a worktree that could not be read is neither', () => {
  assert.equal(classifyWorktree(dirty(now, { tracked: 0, untracked: 0 }), { claimants: [], now }).kind, 'clean')
  assert.equal(classifyWorktree(dirty(now, { read: false }), { claimants: [], now }).kind, 'unread')
})

test('the grace window is what separates the two, and it is generous against a 4-hour session budget', () => {
  assert.ok(HELD_GRACE_MIN >= 60)
  const inside = classifyWorktree(dirty(now - (HELD_GRACE_MIN - 1) * MIN), { claimants: [], now })
  const outside = classifyWorktree(dirty(now - (HELD_GRACE_MIN + 1) * MIN), { claimants: [], now })
  assert.equal(inside.kind, 'active')
  assert.equal(outside.kind, 'stranded')
})

// ── The claimants, read off the live fleet ───────────────────────────────────────

test('claimants come from the agent ledger, are worker-tagged and busy, and take their start from the job record', () => {
  // ListAgents is the authority on liveness; the job record's createdAt is the
  // authority on when the SESSION began. The ledger's startedAt is the host process,
  // and a background host is a pooled spare that can predate its session by an hour
  // (obot.agent#223) — which would bias this toward suppressing findings.
  const rows = [
    { id: 'aaa', name: '👯🤖 W0060 2026-08-18 gitidentity', status: 'busy', startedAt: now - 3 * HOUR },
    { id: 'bbb', name: '👯🤖 W0057 2026-08-18 orgchart2', status: 'idle', startedAt: now - 5 * HOUR },
    { id: 'ccc', name: '🧭🤖 obot-navigator', status: 'busy', startedAt: now - 30 * HOUR },
  ]
  const jobs = [{ id: 'aaa', createdAt: new Date(now - 90 * MIN).toISOString() }]
  const out = claimants(rows, jobs)
  assert.equal(out.length, 1)
  assert.equal(out[0].id, 'aaa')
  assert.equal(out[0].startedMs, now - 90 * MIN, 'the job record wins over the pooled host')
})

test('an unreadable agent ledger yields null, never an empty list', () => {
  assert.equal(claimants(null, []), null)
})

// ── Branches nobody ever proposed ────────────────────────────────────────────────

const branch = (name, days, over = {}) => ({
  repo: 'jwildfire/obot.roadmap', branch: name, remote: 'origin',
  lastCommitMs: now - days * 24 * HOUR, hasPR: false, merged: false, ...over,
})

test('a branch with no pull request and no merge, past the age, is a finding', () => {
  // org-chart-237: built by one worker, revised by a second, never proposed, and the
  // page it was for returned 404 for a day and a half.
  const r = unproposedBranches([branch('org-chart-237', 2)], { now })
  assert.equal(r.findings.length, 1)
  assert.match(r.findings[0].line, /org-chart-237/)
})

test('a branch pushed today is not a finding — a pull request is often minutes away', () => {
  const r = unproposedBranches([branch('w0059-localwatch', 0)], { now })
  assert.equal(r.findings.length, 0)
  assert.equal(r.tooYoung, 1)
})

test('a branch that was merged, or that has a pull request, is not a finding', () => {
  const r = unproposedBranches([branch('merged-one', 30, { merged: true }), branch('proposed', 30, { hasPR: true })], { now })
  assert.equal(r.findings.length, 0)
})

test('branches a machine publishes are excluded, and the exclusion is counted, never silent', () => {
  // gh-pages in three repos and session-state in the hub: written by CI, never
  // proposed by design. A check that reported them would be noise on every run.
  const rows = [branch('gh-pages', 26), branch('session-state', 0), branch('demo', 145)]
  const r = unproposedBranches(rows, { now })
  assert.equal(r.excluded, 2)
  assert.equal(r.findings.length, 1)
  assert.ok(PUBLISH_BRANCHES.includes('gh-pages') && PUBLISH_BRANCHES.includes('session-state'))
})

test('a branch holding a role in policy.json is skipped — a release lane is merged into, never proposed from', () => {
  // The first live run reported `open.csr main`, `demo-301 site`, `obot.agent stable`,
  // `safety.viz main` and `gsm.safety main` alongside one real branch. Every one of
  // them is permanently true and permanently useless, and six rows of which five are
  // noise is the ratio that gets a section skipped.
  const rows = [branch('main', 22, { role: true }), branch('site', 20, { role: true }), branch('demo', 145)]
  const r = unproposedBranches(rows, { now })
  assert.equal(r.roles, 2)
  assert.equal(r.findings.length, 1)
  assert.equal(r.findings[0].branch, 'demo')
})

test('a branch preserved on purpose is never a finding — its remedy is forbidden', () => {
  // `roadmap-rebuild` on obot.roadmap: a dead worker's 1,925 uncommitted lines,
  // committed and pushed so they are recoverable, verified superseded before the
  // commit was made. It is not a role branch, not machine-published, not merged and
  // has no pull request, so a day later it would land under "nobody ever proposed"
  // with a prescribed next command that must never be run. A finding whose remedy is
  // forbidden is what teaches a reader to skip the section.
  const rows = [branch('roadmap-rebuild', 3, { preservedBy: 'W0061' }), branch('demo', 145)]
  const r = unproposedBranches(rows, { now })
  assert.equal(r.findings.length, 1)
  assert.equal(r.findings[0].branch, 'demo')
  assert.equal(r.preserved.length, 1)
  assert.match(r.preserved[0].line, /W0061/)
})

test('a preserved branch gets a row saying what it is, never a silent exclusion', () => {
  // The whole point of the branch is that somebody deliberately kept something. An
  // exclusion count cannot say that, so this one is listed rather than subtracted.
  const r = unproposedBranches([branch('roadmap-rebuild', 3, { preservedBy: 'W0061' })], { now })
  const md = localSection({
    worktrees: [], branches: r, clones: [], claimants: [],
    fetchedAt: new Date(now - 5 * MIN).toISOString(),
  }, now)
  assert.doesNotMatch(md, ALARM_RE, 'a preservation is not an alarm')
  assert.match(md, /preserved by W0061/)
  assert.match(md, /no pull request expected/)
  assert.ok(PRESERVED_TRAILER === 'Preserved-by')
})

test('the age bar is short, because a branch found the morning after is still found in time', () => {
  assert.ok(UNPROPOSED_DAYS >= 1 && UNPROPOSED_DAYS <= 3)
})

// ── The clone against the repository it is supposed to be a clone of ─────────────

test('the remote is the one whose URL names the repo, never whichever is called origin', () => {
  // gsm.safety: origin is obot-claw, the org archived read-only on 2026-07-02.
  // open.gismo: origin is Gilead-BioStats and the jwildfire remote is called fork.
  const remotes = [
    { name: 'origin', url: 'git@github.com:obot-claw/gsm.safety.git' },
    { name: 'jwildfire', url: 'git@github.com:jwildfire/gsm.safety.git' },
  ]
  assert.equal(resolveRemote(remotes, 'jwildfire/gsm.safety'), 'jwildfire')
  assert.equal(resolveRemote([{ name: 'origin', url: 'https://github.com/jwildfire/obot.agent' }], 'jwildfire/obot.agent'), 'origin')
  assert.equal(resolveRemote([{ name: 'origin', url: 'git@github.com:Gilead-BioStats/open.gismo.git' }], 'jwildfire/open.gismo'), null)
})

test('a clone far behind its remote is a finding — an agent reading it reads a different repository', () => {
  const { origin, clone } = pair()
  for (let i = 0; i < BEHIND_COMMITS + 1; i++) advance(origin, `c${i}\n`)
  git(clone, 'fetch', '-q', 'origin')
  const p = clonePosition(clone, { remote: 'origin', repo: 'x/y' })
  assert.equal(p.read, true)
  assert.equal(p.behind, BEHIND_COMMITS + 1)
  assert.equal(p.alarm, true)
})

test('a clone a couple of commits behind is a row, not an alarm', () => {
  const { origin, clone } = pair()
  advance(origin, 'two\n')
  git(clone, 'fetch', '-q', 'origin')
  const p = clonePosition(clone, { remote: 'origin', repo: 'x/y' })
  assert.equal(p.behind, 1)
  assert.equal(p.alarm, false)
})

test('a local commit that was never pushed is the most literal form of the same property', () => {
  const { clone } = pair()
  fs.writeFileSync(path.join(clone, 'local.txt'), 'never pushed\n')
  git(clone, 'add', '-A')
  git(clone, 'commit', '-qm', 'local only')
  const p = clonePosition(clone, { remote: 'origin', repo: 'x/y', now: Date.now() + UNPUSHED_HOURS * HOUR + MIN })
  assert.equal(p.ahead, 1)
  assert.equal(p.alarm, true)
  assert.match(p.line, /never (reached|pushed)|unpushed/i)
})

test('a commit made moments ago is not unpushed work — the push is the next command', () => {
  const { clone } = pair()
  fs.writeFileSync(path.join(clone, 'local.txt'), 'about to push\n')
  git(clone, 'add', '-A')
  git(clone, 'commit', '-qm', 'about to push')
  const p = clonePosition(clone, { remote: 'origin', repo: 'x/y' })
  assert.equal(p.ahead, 1)
  assert.equal(p.alarm, false)
})

test('a position that could not be measured is unknown, and unknown never reads as current', () => {
  const p = clonePosition(tmp(), { remote: 'origin', repo: 'x/y' })
  assert.equal(p.read, false)
  assert.match(p.line, /could not be/i)
})

// ── Reading a real repository, worktrees and all ─────────────────────────────────

test('every worktree of a repo is read, the main one is marked, and its dirt is measured', () => {
  const { clone } = pair()
  const wt = path.join(clone, '.claude', 'worktrees', 'feature')
  git(clone, 'worktree', 'add', '-q', '-b', 'feature', wt)
  fs.writeFileSync(path.join(wt, 'stranded.txt'), 'work nobody can see\n')
  fs.writeFileSync(path.join(clone, 'code.txt'), 'changed\n')

  const list = readWorktrees(clone)
  assert.equal(list.length, 2)
  assert.equal(list[0].main, true)
  assert.equal(list.filter((w) => w.branch === 'feature').length, 1)

  const readings = list.map((w) => worktreeReading('x/y', w))
  const feature = readings.find((r) => r.branch === 'feature')
  assert.equal(feature.untracked, 1)
  assert.ok(feature.newestMs > 0)
  const mainWt = readings.find((r) => r.main)
  assert.equal(mainWt.tracked, 1)
})


// ── Credentials recorded in a git config (obot.agent#246) ───────────────────────

// `git push -u https://x-access-token:TOKEN@github.com/...` records the URL it was
// handed as `branch.<name>.remote`, so a live installation token lands in a file that
// travels when the directory is copied. Three were sitting on this machine across two
// repositories, written on earlier nights, and nothing detected them — which is the
// same sentence as the rest of this section rather than a different one.
const TOKEN = 'ghs_' + 'A'.repeat(36)
const CONFIG_WITH_TOKEN = `[core]
\trepositoryformatversion = 0
[remote "origin"]
\turl = git@github.com:jwildfire/safety.viz.git
[branch "fix-79-qtc"]
\tremote = https://x-access-token:${TOKEN}@github.com/jwildfire/safety.viz.git
\tmerge = refs/heads/fix-79-qtc
`

test('a credential recorded in a config is found, and named by its stanza', () => {
  const hits = credentialLines(CONFIG_WITH_TOKEN)
  assert.equal(hits.length, 1)
  assert.equal(hits[0].stanza, 'branch "fix-79-qtc"')
  assert.equal(hits[0].key, 'remote')
})

test('THE FINDING NEVER CARRIES WHAT IT MATCHED', () => {
  // The row renders to the Navigator panel, to the state file prime reads, and into
  // the wrapup that folds the shared scratchpad. A row carrying the matched string
  // publishes the credential to four surfaces in order to report that it was in one.
  const hits = credentialLines(CONFIG_WITH_TOKEN)
  assert.equal(JSON.stringify(hits).includes(TOKEN), false, 'the reading itself must not carry the secret')
  const md = localSection({
    worktrees: [], branches: { findings: [], excluded: 0, tooYoung: 0 }, clones: [], claimants: [],
    fetchedAt: new Date(now - 5 * MIN).toISOString(),
    credentials: { scanned: 7, unreadable: [], findings: [{ repo: 'jwildfire/safety.viz', file: 'safety.viz/.git/config', ...hits[0] }] },
  }, now)
  assert.equal(md.includes(TOKEN), false, 'the rendered section must not carry the secret')
  assert.match(md, /safety\.viz/)
  assert.match(md, /fix-79-qtc/)
  assert.match(md, ALARM_RE)
})

test('an ordinary config is clean — ssh and scp remotes carry no password to embed', () => {
  const clean = `[remote "origin"]
\turl = git@github.com:jwildfire/obot.agent.git
[remote "up"]
\turl = ssh://git@github.com/jwildfire/obot.agent.git
[branch "main"]
\tremote = origin
`
  assert.deepEqual(credentialLines(clean), [])
})

test('a bare token in a value is a credential even with no URL around it', () => {
  const hits = credentialLines(`[http]\n\textraheader = Authorization: bearer github_pat_${'x'.repeat(22)}\n`)
  assert.equal(hits.length, 1)
  assert.equal(hits[0].stanza, 'http')
})

test('a credential above any stanza is reported, not dropped — a record with no section is still a record', () => {
  const hits = credentialLines(`\turl = https://u:p@github.com/x/y.git\n[core]\n\tbare = false\n`)
  assert.equal(hits.length, 1)
  assert.equal(hits[0].stanza, '(no section)')
})

test('nothing scanned is reported apart from nothing found — zero on a new machine is the reading most likely to be believed', () => {
  const md = localSection({
    worktrees: [], branches: { findings: [], excluded: 0, tooYoung: 0 }, clones: [], claimants: [],
    fetchedAt: new Date(now - 5 * MIN).toISOString(),
    credentials: { scanned: 0, unreadable: [], findings: [] },
  }, now)
  assert.ok(md.includes(ALARM_BROKEN), md.slice(0, 400))
  assert.match(md, /no git config was scanned/i)
})

test('a config that could not be read is unreadable, never clean', () => {
  const md = localSection({
    worktrees: [], branches: { findings: [], excluded: 0, tooYoung: 0 }, clones: [], claimants: [],
    fetchedAt: new Date(now - 5 * MIN).toISOString(),
    credentials: { scanned: 6, unreadable: ['gsm.safety/.git/config'], findings: [] },
  }, now)
  assert.ok(md.includes(ALARM_BROKEN))
  assert.match(md, /gsm\.safety/)
})

test('a clean scan says how many configs it read, so clean is distinguishable from silent', () => {
  const md = localSection({
    worktrees: [], branches: { findings: [], excluded: 0, tooYoung: 0 }, clones: [], claimants: [],
    fetchedAt: new Date(now - 5 * MIN).toISOString(),
    credentials: { scanned: 15, unreadable: [], findings: [] },
  }, now)
  assert.doesNotMatch(md, ALARM_RE)
  assert.match(md, /15 git config/i)
})

test('the headline breakdown adds up — a credential is not counted as a piece of work', () => {
  // The first proof run printed "1 piece(s) of work … 0 stranded, 0 unproposed, 0
  // checkouts". A breakdown that does not add up costs more trust than the finding buys,
  // and a credential at rest is a different thing from work that never shipped.
  const md = localSection({
    worktrees: [], branches: { findings: [], excluded: 0, tooYoung: 0 }, clones: [], claimants: [],
    fetchedAt: new Date(now - 5 * MIN).toISOString(),
    credentials: { scanned: 3, unreadable: [], findings: [{ repo: 'x', file: 'x/.git/config', stanza: 'branch "y"', key: 'remote' }] },
  }, now)
  assert.doesNotMatch(md, /piece\(s\) of work/, 'no work finding, so no work headline')
  assert.ok(md.includes(ALARM_CREDENTIAL))
  assert.doesNotMatch(md, /local-only work: clean/, 'and it must not call itself clean either')
})

test('the credential headline matches the real ALARM_RE', () => {
  assert.match(ALARM_CREDENTIAL, ALARM_RE)
})

test('scanConfigs reads real files, counts what it could not open, and names no values', () => {
  const dir = tmp()
  fs.mkdirSync(path.join(dir, 'a', '.git'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'a', '.git', 'config'), CONFIG_WITH_TOKEN)
  fs.mkdirSync(path.join(dir, 'b', '.git'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'b', '.git', 'config'), '[core]\n\tbare = false\n')
  const r = scanConfigs([
    { repo: 'x/a', file: path.join(dir, 'a', '.git', 'config') },
    { repo: 'x/b', file: path.join(dir, 'b', '.git', 'config') },
    { repo: 'x/gone', file: path.join(dir, 'gone', '.git', 'config') },
  ])
  assert.equal(r.scanned, 2)
  assert.equal(r.unreadable.length, 1)
  assert.equal(r.findings.length, 1)
  assert.equal(r.findings[0].stanza, 'branch "fix-79-qtc"')
  assert.equal(JSON.stringify(r).includes(TOKEN), false)
})

test('every clone in the workspace is scanned, not only the policy seven — a token travels from any of them', () => {
  const ws = tmp()
  for (const name of ['obot.agent', 'gsm.kri', 'notarepo']) fs.mkdirSync(path.join(ws, name), { recursive: true })
  for (const name of ['obot.agent', 'gsm.kri']) {
    fs.mkdirSync(path.join(ws, name, '.git'), { recursive: true })
    fs.writeFileSync(path.join(ws, name, '.git', 'config'), '[core]\n')
  }
  const files = configFiles(ws)
  assert.equal(files.length, 2)
  assert.ok(files.some((f) => f.repo === 'gsm.kri'), 'a non-policy clone still holds credentials that travel')
})

// ── The verdict has to reach the page ────────────────────────────────────────────

test('the finding headline matches the real ALARM_RE, imported rather than copied', () => {
  assert.match(ALARM_FINDING, ALARM_RE)
  assert.match(ALARM_BROKEN, ALARM_RE)
})

test('a section with a stranded worktree reaches the Navigator panel as an alarm', () => {
  const md = localSection({
    worktrees: [dirty(now - 48 * HOUR)],
    branches: { findings: [{ line: 'obot.roadmap `org-chart-237` — 2d old, no pull request, not merged' }], excluded: 2, tooYoung: 0 },
    clones: [{ repo: 'jwildfire/gsm.safety', behind: 31, ahead: 0, read: true, alarm: true, line: 'gsm.safety — 31 behind `jwildfire/main` as last fetched 09:00' }],
    claimants: fleet(worker('W0060', now - HOUR)),
    fetchedAt: new Date(now - 10 * MIN).toISOString(),
  }, now)
  assert.match(md, ALARM_RE)
  const parsed = parseNavigatorState(`# x\n\nswept: 2026-08-18 09:00 · cadence 5m\n\n${md}`, new Date(now))
  const section = parsed.sections.find((s) => /Local-only work/i.test(s.title))
  assert.ok(section, `no section: ${parsed.sections.map((s) => s.title).join(', ')}`)
  assert.ok(section.items.some((i) => i.alarm), 'the verdict must render as an alarm, not as grey text')
  assert.ok(md.includes('org-chart-237'))
  assert.ok(md.includes('31 behind'))
})

test('a clean run still renders the section — a detector that only speaks up on failure looks dead', () => {
  const md = localSection({
    worktrees: [dirty(now - 3 * MIN)],
    branches: { findings: [], excluded: 2, tooYoung: 1 },
    clones: [{ repo: 'jwildfire/obot.agent', behind: 0, ahead: 0, read: true, alarm: false, line: 'obot.agent — level with `origin/main` as last fetched 09:00' }],
    claimants: fleet(worker('W0060', now - HOUR)),
    fetchedAt: new Date(now - 10 * MIN).toISOString(),
  }, now)
  assert.doesNotMatch(md, ALARM_RE)
  assert.match(md, /## Local-only work/)
  assert.match(md, /clean/i)
})

test('an unreadable fleet makes the whole section say so rather than report nobody home', () => {
  const md = localSection({
    worktrees: [dirty(now - 48 * HOUR)],
    branches: { findings: [], excluded: 0, tooYoung: 0 },
    clones: [],
    claimants: null,
    fetchedAt: new Date(now - 10 * MIN).toISOString(),
  }, now)
  assert.ok(md.includes(ALARM_BROKEN), md.slice(0, 400))
})

test('every exclusion prints its count — a truncated list that does not say so reads as full coverage', () => {
  const md = localSection({
    worktrees: [dirty(now, { tracked: 0, untracked: 0, noise: 1 })],
    branches: { findings: [], excluded: 3, tooYoung: 2 },
    clones: [],
    claimants: [],
    fetchedAt: new Date(now - 10 * MIN).toISOString(),
  }, now)
  assert.match(md, /3 .*excluded|excluded: 3/i)
})

test('the fetch age is on the page, because a number that is quietly an hour old is a number nobody can use', () => {
  const md = localSection({
    worktrees: [], branches: { findings: [], excluded: 0, tooYoung: 0 }, clones: [],
    claimants: [], fetchedAt: new Date(now - 47 * MIN).toISOString(),
  }, now)
  assert.match(md, /last fetched/i)
  assert.match(md, /47m|48m/)
})

test('a fetch that FAILED is said out loud too — otherwise a stale number hides behind a fresh stamp', () => {
  // The first version stamped `fetchedAt` on every run and dropped the failures, so
  // the header read "last fetched 0m ago" over a repo whose fetch had just failed and
  // whose position was hours old. That is the house failure mode with a timestamp on it.
  const md = localSection({
    worktrees: [], branches: { findings: [], excluded: 0, tooYoung: 0 }, clones: [],
    claimants: [], fetchedAt: new Date(now - 5 * MIN).toISOString(), fetchFailed: ['gsm.safety'],
  }, now)
  assert.ok(md.includes(ALARM_BROKEN), md.slice(0, 300))
  assert.match(md, /gsm\.safety/)
})

test('branches whose pull requests could not be listed are unread, never "excluded"', () => {
  // Counting them as exclusions put them in the same sentence as gh-pages — skipped
  // because they are machine-written — when the truth is that nobody could tell.
  const r = unproposedBranches([branch('org-chart-237', 5, { unread: 'pull requests could not be listed' })], { now })
  assert.equal(r.findings.length, 0)
  assert.equal(r.unread, 1)
  assert.equal(r.excluded, 0)
  const md = localSection({
    worktrees: [], branches: r, clones: [], claimants: [],
    fetchedAt: new Date(now - 5 * MIN).toISOString(),
  }, now)
  assert.ok(md.includes(ALARM_BROKEN))
  assert.match(md, /could not be checked for a pull request/)
})

test('a fetch that never happened is said out loud rather than rendered as fresh', () => {
  const md = localSection({
    worktrees: [], branches: { findings: [], excluded: 0, tooYoung: 0 }, clones: [],
    claimants: [], fetchedAt: null,
  }, now)
  assert.match(md, /never fetched|no fetch/i)
})
