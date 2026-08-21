// What the gate reads, and the three ways these sources have lied before
// (jwildfire/obot.roadmap#238, task obot.agent#200).
//
// 1. navigator-state.md is a PROSE render with a readability cap. It shows 15
//    events while the snapshot behind it keeps 60, and truncates its lists with
//    "…and N more not shown here". Parsing it silently under-counts, so
//    everything here reads .claude/session-hub/cache/navigator-rc.json instead.
// 2. The sweep's "config ledger: 14 id(s) allocated" line is a ledger-integrity
//    audit — ids issued versus ids present — and not an open count. The open
//    count is 10. Shipping 14 as "the blockers count" would be wrong by four.
// 3. A wall-clock string is not an instant. An event's `at` is a bare local HH:MM
//    with no date and no zone, and this machine's own records already disagree
//    with themselves across the BST-to-EDT move. Every comparison here uses `ts`.
//
// The other rule, everywhere: a source that could not answer returns `unknown`,
// never an empty result. Failing quietly into "nothing happened" is how a fold
// reports a quiet night on a night nobody looked.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const DAILY = /^\d{4}-\d{2}-\d{2}\.md$/
const NOTES_REL = '.claude/session-notes'
const SNAPSHOT_REL = '.claude/session-hub/cache/navigator-rc.json'
const BLOCKERS_REL = '.claude/blockers.md'

// The sweep runs on a five-minute leash; its own state file sets the stale rule
// at three times the cadence. A snapshot older than that means the observer is
// dead, and a dead observer's silence is not evidence of a quiet night.
const STALE_MS = 15 * 60 * 1000

export function sweptEvents(workspace, sinceIso, { now = new Date() } = {}) {
  let snap
  try {
    snap = JSON.parse(readFileSync(join(workspace, SNAPSHOT_REL), 'utf8'))
  } catch {
    return { unknown: true, why: `no sweep snapshot at ${SNAPSHOT_REL}`, events: [] }
  }
  const sweptAge = now.getTime() - Date.parse(snap.sweptIso ?? 0)
  if (!(sweptAge < STALE_MS)) {
    return {
      unknown: true,
      why: `sweep snapshot is stale — swept ${snap.sweptIso}, ${Math.round(sweptAge / 60000)} min ago`,
      events: [],
    }
  }
  const since = sinceIso ? Date.parse(sinceIso) : 0
  const events = (snap.events ?? []).filter((e) => e.ts && Date.parse(e.ts) > since)
  // `lastGoodAt: null` is the sweep saying it has never once read GitHub on this
  // machine — which is what the first morning of a new one looks like, and the
  // snapshot it writes anyway is an empty object rather than an empty queue. The
  // events and the staleness reading above are unaffected; only the RC snapshot is
  // withheld, because that is the one thing here that becomes a printed count
  // (jwildfire/obot.roadmap#223).
  // An EXPLICIT null, not a missing key. The sweep always writes the field, so `null`
  // is it stating that no pass has ever succeeded here; a snapshot from before the
  // field existed carries no such statement and must not be reinterpreted as one.
  const everRead = !('lastGoodAt' in snap) || snap.lastGoodAt !== null
  return { unknown: false, why: null, events, snapshot: everRead ? (snap.snapshot ?? {}) : null,
           snapshotRead: everRead, sweptIso: snap.sweptIso }
}

/**
 * Open config items: unchecked bullets under the `## Open` heading.
 *
 * The COUNT is the entire permitted payload. The list is local-only by design and
 * the hub's deploy greps the assembled site for its sentinel, so item text must
 * never leave this function — and it never does: nothing but a number is returned.
 */
