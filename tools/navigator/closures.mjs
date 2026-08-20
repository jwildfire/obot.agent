// closures — a completion reaches a person (jwildfire/obot.roadmap#257, scope note 2026-08-20).
//
// THE FAILURE THIS CLOSES. On 2026-08-20 four workers finished inside twenty-five
// minutes and closed five requirements. Nothing told @jwildfire. He noticed the agent
// count had dropped, asked what had happened, and got a list of issue numbers back.
//
// Nothing was broken. The admiral's trigger is a positive PROBLEM condition — a
// session past the bar, an idle operational pull request, an unrecorded closeout — so
// a worker that finishes cleanly trips none of them and by construction it never
// launches on success. The wake fired three times and its state file read `wake:
// clear — every worker that stopped has been judged`. The loop ran and closed
// entirely inside the machine. No hop in that chain ends at a person.
//
// So this is not a broken check. Completion had no delivery path, exactly as failure
// had none before the wake was built (hub#212).
//
// TWO HALVES, AND KEEPING THEM APART IS THE DESIGN.
//
//   the DETECTOR   GitHub's closed requirements against the landing record. A
//                  requirement closed with nobody saying what he can now do is a
//                  finding, the same way an unstamped worker is. This is what makes
//                  the summary STRUCTURAL: "write a plain-English summary" is an
//                  instruction, and an instruction is what four workers already had.
//   the CHANNEL    a recorded completion goes out on the wake the Navigator is
//                  already tailing, carrying the SENTENCE and not the number, exactly
//                  once. Extending the existing channel rather than building a second
//                  one is deliberate: the listener, the heartbeat and the armed/DOWN
//                  reporting all already exist and all already work.
//
// NO NEW GITHUB CALL. The closed issues come off `ORPHAN_QUERY`, which checks.mjs
// already runs once per repo every five minutes and which already asks for `number
// title closedAt labels`. A second listing would be two thousand calls a day for a
// number that moves a few times an hour, and — worse — two readers of the same
// records is how the detector and the wake would come to disagree about what closed.
//
// A COMPLETION IS AN EVENT, NOT A NAG. Every other wake kind repeats on a floor
// because the condition persists until someone acts: an unjudged closeout is still
// unjudged an hour later. A finish is done. `deliverable` therefore treats
// `delivered` as once-only, keyed on the landing id, and the append-only wake log is
// the record of what has already gone out.

/** How far back a closed requirement is still expected to carry a sentence.
 *  Long enough that a machine asleep overnight still reports the morning's closures;
 *  short enough that arming this does not report a fortnight of history as a gap. */
export const CLOSURE_WINDOW_H = 48

/** How old a recorded completion may be and still be worth waking anyone for. A cold
 *  start must not deliver a burst of last week's news into a session's event stream. */
export const COMPLETION_WINDOW_H = 24

/** The label that says an issue is a requirement rather than an implementation task. */
export const REQUIREMENT_LABEL = 'requirement'

const hoursSince = (iso, now) => {
  const t = Date.parse(iso)
  return Number.isNaN(t) ? null : (now.getTime() - t) / 3600000
}

/**
 * One spelling of an issue reference, so `hub#264` and `jwildfire/obot.roadmap#264`
 * are one requirement rather than two.
 *
 * The short form is what an agent types and the long form is what GitHub returns, and
 * a record that cannot join them would report every summarised closure as unsummarised
 * — a detector that fires on its own successes gets muted within a day.
 */
export function refKey(ref, { repo = 'jwildfire/obot.roadmap', alias = 'hub' } = {}) {
  const s = String(ref || '').trim()
  const m = /^(?:([A-Za-z0-9._-]+\/[A-Za-z0-9._-]+)|([A-Za-z0-9._-]*))#(\d+)$/.exec(s)
  if (!m) return null
  const long = m[1] || (m[2] === alias || m[2] === '' ? repo : null)
  return long ? `${long}#${m[3]}` : `${m[2]}#${m[3]}`
}

/**
 * Which of the items the sweep already read are requirement closures.
 *
 * Deliberately narrow on all three axes. Only the hub, because a closed issue in an
 * implementation repo is a task and the requirement above it is what he is owed a
 * sentence about. Only issues, because a merged pull request is the work and not the
 * outcome. Only inside the window, because arming a detector against all of history
 * produces a hundred findings on its first run and teaches its reader to skip it.
 */
export function closedRequirements(items = [], { repo = 'jwildfire/obot.roadmap',
  label = REQUIREMENT_LABEL, windowHours = CLOSURE_WINDOW_H, now = new Date() } = {}) {
  const out = []
  for (const it of items) {
    if (it?.repo !== repo || it?.kind !== 'issue' || it?.state !== 'CLOSED') continue
    if (!(it.labels ?? []).includes(label)) continue
    const age = hoursSince(it.closedAt, now)
    if (age === null || age > windowHours || age < 0) continue
    out.push({
      ref: `hub#${it.number}`,
      key: `${repo}#${it.number}`,
      number: it.number,
      title: it.title ?? '',
      closedAt: it.closedAt,
      ageHours: age,
    })
  }
  return out.sort((a, b) => a.ageHours - b.ageHours)
}

/**
 * The closures nobody wrote a sentence for.
 *
 * This is the whole structural claim: an agent that closes a requirement and says
 * nothing does not get away with it quietly — the sweep names the issue, says how
 * long it has been silent, and prints the command that fixes it.
 */
