#!/usr/bin/env node
// The bot's own commit identity — resolved from here, never typed
// (obot.agent#241, jwildfire/obot.roadmap#260).
//
// WHY A MODULE AND NOT A DOCUMENTED CONSTANT. skills/obot-identity/SKILL.md has
// carried the correct id since 2026-07-11, next to the sentence "user ID 299836032 is
// fixed — look-up not needed". Counting every commit in the seven active checkouts on
// 2026-08-18 found THIRTY-EIGHT distinct wrong ids across 301 commits anyway, most used
// a handful of times each, one of them reading 223456789. Twenty-six of the thirty-
// eight are allocated GitHub accounts. That is not a stale constant propagating; it is
// a nine-digit number recalled from memory once per session and coming out plausible.
// Writing it down more emphatically has already been tried.
//
// WHAT A WRONG ID ACTUALLY COSTS, verified rather than assumed. GitHub matches the
// whole noreply address, not the numeric prefix, so a commit carrying a stranger's id
// links to nobody: /repos/jwildfire/demo-301/commits/9b152280 returns `author: null`
// while /commits/86ab1670 on the canonical address returns `obotclaw[bot]`. Nothing was
// ever credited to a real person. The failure is 301 unattributable commits — invisible
// in `git log` and in the GitHub UI, because a wrong id still renders the right name.
//
// THE ENVIRONMENT IS THE LEVER. GIT_AUTHOR_* / GIT_COMMITTER_* outrank every config
// level — proven against real git in the test, including against `-c user.email=` on
// the same command line. That is what lets an agent commit correctly in a checkout
// whose config is @jwildfire's, without repo-local config that would put the bot's name
// on HIS commits — the same defect pointing the other way, and worse, because it puts
// words in his mouth rather than taking credit for his.
import { execFileSync } from 'node:child_process'

export const BOT_LOGIN = 'obotclaw[bot]'

/** The App's user id, from /users/obotclaw[bot] on 2026-08-18. */
export const BOT_USER_ID = 299836032

/** The canonical author address. Composed, so the id and the address cannot disagree. */
export const BOT_EMAIL = `${BOT_USER_ID}+${BOT_LOGIN}@users.noreply.github.com`

// The legacy id-less noreply form. It links to the bot too — verified live on hub
// commit 072739b8 — and 101 commits already use it. It is recorded here because it is
// the one spelling of the bot's address with no number in it to get wrong, which makes
// it the right thing to reach for when this module is out of reach. It is not the
// default: the canonical form is what GitHub itself issues.
export const BOT_EMAIL_LEGACY = `${BOT_LOGIN}@users.noreply.github.com`

const NOREPLY = /^(?:(\d+)\+)?(.+)@users\.noreply\.github\.com$/

// How many example commits one repo prints. The first live run found 123 findings in a
// fourteen-day window, which printed in full would bury every other section of a file
// rewritten every five minutes. The count is never dropped — what is not shown says so
// (the same rule as checks.mjs SHOW_PER_GROUP).
const SHOW_PER_REPO = 5

/**
 * What an author address is, as far as attribution goes.
 * `canonical` and `legacy` link to the bot on GitHub; `wrong-id` renders the bot's name
 * and links to nothing; `not-bot` is everyone else, @jwildfire included.
 */
export function classifyEmail(email) {
  const m = NOREPLY.exec(String(email ?? ''))
  if (!m || m[2] !== BOT_LOGIN) return { kind: 'not-bot', id: null, login: null }
  const id = m[1] ?? null
  if (id === null) return { kind: 'legacy', id: null, login: BOT_LOGIN }
  return { kind: id === String(BOT_USER_ID) ? 'canonical' : 'wrong-id', id, login: BOT_LOGIN }
}

/** Whether a commit on this address resolves to the bot account on GitHub. */
export function linksToBot(email) {
  return ['canonical', 'legacy'].includes(classifyEmail(email).kind)
}

/**
 * The identity as environment, which is how an agent should commit: it beats the
 * checkout's own config, so it needs nothing set per repo and nothing set per worktree,
 * and it survives a fresh clone because there is nothing in the clone to survive.
 * Both halves are set — a commit's committer is recorded as durably as its author.
 */
