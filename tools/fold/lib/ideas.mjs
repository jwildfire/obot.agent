// The ideas backstop, run by the clock instead of by nobody (obot.agent#203,
// under jwildfire/obot.roadmap#238).
//
// It last ran on 2026-08-14. Its only automatic trigger lived inside the
// interactive kickoff's recon sibling, and that lane has not run since 4 August.
//
// It is a BACKSTOP, not the front line — the hub's ideas-triage Action handles
// each new post within minutes — so the expected result on most mornings is
// nothing at all. That is precisely why it went unmissed for four days, and
// precisely why "nothing new" and "broken" must not produce the same output.
//
// What this deliberately does NOT do: run the Reminders ingest. That step shells
// osascript into Apple Reminders and the skill that owns it warns it can stall on
// a permission prompt. At 07:00 there is nobody at the keyboard to answer one,
// and a fold blocked on a modal dialog is a fold that never finishes.
//
// Triage is not the fold's job either. The fold surfaces the count; replying in
// thread needs judgement and a second credential, and the interactive procedure
// that does it stays exactly where it is (obot.roadmap#240 owns re-homing).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { execFileSync } from 'node:child_process'

export const WATERMARK_REL = '.claude/ideas-watermark'

// The underlying query takes the 50 most recently updated and filters
// client-side, so a full page means the filter may have run out of rows rather
// than out of matches.
export const PAGE_SIZE = 50

// With no watermark at all, look back a week rather than to the epoch. The
// script's own default is 1970, which would hand a fold every idea ever filed as
// though all of it arrived this morning.
const COLD_START_DAYS = 7

export const newestUpdatedAt = (items) =>
  (items ?? []).map((i) => i.updatedAt).filter(Boolean).sort().at(-1) ?? null

export function readWatermark(workspace, { now = new Date() } = {}) {
  try {
    const v = readFileSync(join(workspace, WATERMARK_REL), 'utf8').trim()
    if (v && !Number.isNaN(Date.parse(v))) return v
  } catch { /* cold start below */ }
  return new Date(now.getTime() - COLD_START_DAYS * 86400000).toISOString().replace(/\.\d+Z$/, 'Z')
}

/**
 * @param sweep         (sinceIso) => [{number,title,url,updatedAt,...}]
 * @param categoryTotal () => number   how many discussions the category holds at all
 * @param advance       write the watermark forward when the sweep was trustworthy
 */
export function sweepIdeas(workspace, { sweep = defaultSweep, categoryTotal = defaultTotal, advance = false, now = new Date() } = {}) {
  const since = readWatermark(workspace, { now })

  let items
  try {
    items = sweep(since) ?? []
  } catch (e) {
    return { unknown: true, why: `ideas sweep failed: ${first(e)}`, items: [], since, truncated: false }
  }

  // An empty result is only believable if the category itself is non-empty. The
  // category id is hardcoded in the sweep script; if it ever changes, every run
  // reports "no new ideas" forever and looks healthy doing it.
  if (!items.length) {
    let total = null
    try {
      total = categoryTotal()
    } catch (e) {
      return { unknown: true, why: `could not confirm the ideas category is reachable: ${first(e)}`, items: [], since, truncated: false }
    }
    if (!total) {
      return {
        unknown: true,
        why: 'the ideas category reported zero discussions in total — an empty inbox and an unreachable one look identical, and this is the unreachable shape',
        items: [], since, truncated: false,
      }
    }
    return { unknown: false, why: 'no new ideas since the last sweep', items: [], since, truncated: false }
  }

  const truncated = items.length >= PAGE_SIZE
  if (advance) {
    // To what was ACTUALLY swept, never to the wall clock. The script's own
    // --advance stamps `date -u` at the moment it runs, so anything updated
    // between the read and the advance is skipped permanently — seconds apart in
    // a fold, and a real race.
    const newest = newestUpdatedAt(items)
    if (newest) writeWatermark(workspace, newest)
  }

  return {
    unknown: false,
    why: truncated
      ? `${items.length} idea(s) since the last sweep — a full page, so there may be more the filter never saw`
      : `${items.length} idea(s) since the last sweep`,
    items, since, truncated,
  }
}

export function writeWatermark(workspace, iso) {
  const f = join(workspace, WATERMARK_REL)
  mkdirSync(dirname(f), { recursive: true })
  writeFileSync(f, iso + '\n')
}

const REPO_ROOT = new URL('../../..', import.meta.url).pathname

function defaultSweep(sinceIso) {
  const out = execFileSync(join(REPO_ROOT, 'scripts', 'ideas-sweep'), [], {
    encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, OBOT_IDEAS_SINCE: sinceIso },
  })
  return out.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l))
}

function defaultTotal() {
  const out = execFileSync('gh', ['api', 'graphql', '-f', 'query=query{repository(owner:"jwildfire",name:"obot.roadmap"){discussions(first:1,categoryId:"DIC_kwDOTLuTVs4DBzqe"){totalCount}}}',
    '--jq', '.data.repository.discussions.totalCount'], {
    encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'],
  })
  return Number(out.trim())
}

const first = (e) => String(e.stderr || e.message || e).split('\n')[0].slice(0, 200)
