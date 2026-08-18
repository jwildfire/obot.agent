// The gate. Three questions, not one (jwildfire/obot.roadmap#238).
//
// The requirement's Design section settles this: "content-gated" in the adopted
// decision covers three outputs whose false positives cost wildly different
// amounts, and one threshold for all three is how this becomes the openclaw daily
// summary again. Those summaries were published by an unconditional cron and were
// measured afterwards: 559 words on a day they called quiet, seven real asks
// starting at line 38 behind ~500 words of recap, and word count growing
// monotonically from 136 to 865 against a fixed template that had to be filled.
//
//   diary    <- ACTIVITY. A wrong yes costs a thin entry; the record still exists,
//                and the diary is the keynote's raw material.
//   briefing <- CHANGE. A wrong yes costs nothing: one stable URL, rewritten.
//   push     <- CHANGE and a non-empty queue. A wrong yes costs the next push,
//                which is the only currency this thing has.
//
// Below all three sits one rule that is not symmetric: an UNKNOWN is never
// reported as quiet. A page composed from failed queries is short, tidy and
// wrong, and the failure has a name here — the Navigator's sweep once reported
// "seven repos, two release candidates, workers clean" while every one of its
// seven queries had failed.
import { createHash } from 'node:crypto'

/**
 * A stable fingerprint of the queue as HE sees it.
 *
 * Only the identity of each item counts. Ages, sweep stamps and ordering move on
 * their own every morning and are not changes to his queue — if they were in the
 * hash, every fold would look like news and the push would fire daily, which is
 * the exact habit the openclaw autopsy blames for the reader learning to skip.
 *
 * The blocker count IS in the hash, because it is a real signal. The blocker
 * *text* is never anywhere near this file: that list is local-only by design and
 * the hub deploy greps the assembled site for its sentinel.
 */
export function queueHash(queue) {
  const keys = (xs) => (xs ?? []).map((x) => String(x.key ?? x.id ?? x.title ?? '')).sort()
  const canonical = JSON.stringify({
    rcs: keys(queue.rcs),
    decisions: keys(queue.decisions),
    todos: keys(queue.todos),
    blockers: queue.blockers ?? 0,
  })
  return 'sha256:' + createHash('sha256').update(canonical).digest('hex').slice(0, 24)
}

const count = (q) => (q.rcs?.length ?? 0) + (q.decisions?.length ?? 0) + (q.todos?.length ?? 0)

/**
 * @param activity     {commits, events, scratchpad, unknown} since the last fold
 * @param queue        {rcs, decisions, todos, blockers} as it stands now
 * @param queueUnknown true when any queue source failed to answer
 * @param lastHash     the hash behind the last published briefing, or null
 */
export function decide({ activity, queue, queueUnknown, lastHash }) {
  const hash = queueHash(queue)

  const signals = [
    activity.commits?.length ? `${activity.commits.length} commit(s)` : null,
    activity.events?.length ? `${activity.events.length} swept event(s)` : null,
    activity.scratchpad?.length ? `${activity.scratchpad.length} scratchpad file(s) grew` : null,
  ].filter(Boolean)

  // An unknown activity signal folds the diary. The direction that matters is
  // never claiming a night was quiet when nobody actually looked.
  const hasActivity = signals.length > 0 || !!activity.unknown
  const reasonActivity = activity.unknown
    ? 'activity is UNKNOWN — a source failed, so the night is not being called quiet'
    : signals.length ? `activity: ${signals.join(' · ')}`
    : 'no commits, no swept events, no scratchpad growth since the last fold'

  // A queue nobody could read is not a queue that changed, and not one worth
  // publishing. This is the branch that refuses to build a page out of failures.
  if (queueUnknown) {
    return {
      verdict: 'unknown',
      diary: false,
      briefing: false,
      push: false,
      hash: null,
      reasons: {
        activity: reasonActivity,
        change: 'the queue could not be read, so nothing is published',
        push: 'no push: a queue nobody could read is not a queue that changed',
      },
    }
  }

  const firstEver = lastHash === null || lastHash === undefined
  const changed = firstEver || hash !== lastHash
  const nonEmpty = count(queue) > 0

  const diary = hasActivity
  // The first fold always publishes, so the URL exists to be bookmarked. After
  // that the page is change-gated. Existing is never a reason to interrupt him.
  const briefing = changed
  const push = changed && nonEmpty && !firstEver

  return {
    verdict: diary || briefing ? 'fold' : 'quiet',
    diary,
    briefing,
    push,
    hash,
    reasons: {
      activity: reasonActivity,
      change: firstEver
        ? 'no briefing has ever been published — publishing the first one so the URL exists'
        : changed ? `the queue changed: ${lastHash} -> ${hash}`
        : `the queue is unchanged at ${hash} — cumulative, so it carries without re-rendering`,
      push: !changed ? 'no push: nothing he has not already been shown'
        : firstEver ? 'no push: the first page existing is not news'
        : !nonEmpty ? 'no push: his queue is empty, and silence has to mean nothing needs him'
        : `push: ${queue.rcs.length} RC · ${queue.decisions.length} decisions · ${queue.todos.length} todos`,
    },
  }
}
