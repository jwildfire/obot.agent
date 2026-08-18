// The daily brief — one paragraph, one line per item (obot.agent#252, under
// jwildfire/obot.roadmap#238).
//
// @jwildfire specified the shape on 18 August and it is the whole specification:
//
//   "I want the text version SHORT one paragraph about progress and a bulleted
//    overview of my todo list (1 line per bulleted)."
//
// This is not a new instruction. It is the same one he has been giving for three
// days — the pages that read like audit logs, the inline bold, the editorial
// codas — arriving as a format rather than as a complaint, which is what makes it
// checkable. One paragraph and one line per item are countable, so `violations()`
// counts them and the fold refuses to write a brief that fails its own check.
//
// THE HARD PART IS DELETION. Everything the fold already produces earns its line
// against "does he need this today", and for most of it the answer is no: the
// thirty-three squash subjects, the per-repo grouping, the carried-from marks,
// the session-report link, the meta line, the footer. Those stay in the diary,
// which is the archive and the keynote's raw material, and in the issue each one
// belongs to, where they already are.
//
// What it never carries: config item text. That list is local-only by design —
// the hub's deploy greps the assembled site for its sentinel — and the brief is
// the fold output most likely to leave the machine. The count is the entire
// permitted payload, and the parameter takes a number so that nothing else can be
// passed by accident.
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'

export const BRIEF_REL = '.claude/fold/brief.md'

// Bounds, enforced by construction rather than by intention. The openclaw daily
// summaries grew 136 -> 865 words against a six-section template whose slots had
// to be filled every night whatever had happened.
export const MAX_PARAGRAPH_WORDS = 60
export const MAX_BULLET_WORDS = 20
export const BULLET_BUDGET = 10

// The title clause inside the paragraph, capped before the paragraph is, so the
// sentence that gets shortened is the one carrying the least.
const TITLE_WORDS = 12

const QUEUE_URL = 'https://jwildfire.github.io/obot.roadmap/roadmap.html'

/**
 * The brief.
 *
 * `configOpen` is a COUNT. Anything that is not a finite number is dropped
 * rather than rendered, because the only way item text could reach this string
 * is if something handed it in place of the number.
 */
export function composeBrief({
  landed = [], landedUnknown = false, rcs = [], decisions = [], todos = [],
  configOpen = null, configCritical = [],
} = {}) {
  const bullets = queue({ rcs, decisions, todos, configOpen, configCritical })
  const text = paragraph({ landed, landedUnknown, rcs, decisions })
  return bullets.length ? `${text}\n\n${bullets.join('\n')}\n` : `${text}\n`
}

/**
 * One paragraph about progress: what landed, and what that leaves waiting.
 *
 * Composed mechanically — no model runs on a clock (D0019, answer "not yet") —
 * from counts and one title. It never summarises, because a composer that
 * summarises is one that can grow.
 */
function paragraph({ landed, landedUnknown, rcs, decisions }) {
  const repos = [...new Set(landed.map((l) => l.repo))]
  const n = landed.length
  const where = repos.length === 0 ? ''
    : repos.length === 1 ? ` in ${repos[0]}`
    : repos.length === 2 ? ` across ${repos[0]} and ${repos[1]}`
    : ` across ${repos.length} repos`

  const recent = landed[0]?.title ? `, most recently: ${lower(cap(landed[0].title, TITLE_WORDS))}` : ''
  // A scan that failed is never reported as a quiet night, in either direction:
  // with nothing readable the sentence says so, and with a partial answer the
  // number is stated as the floor it is. The Navigator's sweep once reported
  // "seven repos, two release candidates, workers clean" with all seven queries
  // failed, and that is the shape this line would otherwise take.
  const floor = landedUnknown ? 'at least ' : ''
  const progress = n
    ? `Overnight ${floor}${n} change${n === 1 ? '' : 's'} landed${where}${recent}.`
    : landedUnknown ? 'What landed overnight could not be read on this run.'
    : 'Nothing landed overnight.'

  const waiting = []
  if (rcs.length) waiting.push(`${rcs.length} release candidate${rcs.length === 1 ? '' : 's'}`)
  if (decisions.length) waiting.push(`${decisions.length} decision${decisions.length === 1 ? '' : 's'}`)
  const ask = waiting.length
    ? `${sentenceCase(waiting.join(' and '))} ${waiting.length === 1 && rcs.length === 1 ? 'is' : 'are'} waiting on you.`
    : 'Nothing is waiting on you.'

  const both = `${progress} ${ask}`
  if (visibleWords(both) <= MAX_PARAGRAPH_WORDS) return both
  // Drop the clause that carries the least before shortening anything that
  // carries an ask.
  const shorter = `${n ? `Overnight ${n} change${n === 1 ? '' : 's'} landed${where}.` : progress} ${ask}`
  return visibleWords(shorter) <= MAX_PARAGRAPH_WORDS ? shorter : cap(shorter, MAX_PARAGRAPH_WORDS)
}

