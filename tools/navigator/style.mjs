// The style census on the five-minute ride — jwildfire/obot.agent#311, under
// requirement jwildfire/obot.roadmap#289.
//
// ## Why the sweep, when CI already gates
//
// #289's Done-when is one sentence: "A check fails if any surface reintroduces its own
// copy." The census that answers it was written (#295) and made honest about what it
// could not read (#309), and then nothing ever called it. It was named in no workflow,
// no sweep and no script — only in its own tests and its own documentation — so the
// requirement read as delivered while the property was unguarded.
//
// The two homes see different things and can do different things, and that is the whole
// design rather than a hedge:
//
//   CI      checks out obot.agent alone and can block a merge. Four of the nine
//           declared roots are invisible to it and always will be, so it can gate this
//           repository's surfaces and nothing else.
//   sweep   is the only place all nine roots exist on one disk, so it is the only
//           thing that can see a public site reintroduce a palette. It gates nothing.
//
// Neither alone satisfies the requirement. CI can never watch safety.viz drift; the
// sweep can never stop the pull request that drifts it.
//
// ## Spawned rather than imported, for two reasons that both matter
//
// The sweep is synchronous end to end and runs every five minutes while restarting the
// dashboard and fast-forwarding seven checkouts. An in-process walk cannot be
// interrupted, so its cost would be whatever the directories happen to be — "it was
// fast when I measured it" is not a bound. `spawnSync` with a timeout is one, enforced.
// Measured 2026-08-21: 0.55s cold and 0.36s warm over all nine roots, against a pass
// that takes about half a minute, and the number is printed in the section so a
// slowdown becomes visible rather than inferred from a sweep that stopped arriving.
//
// The second reason is the argument of the requirement itself. Re-rendering the verdict
// here would be a second copy of the sentence, drifting from the first exactly as every
// duplicated store in this program has. So the section IS the command's output, and the
// sweep runs the same code path CI runs.
//
// ## Three states, and the one that dies at a caller
//
// `unknown` exists because a run that could not look must not say `clean`. A caller is
// where that distinction gets rounded away — a green tick meaning "no drift among the
// four roots I could not read" is the same defect one layer up, wearing a check mark.
// So: drift alarms, a broken reading alarms, and `unknown` is printed plainly and
// deliberately does not, for the same reason the census itself does not exit 1 on it.
import { spawnSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { MD_HEADING } from '../style/census.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const CENSUS = join(HERE, '..', 'style-census')

/** The reading itself did not happen. Not a clean bill of health, and must not read as one. */
export const ALARM_READING = '**STYLE CENSUS BROKEN**'

/**
 * The census's own heading, so the broken form and the rendered form land in one
 * section. Two headings for one reading would give the Operations Dashboard two tabs,
 * one of which is always empty.
 */
export const HEADING = MD_HEADING

/**
 * The wall clock the sweep can rely on. Twenty seconds is the bound the sweep already
 * uses for `blocker-log --audit` and `worker-id --audit`, and it is forty times the
 * measured cost — wide enough that a normal run never approaches it, narrow enough that
 * a pathological one costs a section rather than the cadence.
 */
export const BUDGET_MS = 20000

/**
 * One census run: the markdown, which state it ended in, and what it cost.
 *
 * `read: false` is the fourth possibility and is never any of the three states. A
 * timeout, a missing tool, a crash, or output that is not the census's all land there,
 * and all of them render as broken rather than as clean.
 */
export function collectStyle({ census = CENSUS, spawn = spawnSync, timeout = BUDGET_MS, env = process.env } = {}) {
  const began = process.hrtime.bigint()
  let r
  try {
    r = spawn(census, ['--md'], { encoding: 'utf8', timeout, env })
  } catch (e) {
    return { read: false, why: `the census could not be spawned: ${String(e?.message ?? e).slice(0, 120)}`, ms: 0 }
  }
  const ms = Math.round(Number(process.hrtime.bigint() - began) / 1e6)
  // `status === null` is the timeout and the spawn failure both; `error` names which.
  if (!r || r.error || r.status === null) {
    const why = r?.error?.code === 'ETIMEDOUT' || (r && r.signal === 'SIGTERM')
      ? `the census did not finish inside ${Math.round(timeout / 1000)}s and was stopped`
      : `the census could not be run: ${String(r?.error?.message ?? 'no result').slice(0, 120)}`
    return { read: false, why, ms }
  }
  // 0 is clean-or-unknown and 1 is drift, by the census's own contract. Anything else
  // is the tool falling over, which is a reading that did not happen.
  if (r.status !== 0 && r.status !== 1) {
    return { read: false, why: `the census exited ${r.status}${r.stderr ? `: ${String(r.stderr).trim().slice(0, 120)}` : ''}`, ms }
  }
  const md = String(r.stdout ?? '').trim()
  if (!md.startsWith(MD_HEADING)) {
    return { read: false, why: 'the census printed something that is not a census, so nothing here can be trusted to be one', ms }
  }
  // Derived from the census's own words rather than recomputed: exit 1 is its drift
  // contract, and the unknown qualification is the sentence verdict() writes.
  const state = r.status === 1 ? 'drifted' : /unknown, not clean/i.test(md) ? 'unknown' : 'clean'
  return { read: true, md, state, ms, why: null }
}

/** What the section says when the reading did not happen at all. */
export const styleBroken = (why) => `${HEADING}\n\n${ALARM_READING} — ${why}. No surface was examined this sweep, so nothing here says the shared stylesheet still holds anywhere. Unknown, not clean.\n`

/**
 * The section, rendered every sweep, clean or not — a section that appears only when
 * something is wrong is indistinguishable from one that has stopped running, which is
 * the failure this task is named after.
 *
 * The census's own output is passed through untouched: its verdict is already the first
 * line under the heading, which is where a headline has to be (obot.agent#129), and its
 * rows are already bullets, which is what keeps `parseNavigatorState` from alarm-testing
 * them (obot.roadmap#241). The only thing added is what the run cost.
 */
export function styleSection(state) {
  if (!state || !state.read) return styleBroken(state?.why ?? 'no census reading ran this sweep')
  const cost = `- read in ${state.ms}ms by \`obot.agent/tools/style-census --md\`, bounded at ${Math.round(BUDGET_MS / 1000)}s — the same command CI runs, so the gate and this detector cannot disagree`
  return `${state.md.trimEnd()}\n${cost}\n`
}