export function identityEnv(env = {}) {
  return {
    ...env,
    GIT_AUTHOR_NAME: BOT_LOGIN,
    GIT_AUTHOR_EMAIL: BOT_EMAIL,
    GIT_COMMITTER_NAME: BOT_LOGIN,
    GIT_COMMITTER_EMAIL: BOT_EMAIL,
  }
}

/** The same identity as `-c` arguments, for a caller that already builds an argv. */
export function identityArgs() {
  return ['-c', `user.name=${BOT_LOGIN}`, '-c', `user.email=${BOT_EMAIL}`]
}

// The drafting models, as they appear in a Co-Authored-By trailer. Anthropic's address
// is the stable half; the model name changes with every release.
const AGENT_COAUTHOR = /noreply@anthropic\.com|\bClaude\b/i

/**
 * Whether a commit was made by an agent, judged only on trailers the agent lane writes.
 * This is what keeps the check from ever firing on @jwildfire's own work: he does not
 * write these lines. 110 commits authored as him carry one; 87 carry none, and those 87
 * are his.
 */
export function agentMarker({ coAuthors = '', worker = '' } = {}) {
  if (AGENT_COAUTHOR.test(coAuthors)) return 'co-authored'
  if (String(worker).trim()) return 'worker'
  return null
}

// Record and field separators, chosen because a commit subject can contain anything a
// person can type but cannot contain these.
const RECORD = '\x1e'
const FIELD = '\x1f'
// The subject goes LAST, and it is the only free-text field. A commit subject can
// contain anything a person can type, this separator included — and with the subject in
// the middle, one such byte shifts every field after it, landing a trailer in the wrong
// slot and reading a real agent commit as clean. Last, it can absorb whatever it holds.
const FIELDS = 7
const FORMAT = [
  '%h', '%ae', '%ce', '%cI',
  '%(trailers:key=Co-Authored-By,valueonly,separator=%x2C)',
  '%(trailers:key=Worker,valueonly,separator=%x2C)',
  '%s',
].join('%x1f')

/**
 * Read one checkout's commits inside a window. Throws when the directory is not a
 * repository — an unreadable checkout is unknown, not clean, and the caller renders the
 * difference (jwildfire/obot.roadmap#215).
 */
export function scanCommits(dir, { sinceDays = 14, run = defaultRun } = {}) {
  const out = run(dir, [
    'log', '--all', '--no-merges', `--since=${sinceDays}.days.ago`,
    `--pretty=format:${FORMAT}%x1e`,
  ])
  return out.split(RECORD).map((r) => r.replace(/^\n+/, '')).filter((r) => r.trim()).map((rec) => {
    const parts = rec.split(FIELD)
    // A record that did not parse is UNREADABLE, never clean. Defaulting the trailer
    // fields to '' would make agentMarker() return null and the commit would drop out
    // of the scan silently — a failed read wearing the shape of a healthy one, which is
    // this house's recurring defect and the same door 👯🤖 W0059 fell through on
    // obot.agent#245 the same night.
    if (parts.length < FIELDS) return { unreadable: true, raw: rec.slice(0, 80) }
    const [sha, email, committer, date, coAuthors, worker] = parts
    return {
      sha, email, committer, date, coAuthors, worker,
      subject: parts.slice(FIELDS - 1).join(FIELD),
    }
  })
}

function defaultRun(dir, args) {
  return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
}

/**
 * The finding: a commit an agent made whose author does not link to the bot. Both
 * directions count — his name on agent work, and a fabricated id that links to nothing.
 */
export function misattributed(commits) {
  const findings = []
  let merges = 0
  let unreadable = 0
  for (const c of commits) {
    if (c.unreadable) { unreadable++; continue }
    if (!agentMarker(c)) continue
    if (linksToBot(c.email)) continue
    // A squash commit GitHub authored when he merged. Nothing on this machine could
    // have set its author, so it is not a local mis-attribution — counted and reported
    // separately rather than blamed or silently dropped.
    if (c.committer === 'noreply@github.com') { merges++; continue }
    const { kind, id } = classifyEmail(c.email)
    findings.push({ ...c, why: kind === 'wrong-id' ? `wrong id ${id}` : 'authored as him' })
  }
  return { findings, merges, unreadable, scanned: commits.length }
}