/**
 * His queue, in the order he set on 2026-08-15: "RCs first. then decisions, then
 * config items."
 *
 * The headline classes are never cut — if they alone exceed the budget that is a
 * real fact about his morning, and hiding one to hold a line count would be the
 * page lying to keep its shape. Everything else yields, and whatever does not fit
 * is counted on one line rather than dropped in silence.
 */
function queue({ rcs, decisions, todos, configOpen, configCritical = [] }) {
  const out = []
  for (const r of rcs) out.push(bullet('Review', r.title ?? short(r.key), r.url))
  for (const d of decisions) out.push(bullet('Answer', `${d.key ? `${d.key}: ` : ''}${d.title}`, d.url))

  const config = Number.isFinite(configOpen) && configOpen > 0 ? configOpen : null
  const reserved = config ? 1 : 0
  const room = Math.max(0, BULLET_BUDGET - out.length - reserved)

  const shown = todos.slice(0, Math.max(0, room - (todos.length > room ? 1 : 0)))
  for (const t of shown) out.push(bullet(null, t.title, t.url ?? null))
  const remainder = todos.length - shown.length
  if (remainder > 0) out.push(bullet(null, `${remainder} more waiting on the queue`, QUEUE_URL))

  if (config) out.push(bullet('Apply', configText(config, configCritical), QUEUE_URL))
  return out
}

/**
 * The config line: critical items by ID, everything else as a count.
 *
 * Criticality is earned rather than asserted — a blocking reference something
 * else confirmed open — and budgeted at three, so this is a bounded set and not
 * a second list. An id carries no item text, which is why it may be named at all:
 * the list itself is local-only and the hub's deploy greps the assembled site for
 * its sentinel. Anything that is not exactly `cNNNN` is DROPPED rather than
 * repaired, so item text cannot reach this string by being passed in the wrong
 * parameter.
 *
 * The reason the ids matter: c0017 is the item gating the fold's own schedule,
 * and a brief that could not name it is a brief that cannot tell him why it is
 * being written by hand.
 */
function configText(open, critical) {
  const ids = [...new Set((critical ?? []).filter((c) => typeof c === 'string' && CONFIG_ID.test(c.trim())).map((c) => c.trim().toLowerCase()))]
  if (!ids.length) return `${open} config item${open === 1 ? '' : 's'} on your keyboard`
  const others = Math.max(0, open - ids.length)
  const rest = others ? ` and ${others} other${others === 1 ? '' : 's'}` : ''
  return `${ids.length} critical config item${ids.length === 1 ? '' : 's'} (${ids.join(', ')})${rest}`
}

const CONFIG_ID = /^c\d{4}$/i

// The verb at the front, the thing in plain words, the link at the end. A line
// that wraps on his phone is still one line, so the bound is on words and never
// on characters.
function bullet(verb, text, url) {
  const lead = verb ? `${verb} ` : ''
  const body = cap(String(text), MAX_BULLET_WORDS - words(lead))
  return `- ${lead}${url ? `[${body}](${url})` : body}`
}

