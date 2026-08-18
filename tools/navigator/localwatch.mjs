#!/usr/bin/env node
// localwatch — the work that exists on this machine and nowhere else.
//
// Requirement: jwildfire/obot.roadmap#256. Issue: jwildfire/obot.agent#240.
//
// Every check this house runs reads GitHub, and GitHub answers accurately about
// everything that reached it. Four instances of work that never reached it surfaced
// in two days — 1,925 untracked lines in a dead worker's worktree, a branch nobody
// ever proposed carrying a page that returned 404 for a day and a half, a clone
// eleven commits behind that the morning fold committed onto, and 180 uncommitted
// lines that cost a worker a `drift` verdict it did not deserve. None was found by a
// check. All four were found by somebody looking at something else.
//
// They fail differently from the defects this house usually catches. A silent success
// reports that something happened when it did not; these report nothing at all, which
// is why no alarm vocabulary covered them. This is that vocabulary.
//
// THE HARD PART IS NOT THE DETECTION. Finding a dirty worktree is a `git status`.
// Six worktrees were dirty the night this was scoped and most were workers mid-task,
// which is the correct state — and a check that fires on them is muted inside a week
// and takes the real signal with it. So the discrimination is the whole design, and
// it rests on two gates that must BOTH hold before anything is called stranded:
//
//   STALE — nothing has written to the worktree in HELD_GRACE_MIN. A live worker
//     writes to its worktree constantly; against a four-hour session budget a
//     two-hour silence is not a worker thinking, it is a worker gone.
//   ORPHANED — no live worker-tagged session that is still busy was already running
//     when the worktree was last written. A session that started afterwards cannot
//     have produced what is there.
//
// A stale worktree that a live worker predates is HELD: it gets a row and no alarm.
// It keeps the row because a suppressed row is the exact failure this file exists to
// end, and it loses the alarm because nagging is how the check dies.
//
// WHAT WAS TRIED AND REJECTED. Grepping live sessions' transcripts for the worktree
// path, to name an owner outright. Measured on 2026-08-18 and it is worse than no
// signal at all: the Navigator's transcript, prime's transcript and the implementing
// worker's own transcript all contained `roadmap-rebuild`, because all three had
// DISCUSSED it. A mention says some live session talked about a path, never that
// anyone holds it — and shipping it would have suppressed every worktree the
// Navigator ever mentioned. Ownership is measured as writes and never inferred from
// talk.
//
// LIVENESS COMES FROM THE AGENT LEDGER, START TIME FROM THE JOB RECORD. `claude
// agents --json` is the authority on who is running. It is NOT the authority on when
// a session began: the pid it reports is a pooled `bg-spare` and one was measured
// fifty-six minutes older than the session listed under it (obot.agent#223), which
// would bias this toward suppressing findings. The job record's `createdAt` is a fact
// about the session, so each source answers the question it can actually answer.
//
// AND NOTHING HERE FIXES ANYTHING. No pull, no commit, no worktree removed, no branch
// pushed. Detection only — the one place where acting on a GitHub-derived signal can
// destroy what no GitHub-derived signal can observe is the standing worktree-cleanup
// grant, and this exists so that grant has something to consult.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** The finding headline, and the one that says a source could not be read.
 *
 *  Spelled for ALARM_RE in tools/ops-dashboard/lib/navigator.mjs, which is
 *  case-sensitive, keyed on GAP/FINDING/BREACHED/FAILED/DOWN/BROKEN and admits only
 *  `[A-Z0-9 ]` between the asterisks. The tests assert these against the imported
 *  regex rather than a copy of it (obot.agent#223): a headline that does not match
 *  reaches his page as ordinary grey text, and a detector whose verdict cannot render
 *  is indistinguishable from a clean one. That is #129, and it has happened twice. */
export const ALARM_FINDING = '**LOCAL WORK GAP**'
export const ALARM_BROKEN = '**LOCAL WORK READING BROKEN**'

const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d)

/** How long a worktree may sit untouched before it stops looking like a worker at
 *  work. Generous on purpose: a worker can read GitHub, run a suite and think for
 *  half an hour without writing a file, and the cost of a false alarm here is the
 *  whole check. */
export const HELD_GRACE_MIN = num(process.env.OBOT_LOCALWATCH_GRACE_MIN, 120)

