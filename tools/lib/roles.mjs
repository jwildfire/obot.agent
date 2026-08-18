// The role registry — one list, and two questions it is allowed to answer.
//
// WHY THIS FILE EXISTS. ⚓🤖 obot-admiral — then named 🚦🤖 obot-fleet — was blocked
// from 13:51Z on 2026-08-17 with
// `API Error: Unable to connect to API: SSL certificate hostname mismatch` in its
// state record, and sat there for ten hours until a human stopped it at 00:03Z. The
// detector that knows exactly what that looks like — `DEATH` in
// tools/navigator/wake.mjs, whose every signature was taken from a real job record
// on this machine — never ran on it, because `classify()` returns nothing for a job
// that is not a worker. The thing built to catch stalled sessions had stalled, and
// it was found by a person checking rather than by any mechanism (obot.agent#181).
//
// The exclusion was not a mistake. It is written down and it is sound: a standing
// session waits between wakings by design, so `blocked` is its ordinary resting
// state, and reporting it as a corpse every quiet hour would train everyone to
// ignore the one hour it is true.
//
// The mistake is that ONE LIST ANSWERED TWO QUESTIONS.
//
//   PINNING asks: is this a role @jwildfire wants at the top of the Agents tab?
//                 He asked for "prime, nav and fleet manager pinned by default"
//                 (obot.agent#169), so the admiral belongs beside prime and nav.
//
//   LIVENESS asks: does stopping mean death? The admiral is short-lived and
//                 triggered — it launches on a condition, acts, and must exit inside
//                 a budget — so a blocked admiral is dead in exactly the way a
//                 blocked worker is dead. Here it belongs with the workers.
//
// The admiral is on opposite sides of those two lines, and the registry had one
// list. So it was correctly pinned, and silently exempted from the detector that
// would have caught it in a single sweep. That is how it fell through.
//
// The fix is not a second list — two lists drift, which is the defect this programme
// spent two days removing from the decisions registry and the dashboard queue. It is
// one list where each role DECLARES its lifecycle, and each question asks for what it
// actually means. A fourth role cannot fall through the same gap: it has to name a
// lifecycle to be added at all.
//
// LOCATION. Both the Navigator's detectors and the dashboard's roster need this, and
// they already import across each other in both directions, so it lives in neither.

/**
 * Runs continuously and waits between wakings. Stopping is its RESTING STATE, and
 * a quiet one is not a finding.
 */
export const STANDING = 'standing';

/**
 * Launches when a condition fires, acts, and exits inside a budget. It is not
 * supposed to be sitting there. Stopping without exiting is DEATH, and a quiet one
 * is a finding — the same reading a worker gets.
 */
export const TRIGGERED = 'triggered';

/**
 * Every role, with the two facts each of the questions below needs.
 *
 * `resting` is what the Agents tab says when the role has no session — it is the
 * sentence that keeps an absent row from reading as a fault, and for a triggered
 * role it says the opposite thing to a standing one, which is the same distinction
 * `lifecycle` carries.
 */