/** Words a reader sees: link text counts, the URL behind it does not. */
export function visibleWords(line) {
  return words(String(line).replace(/^-\s+/, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1'))
}

const words = (s) => String(s).trim().split(/\s+/).filter(Boolean).length

// Elision is visible. A line silently shortened reads as a complete one.
function cap(text, n) {
  const parts = String(text).trim().split(/\s+/).filter(Boolean)
  if (parts.length <= n) return parts.join(' ')
  return `${parts.slice(0, Math.max(1, n - 1)).join(' ').replace(/[.,;:]$/, '')}…`
}

const lower = (s) => (/^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s)
const sentenceCase = (s) => s.charAt(0).toUpperCase() + s.slice(1)
const short = (key) => String(key).replace(/^jwildfire\//, '')

/**
 * Every way the shape can be wrong, as a list of what is wrong.
 *
 * The fold calls this before writing, so a brief that has grown a second
 * paragraph is refused rather than published. The test calls it on injected
 * malformations, because a checker nobody has seen fail is indistinguishable
 * from one that passes everything.
 */
export function violations(brief) {
  if (typeof brief !== 'string' || !brief.trim()) return ['the brief is empty']
  const v = []
  if (!brief.endsWith('\n')) v.push('the brief does not end with a newline')
  if (/\n\s*\n$/.test(brief)) v.push('the brief ends with a blank line')
  if (brief.includes('**')) v.push('inline bold: important things get their own line, not emphasis inside one')
  if (brief.includes('```')) v.push('a fenced block has no place in a brief')

  const all = brief.replace(/\n$/, '').split('\n')
  const head = all[0] ?? ''
  if (!head.trim()) v.push('the paragraph is missing')
  if (/^[-*+]\s/.test(head)) v.push('the brief opens with a bullet: the paragraph comes first')
  if (/^#/.test(head)) v.push('a heading where the paragraph should be')
  if (visibleWords(head) > MAX_PARAGRAPH_WORDS) {
    v.push(`the paragraph runs to ${visibleWords(head)} words, over the ${MAX_PARAGRAPH_WORDS}-word bound`)
  }

  if (all.length === 1) return v // a paragraph and an empty queue is a whole brief
  if (all[1] !== '') v.push('the paragraph and the list are not separated by exactly one blank line')

  for (let i = 2; i < all.length; i++) {
    const l = all[i]
    if (!/^- \S/.test(l)) {
      // One message, named by what it actually is, because "malformed" tells
      // whoever reads the run log nothing about which rule they broke.
      v.push(l.trim() === '' ? `line ${i + 1} is blank: the list is one unbroken block`
        : /^\s+/.test(l) ? `line ${i + 1} is indented: a sub-bullet and a continuation are not one line`
        : /^#/.test(l) ? `line ${i + 1} is a heading: the brief has none`
        : `line ${i + 1} is not a bullet: ${JSON.stringify(l.slice(0, 40))}`)
      continue
    }
    if (visibleWords(l) > MAX_BULLET_WORDS) {
      v.push(`line ${i + 1} runs to ${visibleWords(l)} words, over the ${MAX_BULLET_WORDS}-word bound`)
    }
  }
  return v
}

/**
 * Write the brief, or refuse to.
 *
 * A brief that fails its own shape check is not written and says why. Writing it
 * anyway would put the growth back exactly where the check was meant to stop it,
 * and the check would report success while having no effect.
 */
export function writeBrief(workspace, text) {
  const bad = violations(text)
  if (bad.length) return { written: false, file: null, violations: bad }
  const file = join(workspace, BRIEF_REL)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, text)
  return { written: true, file, violations: [] }
}

export function readBrief(workspace) {
  try {
    return readFileSync(join(workspace, BRIEF_REL), 'utf8')
  } catch {
    return null
  }
}