/** How old an unproposed branch has to be. Short, because `org-chart-237` was a day
 *  old when it mattered and the page it carried was already returning 404 — but not
 *  zero, because a branch pushed a minute ago is usually a `gh pr create` away. */
export const UNPROPOSED_DAYS = num(process.env.OBOT_LOCALWATCH_BRANCH_DAYS, 1)

/** How far behind a clone has to be before it stops being lag and starts being a
 *  different repository. `gsm.safety` was thirty-one behind, `open.csr` nineteen. */
export const BEHIND_COMMITS = num(process.env.OBOT_LOCALWATCH_BEHIND, 5)

/** How long a local commit may sit unpushed. A worker commits and then pushes; six
 *  hours later it is not a sequence in progress. */
export const UNPUSHED_HOURS = num(process.env.OBOT_LOCALWATCH_UNPUSHED_HOURS, 6)

/** How often the remotes are refreshed — see `fetchIfDue`. */
export const FETCH_TTL_MIN = num(process.env.OBOT_LOCALWATCH_FETCH_TTL_MIN, 60)

/**
 * Untracked paths that are not work.
 *
 * Deliberately short. Anything a repo ignores never reaches `git status` at all, so
 * this list only has to cover what a repo forgot to ignore — and the cost of a wrong
 * entry is a finding that silently never fires, which is the defect this file is
 * about. `open.csr-worktrees/css-brace-fix-2` has been dirty for twenty-two days with
 * exactly one untracked path, and that path is `node_modules`.
 */
export const NOISE_SEGMENTS = ['node_modules', '.venv', '__pycache__', '.DS_Store',
                               '.Rproj.user', 'renv/library', '.pytest_cache', 'coverage']

/**
 * Branches a machine publishes and never proposes.
 *
 * `gh-pages` in three repos, `session-state` in the hub — written by CI or by the
 * session-hub loop, and correct with no pull request behind them. Reporting them
 * would put three or four rows on every single sweep, which is the shape that gets a
 * section skipped. Excluded, and the count is always printed.
 */
export const PUBLISH_BRANCHES = ['gh-pages', 'session-state', 'gh-pages-preview']

/** The tag every worker carries in its session name. A standing session is not one. */
const WORKER_TAG = '\u{1F46F}\u{1F916}' // 👯🤖

const MIN = 60000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