export function openBlockerCount(workspace) {
  let md
  try {
    md = readFileSync(join(workspace, BLOCKERS_REL), 'utf8')
  } catch {
    return { unknown: true, why: `no blockers file at ${BLOCKERS_REL}`, count: null }
  }
  let inOpen = false
  let count = 0
  for (const line of md.split('\n')) {
    if (/^##\s/.test(line)) { inOpen = /^##\s+.*\bopen\b/i.test(line); continue }
    if (inOpen && /^-\s+\[ \]/.test(line)) count++
  }
  return { unknown: false, why: null, count }
}

/**
 * The IDS of the config items that have EARNED the critical tag, and nothing else
 * about them.
 *
 * Reuses the Operations Dashboard's own parse and its own criticality rule rather
 * than deciding either here — the brief must not be able to disagree with the page
 * he answers these on. Criticality is earned (a `Blocks:` reference something
 * resolved to an open issue) or computed, never asserted by the item, and it is
 * budgeted at three (@jwildfire, 2026-08-15: "use it sparingly. I'm going to be
 * annoyed if you tell me something is critical when it isn't").
 *
 * An ID and nothing more crosses this boundary. The count stays the entire
 * permitted payload for everything else, and item text has no route out of this
 * function at all — the return value is an array of strings matched against
 * `cNNNN`.
 */
export async function criticalConfigIds(workspace) {
  try {
    const { collectConfig } = await import('../../ops-dashboard/lib/collect.mjs')
    const { criticalClaim, CRITICAL_BUDGET } = await import('../../ops-dashboard/lib/rank.mjs')
    const res = collectConfig(workspace)
    if (res.error && !res.absent) return { unknown: true, why: res.error, ids: [] }
    const ids = res.items
      .filter((i) => criticalClaim(i))
      .map((i) => i.id)
      .filter((id) => /^c\d{4}$/i.test(String(id ?? '')))
      .slice(0, CRITICAL_BUDGET)
    return { unknown: false, why: null, ids }
  } catch (e) {
    // Not fatal, and deliberately not an unknown for the gate: the COUNT is read
    // separately and is what the queue hash is built from. Losing the ids costs
    // the brief three identifiers, not its honesty about how many are open.
    return { unknown: true, why: `could not read config criticality: ${String(e.message).split('\n')[0]}`, ids: [] }
  }
}

/**
 * The two newest daily scratchpads, and how many bytes each `## Session log`
 * currently holds.
 *
 * Two files, never one: right after midnight the new day-file is nearly empty
 * while the whole session lives in yesterday's — measured at 2026-08-15 00:06,
 * 3,334 bytes returned while the previous day's file held 44 KB.
 *
 * The filter is the strict ^YYYY-MM-DD.md$ from prime-rehydrate, not the looser
 * 2*.md glob, which burns one of its two slots on a diary draft or a verify file.
 *
 * Bytes, not line timestamps: the `- HH:MM` on a scratchpad line is shelled local
 * time and agents here have run under at least three zones.
 */
export function sessionLogSizes(workspace) {
  let names
  try {
    names = readdirSync(join(workspace, NOTES_REL)).filter((n) => DAILY.test(n))
  } catch {
    return {}
  }
  const out = {}
  for (const name of names.sort().slice(-2)) {
    let md = ''
    try { md = readFileSync(join(workspace, NOTES_REL, name), 'utf8') } catch { continue }
    out[name] = sectionBytes(md, 'Session log')
  }
  return out
}

export function scratchpadTodos(workspace) {
  let names
  try {
    names = readdirSync(join(workspace, NOTES_REL)).filter((n) => DAILY.test(n))
  } catch {
    return { unknown: true, why: `no ${NOTES_REL} directory`, items: [] }
  }
  const items = []
  for (const name of names.sort().slice(-2)) {
    let md = ''
    try { md = readFileSync(join(workspace, NOTES_REL, name), 'utf8') } catch { continue }
    let inTodo = false
    for (const line of md.split('\n')) {
      if (/^##\s/.test(line)) { inTodo = /^##\s+todo\s*$/i.test(line.trim()); continue }
      const m = inTodo && line.match(/^-\s+\[ \]\s+(.*\S)/)
      if (m) items.push({ key: `todo:${name}:${items.length}`, title: m[1], from: name })
    }
  }
  return { unknown: false, why: null, items }
}

/**
 * Which of the two scratchpads grew since the sizes recorded at the last fold.
 * A file that appeared since then counts as growth.
 */
export function grownSince(sizesNow, sizesAtLastFold) {
  return Object.keys(sizesNow).filter((n) => (sizesNow[n] ?? 0) > (sizesAtLastFold?.[n] ?? 0))
}

function sectionBytes(md, heading) {
  const lines = md.split('\n')
  const i = lines.findIndex((l) => l.trim().toLowerCase() === `## ${heading.toLowerCase()}`)
  if (i < 0) return 0
  let j = i + 1
  while (j < lines.length && !/^##\s/.test(lines[j])) j++
  return Buffer.byteLength(lines.slice(i + 1, j).join('\n'))
}

export { statSync }
