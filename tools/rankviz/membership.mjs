// Membership over time, replayed from GitHub's own label events.
//
// The ranked head has TWO records and they start on different days. `rank/top10.json`
// holds the ORDER and its history begins at the commit that created it; the `top10`
// and `on-deck` labels hold MEMBERSHIP and theirs begins when the labels were first
// applied, several hours earlier. This module reads the second one, and it exists for
// exactly one reason: it is the only thing on this page that genuinely extends the
// record backwards past the store's first commit.
//
// WHAT IT MUST NOT DO. It must not be presented as ranked. The label carries no order
// — @jwildfire, 2026-08-19: "Let's just make a 'top10' label for those requirements so
// that it's discoverable and it becomes a simple github api call to get the list" — so
// every state this produces is a SET, and the surface renders it as one.
//
// THE TRUNCATION TRAP. GitHub's issue-events endpoint pages newest-first. A fetch that
// stops at a page cap produces a record whose oldest event looks exactly like the first
// event, and a page built on it would state a start date that is merely where the
// reader stopped looking. `membershipSpan` therefore takes the fetch's own verdict on
// whether it reached the beginning, and refuses to call a truncated record a beginning.
/** The default burst window: a run of labelling done in one act. */
export const BATCH_GAP_MS = 5 * 60 * 1000

const ms = (iso) => Date.parse(iso)

/** Oldest first, stably. */
const chronological = (events) => [...events].sort((a, b) => ms(a.iso) - ms(b.iso))

/**
 * Group events into the acts that produced them.
 *
 * Eleven labels applied seven seconds apart are one decision, not eleven, and rendering
 * them as eleven states would make a single evening look like a fortnight of churn —
 * the same overstatement this page exists to avoid, in the other direction.
 */
export function batchEvents(events, gapMs = BATCH_GAP_MS) {
  const sorted = chronological(events)
  const batches = []
  let cur = null
  let last = null
  for (const e of sorted) {
    const t = ms(e.iso)
    if (cur && last !== null && t - last <= gapMs) cur.push(e)
    else { cur = [e]; batches.push(cur) }
    last = t
  }
  return batches
}

/**
 * The membership sets as each act of labelling left them.
 *
 * `{ read, states }`, where every state carries the sets AFTER its batch was applied
 * and the changes that batch made. An `unlabeled` event for a label the issue never
 * carried is a no-op rather than an error: the fetch window can begin after a label was
 * applied, so a removal with no matching addition is an ordinary consequence of a
 * bounded record, not a corruption of it.
 */
export function replayMembership(events, { labels = [], gapMs = BATCH_GAP_MS } = {}) {
  const wanted = new Set(labels)
  const relevant = events.filter((e) => wanted.has(e.label))
  const sets = new Map(labels.map((l) => [l, new Set()]))
  const states = []
  for (const batch of batchEvents(relevant, gapMs)) {
    const changes = []
    for (const e of batch) {
      const set = sets.get(e.label)
      if (!set) continue
      const had = set.has(e.issue)
      if (e.action === 'labeled') set.add(e.issue)
      else if (e.action === 'unlabeled') set.delete(e.issue)
      if (had !== set.has(e.issue)) changes.push({ action: e.action, label: e.label, issue: e.issue })
    }
    states.push({
      iso: batch[0].iso,
      endIso: batch.at(-1).iso,
      events: batch.length,
      changes,
      sets: Object.fromEntries(labels.map((l) => [l, [...(sets.get(l) ?? [])].sort((a, b) => a - b)])),
    })
  }
  return { read: true, states }
}

/**
 * How far back the label record reaches — and whether that is the record's beginning or
 * merely where the fetch stopped. See the truncation trap in the header.
 */
export function membershipSpan(events, { complete = true } = {}) {
  const sorted = chronological(events)
  const from = sorted[0]?.iso ?? null
  const to = sorted.at(-1)?.iso ?? null
  return {
    from,
    to,
    events: sorted.length,
    complete,
    why: complete
      ? ''
      : 'the events fetch hit its page cap before reaching a page with no label events on it, so this record starts where the fetch stopped rather than where the labelling started',
  }
}