export const ROLES = [
  {
    tag: '\u{1F3A9}\u{1F916}', // 🎩🤖
    name: '\u{1F3A9}\u{1F916} obot-prime',
    short: 'prime',
    role: 'the concierge',
    lifecycle: STANDING,
    resting: 'no concierge session on this machine — nothing is answering questions',
  },
  {
    tag: '\u{1F9ED}\u{1F916}', // 🧭🤖
    name: '\u{1F9ED}\u{1F916} obot-navigator',
    short: 'nav',
    role: 'the operating officer',
    lifecycle: STANDING,
    resting: 'no Navigator session on this machine — nothing is sweeping or judging',
  },
  {
    // The admiral (obot.agent#167, named the fleet manager until #182). Short-lived
    // by design: it launches when a condition fires and exits, so ABSENT is its
    // ordinary state — which is why it needs a row that says so rather than a gap,
    // and equally why a PRESENT-but-stopped one is a finding. Its tag and session
    // name are `ADMIRAL_TAG` / `ADMIRAL_NAME` in tools/navigator/admiral.mjs; the
    // guard in navigator/test/roles.test.mjs holds the two in step.
    //
    // THE TAG IS AN ANCHOR RATHER THAN A TRAFFIC SIGNAL, and that was not decoration.
    // \u{1F6A6} was chosen when the role was a fleet manager, and it already meant
    // something else in the one place he reliably reads: `## \u{1F6A6} Release candidates
    // needing review` heads every wrapup, every session-init hand-off and
    // docs/rc-framework.md. One glyph meaning both "his review queue" and "the agent
    // that may never touch a release candidate" is the worst pair available, so the
    // rename separated them. \u{2693} is naval like the name and sits beside \u{1F3A9} and \u{1F9ED}.
    tag: '\u{2693}\u{1F916}', // ⚓🤖
    name: '\u{2693}\u{1F916} obot-admiral',
    short: 'admiral',
    role: 'the admiral',
    lifecycle: TRIGGERED,
    // Tags this role has answered to before, newest first. Never removed.
    //
    // A rename that drops them does not fail — it quietly disowns the role's own
    // history. Every session that ran as \u{1F6A6}\u{1F916} obot-fleet, including its first real
    // launch and the ten-hour block described at the top of this file, stopped
    // matching `roleOf` the moment the tag moved, and fell through to "not a role".
    // Nothing errored, and the Agents tab still showed three pinned roles the whole
    // time, because a role with no session renders from THIS registry rather than
    // from any session record. The obvious check passed while the record was lost.
    priorTags: ['\u{1F6A6}\u{1F916}'],
    // 101 characters as first written, and the Agents tab renders this line as a task
    // tag with a 100-character ceiling (obot.agent#179) — so it shipped clipped by one
    // word. Shortened in #183; the text is 👯🤖 W0038's own, agreed ahead of its rename
    // in #182. Kept here rather than reverted when this registry absorbed the array,
    // and unchanged by the rename itself — it is 88 characters and names no role.
    resting: 'not running — it launches when a condition fires and exits, so this is its resting state',
  },
];

/** Every tag one role answers to — its current one first, then any it has retired. */
export const tagsOf = (role) => [role.tag, ...(role.priorTags ?? [])];

/** Every tag any role answers to, current and retired. */
export const ROLE_TAGS = ROLES.flatMap(tagsOf);

/**
 * The role a session name belongs to, or null when it is not a role at all.
 *
 * Matched against every tag the role has ever carried, so a rename keeps the role's
 * own past sessions attributed to it instead of orphaning them (obot.agent#182).
 */
export const roleOf = (name) => ROLES.find(
  (r) => tagsOf(r).some((t) => String(name ?? '').startsWith(t)),
) ?? null;

// ---- question 1: pinning and display -----------------------------------------

/**
 * The roles the Agents tab pins and groups — ALL of them, the admiral included.
 *
 * This is the PINNING answer and it is deliberately the whole registry: a fourth
 * role should arrive pinned without anyone remembering to pin it. It says nothing
 * about whether stopping means death; ask `mustExit` for that.
 */
export const PINNED_ROLES = ROLES;

// ---- question 2: liveness ----------------------------------------------------

/**
 * Does this role rest when it is quiet? True for prime and nav.
 *
 * This is the exclusion the stop-state detectors are entitled to make, and it is now
 * the only one they may make: a role is skipped because it RESTS, never because it
 * happens to be on the list of things @jwildfire pins.
 */
export const restsWhenIdle = (name) => roleOf(name)?.lifecycle === STANDING;

/**
 * Must this role exit inside a budget? True for the admiral.
 *
 * A triggered role that has stopped moving will never exit on its own, which is what
 * the worker detectors already know how to read. So it is watched like a worker —
 * and the two states stay separate: `overrun` in tools/navigator/admiral.mjs catches
 * an admiral still RUNNING past its budget, and the stop-state detectors catch one
 * that has STOPPED and will never exit. Both fired for nobody on 2026-08-17; only the
 * first of them fired at all.
 */
export const mustExit = (name) => roleOf(name)?.lifecycle === TRIGGERED;