export function unsummarised(closed = [], recorded = [], opts = {}) {
  const have = new Set()
  for (const c of recorded) {
    const k = refKey(c?.issue, opts)
    if (k) have.add(k)
  }
  return closed
    .filter((c) => !have.has(c.key))
    .map((c) => ({
      ...c,
      why: 'closed with no sentence saying what he can now do that he could not before',
    }))
}

/**
 * Recorded completions, as wake detections carrying the sentence.
 *
 * A completion with no summary produces NOTHING here rather than a line reading
 * "hub#264 closed". The channel carrying a bare number is the failure being fixed,
 * and half-delivering it would be the version of this that looks like it works.
 */
export function completionDetections(closures = [], { now = new Date(),
  windowHours = COMPLETION_WINDOW_H } = {}) {
  const out = []
  for (const c of closures) {
    const summary = String(c?.summary ?? '').trim()
    if (!summary || !c?.id) continue
    const age = c.ageHours ?? hoursSince(c.at, now)
    if (age === null || age > windowHours) continue
    out.push({
      kind: 'delivered',
      key: `delivered:${c.id}`,
      worker: c.worker || 'unknown',
      at: c.at,
      // The sentence first and the citation last, because this line is read by a
      // person in a notification and the plain-English contract is not a rendering
      // preference — it is what the requirement asks for.
      line: `${summary} — ${c.issue}${c.worker ? ` · ${c.worker}` : ''}`,
    })
  }
  return out
}

/**
 * The one-line verdict and its detail, for the sweep's preamble band.
 *
 * Same shape as the config and worker ledger lines it sits beside: a headline that is
 * the whole answer, then indented rows. Every branch that is not a measured clean pass
 * says which reading it did not make — nothing read is not a covered roadmap
 * (jwildfire/obot.roadmap#223).
 */
export function landingsNote({ missing = [], state = null, read = true, now = new Date() } = {}) {
  const detail = []
  if (!state) {
    return {
      ok: false,
      alarm: 'LANDING RECORD BROKEN',
      summary: 'the record of what he was promised and what reached him could not be '
        + 'read, so nothing here is saying a completion was delivered; it is saying it '
        + 'could not look',
      detail,
    }
  }
  if (!state.armed) {
    return {
      ok: false,
      alarm: 'LANDING RECORD GAP',
      summary: 'nothing has been promised or summarised on this machine, so no '
        + 'completion is reaching him. This is not a quiet day; it is an unwritten one',
      detail: ['write the first with `obot.agent/tools/landing-log closure --issue '
        + "hub#N --summary '<what he can now do>'`"],
    }
  }

  const closures = state.closures ?? []
  const promises = state.promises ?? []
  const quiet = promises.filter((p) => p.quiet)
  const today = closures.filter((c) => (c.ageHours ?? 0) <= COMPLETION_WINDOW_H)

  for (const m of missing) {
    detail.push(`${m.ref} "${m.title}" closed ${Math.round(m.ageHours)}h ago — ${m.why}; `
      + `write one with \`obot.agent/tools/landing-log closure --issue ${m.ref} --summary '…'\``)
  }
  for (const p of quiet) {
    detail.push(`${p.id} "${p.asked}" — ${p.state} at ${p.landing} (${p.detail}), `
      + `${Math.round(p.ageHours ?? 0)}h since he asked`)
  }

  if (missing.length) {
    return {
      ok: false,
      alarm: 'CLOSURE SUMMARY GAP',
      summary: `${missing.length} requirement(s) closed on GitHub and nobody said what `
        + 'he can now do that he could not before',
      detail,
    }
  }
  if (quiet.length) {
    return {
      ok: false,
      alarm: 'PROMISE DELIVERY GAP',
      summary: `${quiet.length} thing(s) he asked for have not been found at the place `
        + 'they were meant to land',
      detail,
    }
  }
  if (!read) {
    return {
      ok: false,
      alarm: 'CLOSURE CHECK BROKEN',
      summary: `the hub was not read this pass, so nothing here says whether a `
        + `requirement closed without a summary — ${today.length} completion(s) are `
        + `recorded in the last ${COMPLETION_WINDOW_H}h and that is all this can say`,
      detail,
    }
  }
  return {
    ok: true,
    alarm: null,
    summary: `landings: ${today.length} completion(s) summarised in the last `
      + `${COMPLETION_WINDOW_H}h, every closed requirement covered, `
      + `${promises.length - quiet.length} promise(s) found where he was told to look`,
    detail,
  }
}

/**
 * The one line the state file prints, alarm headline and all.
 *
 * The bold ALL-CAPS headline is not decoration: the dashboard's reader styles a
 * finding by matching `ALARM_RE` against it, and a headline that does not match
 * arrives on his page as ordinary grey text (obot.agent#223). Composing it here,
 * once, is what lets the test assert against the REAL exported regex rather than a
 * copy of it — a copy is a second source of truth that drifts silently, and what
 * that costs is a finding nobody sees.
 */
export function landingsLine(note) {
  if (!note) {
    return 'landings: **NO READING** — the record of what he was promised and what '
      + 'reached him did not run this sweep. Whether a completion reached him is '
      + 'unknown, not clean.'
  }
  return note.alarm ? `**${note.alarm}** — ${note.summary}` : note.summary
}