const shortRepo = (repo) => String(repo).replace(/^jwildfire\//, '')

/** An age a person can read at a glance, and never a bare number of minutes past a day. */
export function ageText(ms) {
  if (!Number.isFinite(ms) || ms < 0) return 'unknown'
  if (ms < HOUR) return `${Math.round(ms / MIN)}m`
  if (ms < DAY) return `${Math.round(ms / HOUR)}h`
  return `${Math.round(ms / DAY)}d`
}

const noisy = (p) => NOISE_SEGMENTS.some((seg) => (`/${p}/`).includes(`/${seg}/`) || p === seg || p.endsWith(`/${seg}`))

/**
 * What a `git status --porcelain` actually contains, split into work and not-work.
 *
 * THE MAIN CHECKOUT COUNTS TRACKED CHANGES ONLY. Its `drafts/` folder held 81
 * untracked files on 2026-08-18 and is permanently full by convention; selfupdate.mjs
 * already made this argument about the same folder — a guard that demanded a spotless
 * tree would refuse every run and be true exactly once. A LINKED worktree counts
 * untracked content too, because that is precisely where a dead worker's work hides:
 * the `roadmap-rebuild` instance was 1,925 untracked lines and nothing else.
 */
export function classifyStatus(porcelain = '', { main = false } = {}) {
  let tracked = 0
  let untracked = 0
  let noise = 0
  let skippedUntracked = 0
  const paths = []
  for (const raw of String(porcelain).split('\n')) {
    if (!raw.trim()) continue
    const code = raw.slice(0, 2)
    // A rename's destination is the path that exists now; the source is gone.
    const rest = raw.slice(3).replace(/^"|"$/g, '')
    const p = rest.includes(' -> ') ? rest.split(' -> ').pop() : rest
    if (code === '??') {
      if (noisy(p)) { noise++; continue }
      if (main) { skippedUntracked++; continue }
      untracked++
      paths.push(p)
      continue
    }
    tracked++
    paths.push(p)
  }
  return { tracked, untracked, noise, skippedUntracked, substantive: tracked + untracked, paths }
}

/** Every worktree of a repository, the main one first and marked as such. */
export function readWorktrees(root, { git = gitRead } = {}) {
  const out = []
  const listing = git(root, ['worktree', 'list', '--porcelain'])
  if (listing === null) return out
  let current = null
  for (const line of String(listing).split('\n')) {
    if (line.startsWith('worktree ')) {
      current = { path: line.slice('worktree '.length).trim(), branch: null, main: out.length === 0 }
      out.push(current)
    } else if (line.startsWith('branch ') && current) {
      current.branch = line.slice('branch '.length).trim().replace(/^refs\/heads\//, '')
    } else if (line.startsWith('detached') && current) {
      current.branch = null
    }
  }
  return out
}

/**
 * One worktree's dirt and its age.
 *
 * The age is the newest mtime among the paths that count, never the worktree
 * directory's own and never the git index's: `git status` itself refreshes the index,
 * so an index mtime would make every reader look like a writer — including this one.
 */
export function worktreeReading(repo, wt, { git = gitRead, stat = statMtime } = {}) {
  const base = { repo, path: wt.path, branch: wt.branch, main: !!wt.main,
                 tracked: 0, untracked: 0, noise: 0, skippedUntracked: 0, newestMs: 0, read: false }
  const porcelain = git(wt.path, ['status', '--porcelain'])
  if (porcelain === null) return { ...base, error: 'its working tree could not be read' }
  const s = classifyStatus(porcelain, { main: wt.main })
  let newestMs = 0
  for (const p of s.paths) {
    const m = stat(join(wt.path, p))
    if (m && m > newestMs) newestMs = m
  }
  return { ...base, read: true, tracked: s.tracked, untracked: s.untracked, noise: s.noise,
           skippedUntracked: s.skippedUntracked, newestMs, error: null }
}

/**
 * The live sessions that could plausibly be holding a worktree right now.
 *
 * Worker-tagged and still busy. A standing session (prime, the Navigator, the
 * admiral) is never a claimant by role — the Navigator authors the plan and never
 * touches the work — and prime has been running since before every worktree on this
 * machine, so counting it would suppress every finding there is. An `idle` worker is
 * not one either: a finished session lingers in the ledger for hours after it stopped
 * producing anything.
 *
 * Null, never `[]`, when the ledger could not be read. An unreadable ledger is not an
 * empty fleet, and treating it as one turns every dirty worktree into an orphan.
 */
export function claimants(rows, jobs = []) {
  if (rows === null || rows === undefined) return null
  const byId = new Map((jobs || []).map((j) => [j.id, j]))
  const out = []
  for (const r of rows) {
    const name = String(r?.name ?? '')
    if (!name.includes(WORKER_TAG)) continue
    if (String(r?.status ?? '') !== 'busy') continue
    const job = byId.get(r.id)
    const fromJob = job?.createdAt ? Date.parse(job.createdAt) : NaN
    const startedMs = Number.isFinite(fromJob) ? fromJob : Number(r?.startedAt)
    if (!Number.isFinite(startedMs)) continue
    out.push({ id: r.id, name, wid: name.match(/W\d{4}(?:\.\d+)?/)?.[0] ?? null, startedMs })
  }
  return out
}

/**
 * Age plus absence of an owner — the verdict on one worktree.
 *
 * Never dirtiness. Six worktrees were dirty when this was written and the correct
 * answer for most of them was silence.
 */
export function classifyWorktree(reading, { claimants: live, now = Date.now(), graceMin = HELD_GRACE_MIN } = {}) {
  const label = `${shortRepo(reading.repo)} \`${reading.branch ?? 'detached'}\``
  const base = { ...reading, label, ageMs: null, ageText: 'unknown', alarm: false }
  if (!reading.read) {
    return { ...base, kind: 'unread', why: reading.error || 'its working tree could not be read' }
  }
  const substantive = (reading.tracked ?? 0) + (reading.untracked ?? 0)
  if (substantive === 0) return { ...base, kind: 'clean', why: 'nothing uncommitted' }
  const ageMs = Math.max(0, now - (reading.newestMs || 0))
  const withAge = { ...base, ageMs, ageText: ageText(ageMs) }
  const what = `${reading.tracked} tracked change${reading.tracked === 1 ? '' : 's'}, ${reading.untracked} untracked path${reading.untracked === 1 ? '' : 's'}`
  if (ageMs < graceMin * MIN) {
    return { ...withAge, kind: 'active', why: `written ${ageText(ageMs)} ago — a worker at work` }
  }
  if (live === null) {
    return { ...withAge, kind: 'unjudged',
             why: `${what}, untouched for ${ageText(ageMs)} — the live fleet could not be read, so whether anyone still holds this is unknown` }
  }
  const holder = live.find((c) => c.startedMs <= reading.newestMs)
  if (holder) {
    return { ...withAge, kind: 'held',
             why: `${what}, untouched for ${ageText(ageMs)} — ${holder.wid ?? holder.id} has been running since before it was last written and may still hold it` }
  }
  return { ...withAge, kind: 'stranded', alarm: true,
           why: `${what}, untouched for ${ageText(ageMs)}, and no live worker was running when it was last written` }
}

/**
 * Branches on the repo's own remote that nobody ever proposed and nothing ever merged.
 *
 * Not a rule that every branch must become a pull request — that is explicitly what
 * this is not. It is the state `org-chart-237` was in: built, revised, pushed, and
 * then simply never delivered, with the requirement above it correctly still open and
 * the page it was for returning 404.
 */
export function unproposedBranches(rows = [], { now = Date.now(), days = UNPROPOSED_DAYS } = {}) {
  const findings = []
  let excluded = 0
  let roles = 0
  let unread = 0
  let tooYoung = 0
  let settled = 0
  for (const r of rows) {
    // A branch holding a role in policy.json is delivered by merges INTO it and is
    // never the head of a pull request, so "no pull request was ever opened" is true
    // of `main`, `stable` and `site` permanently and says nothing about anybody. The
    // first live run reported five of them and one real branch, which is the ratio
    // that gets a section skipped.
    if (r.role) { roles++; continue }
    // An unread pull-request listing is not an exclusion. Counting it as one put it in
    // the same sentence as `gh-pages` — "excluded as machine-written" — which says a
    // branch was skipped because it is machine-written when the truth is that nobody
    // could tell whether it had a pull request. That is the house failure mode with a
    // different label on it.
    if (r.unread) { unread++; continue }
    if (r.excluded || PUBLISH_BRANCHES.includes(r.branch)) { excluded++; continue }
    if (r.hasPR || r.merged) { settled++; continue }
    const age = now - (r.lastCommitMs || 0)
    if (age < days * DAY) { tooYoung++; continue }
    findings.push({
      ...r,
      ageMs: age,
      line: `${shortRepo(r.repo)} \`${r.branch}\` — last commit ${ageText(age)} ago, no pull request was ever opened and it is not merged into the integration branch`,
    })
  }
  findings.sort((a, b) => b.ageMs - a.ageMs)
  return { findings, excluded, roles, unread, tooYoung, settled }
}

/** One git command against a checkout, or null. Never throws — a reading that fails is
 *  a value, because a broken checkout must not be able to kill the sweep. */
export function gitRead(root, args, { timeout = 10000 } = {}) {
  try {
    return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch { return null }
}

const statMtime = (p) => { try { return statSync(p).mtimeMs } catch { return 0 } }

/**
 * The remote whose URL actually names the repository, never whichever one is called
 * `origin`.
 *
 * Two of the seven would otherwise have been measured against the wrong repository.
 * `gsm.safety`'s `origin` is `obot-claw/gsm.safety` — the org archived read-only on
 * 2026-07-02 — and its jwildfire remote is called `jwildfire`. `open.gismo`'s `origin`
 * is `Gilead-BioStats/open.gismo`, which is upstream and read-only here; measured
 * against it the clone reads seven commits ahead, which this would have reported as
 * unpushed work, and against its real remote it is zero ahead and six behind.
 */
export function resolveRemote(remotes = [], repo = '') {
  const want = String(repo).toLowerCase()
  for (const r of remotes) {
    const m = String(r.url ?? '').match(/[:/]([\w.-]+)\/([\w.-]+?)(?:\.git)?$/)
    if (m && `${m[1]}/${m[2]}`.toLowerCase() === want) return r.name
  }
  return null
}

/** The remotes a checkout has, as `{name, url}`. */
export function readRemotes(root, { git = gitRead } = {}) {
  const out = git(root, ['remote', '-v'])
  if (out === null) return []
  const seen = new Map()
  for (const line of out.split('\n')) {
    const m = line.match(/^(\S+)\s+(\S+)\s+\(fetch\)/)
    if (m && !seen.has(m[1])) seen.set(m[1], { name: m[1], url: m[2] })
  }
  return [...seen.values()]
}

/**
 * Where a clone stands against the repository it is supposed to be a clone of.
 *
 * Both directions matter and they are different failures. BEHIND means an agent
 * reading this checkout is reading a different repository from the one on GitHub —
 * `gsm.safety` was thirty-one commits behind. AHEAD means commits that were made here
 * and never reached GitHub, which is the most literal form of the property this whole
 * file is about.
 *
 * Nothing here fetches: the caller decides when the remote refs were last refreshed,
 * and every sentence says "as last fetched" for the reason selfupdate.mjs gives — a
 * number that is honest about its age beats a fresh one that costs the sweep its
 * cadence.
 */
export function clonePosition(root, { remote = 'origin', repo = '', branch = null, now = Date.now(), git = gitRead, fetchedText = '' } = {}) {
  const name = shortRepo(repo) || root
  const unknown = (why) => ({ repo, root, remote, branch, ahead: null, behind: null, read: false,
                              alarm: false, why, line: `${name} — its position could not be measured: ${why}` })
  if (!remote) {
    return unknown(`no remote in this checkout has a URL naming \`${repo}\`, so every position would be measured against a different repository`)
  }
  const head = branch || git(root, ['symbolic-ref', '--quiet', '--short', 'HEAD'])
  if (!head) return unknown('the checkout is detached or unreadable, so there is no branch to compare')
  const ref = `${remote}/${head}`
  const counts = git(root, ['rev-list', '--left-right', '--count', `HEAD...${ref}`])
  const [ahead, behind] = String(counts ?? '').trim().split(/\s+/).map(Number)
  if (!Number.isFinite(ahead) || !Number.isFinite(behind)) {
    return unknown(`\`${ref}\` is not present locally, so nothing could be counted against it`)
  }
  const unpushedTs = ahead > 0 ? Number(git(root, ['log', '-1', '--format=%ct', `${ref}..HEAD`])) : NaN
  const unpushedMs = Number.isFinite(unpushedTs) ? unpushedTs * 1000 : null
  const unpushedAge = unpushedMs === null ? null : Math.max(0, now - unpushedMs)
  const staleUnpushed = ahead > 0 && (unpushedAge === null || unpushedAge >= UNPUSHED_HOURS * HOUR)
  const farBehind = behind >= BEHIND_COMMITS
  const where = `\`${ref}\`${fetchedText ? ` ${fetchedText}` : ''}`
  let line
  if (staleUnpushed && farBehind) {
    line = `${name} — ${ahead} commit${ahead === 1 ? '' : 's'} that never reached GitHub (newest ${ageText(unpushedAge)} old) and ${behind} behind ${where}`
  } else if (staleUnpushed) {
    line = `${name} — ${ahead} local commit${ahead === 1 ? '' : 's'} that never reached GitHub, the newest ${ageText(unpushedAge)} old, against ${where}`
  } else if (farBehind) {
    line = `${name} — ${behind} commits behind ${where}; an agent reading this checkout is reading a different repository from the one on GitHub`
  } else if (behind > 0 || ahead > 0) {
    line = `${name} — ${ahead} ahead, ${behind} behind ${where}`
  } else {
    line = `${name} — level with ${where}`
  }
  return { repo, root, remote, branch: head, ahead, behind, read: true, unpushedMs,
           alarm: staleUnpushed || farBehind, why: null, line }
}

/**
 * The section, as the state file carries it and the Navigator panel renders it.
 *
 * Reported even when clean. A detector that only ever speaks up on failure is
 * indistinguishable from a dead one, which is why every other section in this file
 * prints its verdict either way.
 *
 * Active and clean worktrees get no row. There are forty-nine worktrees on this
 * machine and listing them all every five minutes would bury the file; what they are
 * worth is a count in the headline, which is where they are.
 */
export function localSection(found = {}, now = Date.now()) {
  const worktrees = found.worktrees ?? []
  const branches = found.branches ?? { findings: [], excluded: 0, tooYoung: 0 }
  const clones = found.clones ?? []
  const live = found.claimants ?? null
  const verdicts = worktrees.map((w) => (w.kind ? w : classifyWorktree(w, { claimants: live, now })))

  const stranded = verdicts.filter((v) => v.kind === 'stranded')
  const held = verdicts.filter((v) => v.kind === 'held')
  const unjudged = verdicts.filter((v) => v.kind === 'unjudged')
  const unread = verdicts.filter((v) => v.kind === 'unread')
  const active = verdicts.filter((v) => v.kind === 'active')
  const cloneAlarms = clones.filter((c) => c.alarm)
  const cloneUnread = clones.filter((c) => c.read === false)
  const findings = stranded.length + branches.findings.length + cloneAlarms.length

  const fetchedMs = found.fetchedAt ? Date.parse(found.fetchedAt) : NaN
  const fetchAge = Number.isFinite(fetchedMs) ? ageText(Math.max(0, now - fetchedMs)) : null

  const lines = ['## Local-only work — what exists on this machine and not on GitHub', '']

  // The broken reading goes first and on its own, because everything under it is a
  // partial view and a partial view presented as a verdict is the failure one door
  // down from the one this file is about.
  const fetchFailed = found.fetchFailed ?? []
  if (live === null || unread.length || cloneUnread.length || !fetchAge || fetchFailed.length || branches.unread) {
    const why = []
    if (live === null) why.push('the live agent ledger could not be read, so no worktree here can be called ownerless — an unreadable fleet is not an empty one')
    if (unread.length) why.push(`${unread.length} working tree(s) could not be read`)
    if (cloneUnread.length) why.push(`${cloneUnread.length} checkout position(s) could not be measured`)
    if (!fetchAge) why.push('no fetch has ever completed on this machine, so every position below is unmeasured rather than current')
    if (fetchFailed.length) why.push(`the fetch failed for ${fetchFailed.join(', ')}, so those positions are older than the stamp above them says`)
    if (branches.unread) why.push(`${branches.unread} branch(es) could not be checked for a pull request, and are counted as proposed rather than as findings`)
    lines.push(`${ALARM_BROKEN} — ${why.join('; ')}. Nothing below is a clean bill of health.`)
  }

  lines.push(findings > 0
    ? `${ALARM_FINDING} — ${findings} piece(s) of work exist on this machine that no GitHub-derived check can see: ${stranded.length} stranded worktree(s), ${branches.findings.length} unproposed branch(es), ${cloneAlarms.length} checkout(s) out of step with their remote.`
    : `local-only work: clean — ${verdicts.length} worktrees and ${clones.length} checkouts read, nothing stranded${fetchAge ? `, positions as last fetched ${fetchAge} ago` : ''}`)

  // Every exclusion prints its count. A truncated list that does not say so reads as
  // full coverage, and a suppression nobody can see is indistinguishable from a check
  // that found nothing.
  const notes = []
  if (active.length) notes.push(`${active.length} dirty worktree(s) written to within ${HELD_GRACE_MIN}m — workers at work, not findings`)
  if (held.length) notes.push(`${held.length} stale worktree(s) a live worker predates, listed below without an alarm`)
  if (branches.roles) notes.push(`${branches.roles} branch(es) skipped as role branches from policy.json — a release lane is merged into, never proposed from`)
  if (branches.excluded) notes.push(`${branches.excluded} branch(es) excluded as machine-written — the publish branches (${PUBLISH_BRANCHES.join(', ')}) and dependabot pushes`)
  if (branches.tooYoung) notes.push(`${branches.tooYoung} branch(es) younger than ${UNPROPOSED_DAYS}d, where a pull request is usually the next command`)
  if (fetchAge) notes.push(`remotes last fetched ${fetchAge} ago, refreshed at most every ${FETCH_TTL_MIN}m — every position above is as last fetched, never live`)
  for (const n of notes) lines.push(`  ${n}`)

  const group = (title, rows) => {
    if (!rows.length) return
    lines.push('', `### ${title} (${rows.length})`, '')
    for (const r of rows) lines.push(`- ${r.line ?? `${r.label} — ${r.why}`}${r.path ? ` · \`${r.path}\`` : ''}`)
  }
  group('Worktrees holding work nobody can see', stranded)
  group('Worktrees a live worker may still hold', held)
  group('Worktrees whose owner could not be established', unjudged)
  group('Worktrees that could not be read', unread)
  group('Branches nobody ever proposed', branches.findings)
  group('Checkouts out of step with their remote', cloneAlarms)
  return lines.join('\n') + '\n'
}

// ---- the machine-facing half (not unit-tested; exercised live) ----------------

/**
 * Fetch, but only when the numbers have gone stale enough to be worth the wall clock.
 *
 * DELIBERATELY NOT EVERY RUN. Fetching six repos measured 3.6s warm on 2026-08-18 and
 * is unbounded on a bad connection; spending that every five minutes buys a number
 * that moves by two or three commits an hour, and the sweep's cadence is what makes
 * every other thing in it useful. This is the call selfupdate.mjs already made for the
 * checkout position, and the language it chose — "as last fetched" — is on every line
 * here for the same reason: a number honest about its age beats a fresh one that costs
 * the sweep its cadence.
 *
 * `obot.agent` is exempt from the whole question: the self-update fetches it every run
 * already, so its position is never more than five minutes old.
 *
 * Never prunes. A prune is a delete, and this file does not delete.
 */
export function fetchIfDue(targets, { cacheFile, ttlMin = FETCH_TTL_MIN, now = Date.now(), git = gitRead, read = readFileSync, write = writeFileSync } = {}) {
  let cache = {}
  try { cache = JSON.parse(read(cacheFile, 'utf8')) } catch { /* first run */ }
  const lastMs = cache.fetchedAt ? Date.parse(cache.fetchedAt) : NaN
  if (Number.isFinite(lastMs) && now - lastMs < ttlMin * MIN) {
    return { fetched: false, fetchedAt: cache.fetchedAt, failed: cache.failed ?? [] }
  }
  const failed = []
  for (const { root, remote } of targets) {
    if (!remote) continue
    if (git(root, ['fetch', '--quiet', remote], { timeout: 45000 }) === null) failed.push(shortRepo(root))
  }
  const fetchedAt = new Date(now).toISOString()
  try {
    mkdirSync(dirname(cacheFile), { recursive: true })
    write(cacheFile, JSON.stringify({ fetchedAt, failed }, null, 2))
  } catch { /* a cache that cannot be written costs freshness, never the sweep */ }
  return { fetched: true, fetchedAt, failed }
}

/** The live fleet, or null. `claude agents --json` is the authority on who is running. */
export function readAgents() {
  try {
    const rows = JSON.parse(execFileSync('claude', ['agents', '--json'], { encoding: 'utf8', timeout: 20000 }))
    return Array.isArray(rows) ? rows : null
  } catch { return null }
}

/** Job records, for the one field the agent ledger cannot answer: when a session began. */
export function readJobRecords(dir) {
  const out = []
  let names = []
  try { names = readdirSync(dir) } catch { return out }
  for (const id of names) {
    try {
      const s = JSON.parse(readFileSync(join(dir, id, 'state.json'), 'utf8'))
      out.push({ id, createdAt: s.createdAt ?? null })
    } catch { /* a job record that cannot be read is one fewer start time, not a failure */ }
  }
  return out
}

/**
 * One whole reading of this machine, for the sweep to render.
 *
 * `repos` is what `discoverRepos` already produced from policy.json, so a repo added
 * there is swept here on the next run with no code change.
 */
export function collectLocal({ repos = [], ws, cacheFile, jobsDir, now = Date.now(), git = gitRead } = {}) {
  const roots = repos
    .map((r) => ({
      repo: r.repo,
      integration: r.integration,
      // The role model straight out of policy.json, so a repo whose branches are named
      // something else needs no special case here either.
      roles: new Set([r.integration, ...(r.release || [])].filter(Boolean)),
      root: join(ws, shortRepo(r.repo)),
    }))
    .filter((r) => existsSync(join(r.root, '.git')))
  for (const r of roots) r.remote = resolveRemote(readRemotes(r.root, { git }), r.repo)

  const fetch = fetchIfDue(roots.filter((r) => shortRepo(r.repo) !== 'obot.agent'), { cacheFile, now, git })
  const fetchAge = fetch.fetchedAt ? `as last fetched ${ageText(Math.max(0, now - Date.parse(fetch.fetchedAt)))} ago` : 'never fetched'

  const live = claimants(readAgents(), readJobRecords(jobsDir))

  const worktrees = []
  const branchRows = []
  const clones = []
  for (const r of roots) {
    for (const wt of readWorktrees(r.root, { git })) {
      worktrees.push(classifyWorktree(worktreeReading(r.repo, wt, { git }), { claimants: live, now }))
    }
    clones.push(clonePosition(r.root, { remote: r.remote, repo: r.repo, now, git, fetchedText: fetchAge }))
    if (!r.remote) continue
    const refs = git(r.root, ['for-each-ref', '--format=%(refname:short)%09%(committerdate:unix)', `refs/remotes/${r.remote}`]) ?? ''
    for (const line of refs.split('\n')) {
      const [ref, ts] = line.split('\t')
      if (!ref) continue
      const branch = ref.slice(r.remote.length + 1)
      if (!branch || branch === 'HEAD') continue
      branchRows.push({
        repo: r.repo, branch, ref, root: r.root, remote: r.remote, integration: r.integration,
        lastCommitMs: Number(ts) * 1000,
        role: r.roles.has(branch) ? true : null,
        excluded: branch.startsWith('dependabot/') ? 'dependabot' : null,
        merged: false,
        hasPR: false,
      })
    }
  }

  // The same rule the network call follows, applied one step earlier and for the same
  // reason. There are 130-odd remote branches across the seven repos and a `merge-base`
  // is a process each; asking it about a role branch, a dependabot push or a branch
  // pushed an hour ago spends the wall clock on a verdict that was already settled.
  for (const b of branchRows) {
    if (b.role || b.excluded) continue
    if (now - (b.lastCommitMs || 0) < UNPROPOSED_DAYS * DAY) continue
    b.merged = git(b.root, ['merge-base', '--is-ancestor', b.ref, `${b.remote}/${b.integration}`]) !== null
  }

  // GitHub is asked LAST, and only about the repos where the answer can still change
  // one. Everything a role, a publish branch, a dependabot push, a merge or the age bar
  // settles is settled from local refs alone — which on this machine leaves one repo of
  // the seven to list, and turns a flat 4s of `gh` on every five-minute run into well
  // under one. It is also the honest order: a call whose result cannot change a verdict
  // is a call that should not be made.
  const needHeads = new Set(branchRows.filter((b) => needsGitHub(b, now)).map((b) => b.repo))
  for (const repo of needHeads) {
    const heads = prHeads(repo)
    for (const b of branchRows) {
      if (b.repo !== repo) continue
      // A repo whose pull requests could not be listed must not turn every branch into
      // a finding, so an unread listing counts its branches as proposed and says so.
      if (heads === null) b.unread = 'pull requests could not be listed'
      else b.hasPR = heads.has(b.branch)
    }
  }
  return {
    worktrees,
    branches: unproposedBranches(branchRows, { now }),
    clones,
    claimants: live,
    fetchedAt: fetch.fetchedAt,
    // The failures travel with the freshness. Without this the header said "last
    // fetched 0m ago" over a repo whose fetch had just failed, and its position was
    // hours old behind a number that looked current.
    fetchFailed: fetch.failed ?? [],
  }
}

/** Could a pull-request listing still change this branch's verdict? Local refs settle
 *  the rest, so this is the whole justification for making a network call. */
function needsGitHub(b, now, days = UNPROPOSED_DAYS) {
  if (b.role || b.excluded || b.merged) return false
  return now - (b.lastCommitMs || 0) >= days * DAY
}

/** Every head branch a repo has ever had a pull request for, or null when unreadable. */
function prHeads(repo) {
  try {
    const rows = JSON.parse(execFileSync('gh', ['pr', 'list', '-R', repo, '--state', 'all', '--limit', '400', '--json', 'headRefName'],
      { encoding: 'utf8', timeout: 30000 }))
    return new Set(rows.map((r) => r.headRefName))
  } catch { return null }
}