// The shape of a repo's findings in one clause: how many wear his name, how many wear a
// fabricated id, and how many distinct fabrications are in play. The second number is a
// config or a hardcode; the first is a session that set no identity at all.
function tally(findings) {
  const his = findings.filter((f) => f.why === 'authored as him').length
  const ids = new Set(findings.filter((f) => f.why !== 'authored as him').map((f) => f.why))
  const parts = []
  if (his) parts.push(`${his} authored as him`)
  if (ids.size) parts.push(`${findings.length - his} on ${ids.size} wrong id${ids.size === 1 ? '' : 's'}`)
  return parts.join(', ')
}

/**
 * The sweep section. Reported even when clean, because a detector that only ever speaks
 * up on failure is indistinguishable from a dead one — and a checkout that could not be
 * read says so rather than joining the clean ones.
 *
 * The two headlines are spelled to match the dashboard's ALARM_RE, which admits only
 * `[A-Z0-9 ]` around one of GAP/FINDING/BREACHED/FAILED/DOWN/BROKEN. A hyphen or a
 * lowercase word inside the asterisks costs the match silently and the finding renders
 * as grey text — which is why the test asserts the headlines against that regex rather
 * than against a string (👯🤖 W0059, 2026-08-18).
 */
export function renderIdentity(reports, { stamp = '' } = {}) {
  const lines = [
    '## Commit identity — agent commits wearing the wrong name',
    '',
    `Canonical author: \`${BOT_LOGIN} <${BOT_EMAIL}>\`. A commit counts as an agent's when it carries a \`Co-Authored-By: Claude …\` or \`Worker:\` trailer, which @jwildfire does not write — so a finding here is never one of his own commits.`,
    '',
  ]
  if (!reports.length) {
    lines.push('**COMMIT IDENTITY READING BROKEN** — no checkout was scanned this sweep. The state of commit attribution is unknown, not clean.')
    return lines.join('\n') + '\n'
  }
  const broken = reports.filter((r) => r.error)
  const read = reports.filter((r) => !r.error)
  const hits = read.filter((r) => r.findings.length)

  if (!hits.length && read.length) {
    const n = read.reduce((t, r) => t + r.scanned, 0)
    lines.push(`**Commit identity: clean** across ${read.length} checkout${read.length === 1 ? '' : 's'} — ${n} commits read, every agent commit links to the bot. ${stamp}`.trim())
  }
  for (const r of hits) {
    const kinds = tally(r.findings)
    lines.push(`- **COMMIT IDENTITY FINDING** ${r.repo}: ${r.findings.length} of ${r.scanned} commits carry an agent trailer under an author that does not link to the bot — ${kinds} ${stamp}`.trim())
    for (const f of r.findings.slice(0, SHOW_PER_REPO)) {
      lines.push(`  - \`${f.sha}\` ${f.why} — "${f.subject}" ${(f.date || '').slice(0, 10)}`.trimEnd())
    }
    const hidden = r.findings.length - SHOW_PER_REPO
    if (hidden > 0) lines.push(`  - and ${hidden} more in this window, not shown here`)
  }
  const merges = read.reduce((t, r) => t + (r.merges || 0), 0)
  if (merges) lines.push('', `${merges} further commit${merges === 1 ? '' : 's'} carry an agent trailer under his name because GitHub authored them when he merged. Not a local mis-attribution, and not counted above.`)
  // A record the scan could not parse is not a clean commit. It gets the BROKEN
  // headline, because that is what it is: something went unread.
  const unreadable = read.reduce((t, r) => t + (r.unreadable || 0), 0)
  if (unreadable) lines.push('', `- **COMMIT IDENTITY READING BROKEN** ${unreadable} commit record${unreadable === 1 ? '' : 's'} could not be parsed and were not judged. Unknown, not clean.`)
  for (const r of broken) {
    lines.push(`- **COMMIT IDENTITY READING BROKEN** ${r.repo} — ${r.error}. This checkout was not scanned; that is unknown, not clean.`)
  }
  return lines.join('\n') + '\n'
}
