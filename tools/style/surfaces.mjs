// The register: where every surface's colours come from, and what is still owed.
//
// Task jwildfire/obot.agent#295, under requirement jwildfire/obot.roadmap#289.
//
// This file is the census's only source of permission. A surface that declares its own
// palette and is not named in ALLOWED turns the census red. Adding an entry is
// deliberately a diff someone reads: it needs a date, a reason, and the issue that will
// remove it. An exemption without a way out is a decision to keep the copy forever,
// written as if it were temporary.
//
// ## The two languages, because assuming one is how a rollout repaints a public site
//
// This program has two visual languages and they are both legitimate:
//
//   document   assets/obot.css — warm grey paper, Avenir Next. The surfaces he reads
//              to decide something: decision artifacts, the operations dashboard, the
//              config cards. Carries all three theme states, because he reads them on
//              a phone at midnight.
//   keynote    assets/obot-keynote.css — espresso, Instrument Serif. The public sites,
//              and the language the September talk is dressed in. Deliberately light
//              only; the hub sheet has argued that in a comment since long before this
//              task and the argument is sound.
//
// Converging the two is @jwildfire's call and nobody else's. What is not a matter of
// taste is that either of them exists more than once.

/**
 * Where the census looks. Directories, not files — the point is to catch the surface
 * nobody thought to declare. A root absent from this machine is reported as missing
 * rather than counted clean.
 */
export const ROOTS = [
  { dir: 'obot.agent/assets' },
  { dir: 'obot.agent/tools' },
  { dir: 'obot.roadmap/scripts' },
  { dir: 'obot.roadmap/site' },
  { dir: 'obot.roadmap/reports' },
  { dir: 'obot.roadmap/requirements' },
  { dir: 'safety.viz/site' },
  { dir: 'open.gismo/site' },
  { dir: 'open.csr/site' },
];

/** The sheets that are supposed to declare a palette. Everything else consumes one. */
export const SHARED_SHEETS = [
  'obot.agent/assets/obot.css',
  'obot.agent/assets/obot-keynote.css',
];

/**
 * Copies that exist because an import is impossible, each checked byte-for-byte
 * against its canonical sheet on every census run. See tools/style/vendor.mjs.
 */
export const VENDORED = [
  {
    from: 'obot.agent/assets/obot.css',
    to: 'obot.roadmap/site/assets/obot.css',
    why: 'The obot.roadmap deploy checks out only itself, so its generators cannot import obot.agent.',
  },
  {
    from: 'obot.agent/assets/obot-keynote.css',
    to: 'obot.roadmap/site/assets/obot-keynote.css',
    why: 'Same reason. site/assets/styles.css @imports this instead of declaring the espresso palette.',
  },
];

/**
 * Surfaces still carrying their own palette, on purpose, for now.
 *
 * Every entry names the date it was accepted and the issue that removes it. This is the
 * backlog with teeth: the census cannot make these disappear, and it will not let the
 * list grow without someone writing a reason down.
 */
export const ALLOWED = [
  {
    file: 'obot.agent/tools/session-hub/lib/render.mjs',
    since: '2026-08-21',
    issue: 'jwildfire/obot.agent#296',
    why: 'The session dashboard. Twenty-five tokens, six of which are per-agent identity colours '
      + '(--agent-orange, --agent-green, --agent-pink, --agent-blue, --agent-purple, --agent-none) '
      + 'that the shared sheet has no equivalent for and that mean something outside styling — they '
      + 'match the 😺🤖 / 👯🤖 / ⚡️🤖 session tags. Adopting needs those roles named in the shared '
      + 'sheet first, which is a design question rather than a mechanical move. Its unguarded '
      + 'prefers-color-scheme block was fixed in place on 2026-08-21 so the surface honours a toggle '
      + 'while it waits.',
  },
  {
    file: 'obot.roadmap/site/assets/styles.css',
    since: '2026-08-21',
    issue: 'jwildfire/obot.agent#296',
    why: 'The espresso palette left this file on 2026-08-21; what remains is the usage section\'s '
      + 'five data-series colours (--uz-lead and friends), which are not a visual language and have '
      + 'no shared equivalent. They were chosen against a colour-vision-deficiency validator with '
      + 'measured adjacent deltas, and the file says so at length — folding them into a shared sheet '
      + 'without re-running that validator would trade a checked decision for a tidy one. The same '
      + 'gap appears independently in tools/session-hub as --agent-*, which is what #296 is about: '
      + 'identity and series colours need naming in the shared sheet before either can adopt.',
  },
  {
    file: 'safety.viz/site/site.css',
    since: '2026-08-21',
    issue: 'jwildfire/obot.agent#296',
    why: 'Keynote language, 1,088 lines with an explicit extraction seam at line 597. Fourteen of its '
      + 'root tokens are byte-identical to the shared keynote sheet and can simply go; the work is '
      + 'small but it is a public site and belongs in its own repository\'s pull request, reviewed there.',
  },
  {
    file: 'open.gismo/site/src/style.css',
    since: '2026-08-21',
    issue: 'jwildfire/obot.agent#296',
    why: 'Keynote language, 1,321 lines. Its own header says it adopted safety.viz\'s tokens by copying '
      + '"because there was nothing to reference". There is now. Same reasoning as safety.viz: its own repository, its own pull request.',
  },
  {
    file: 'open.csr/site/site.css',
    since: '2026-08-21',
    issue: 'jwildfire/obot.agent#296',
    why: 'A sibling of the keynote language rather than a copy of it: measured on 2026-08-21, it shares '
      + 'one value of the seventeen common token names, which matches its header calling the palette '
      + 'deliberately different. It should take the keynote sheet\'s structure and override the palette, '
      + 'which is a larger change than the other two and is worth doing only once somebody has decided '
      + 'whether open.csr keeps a distinct identity at all.',
  },
];

/**
 * Dated records, frozen rather than exempted.
 *
 * A report published on a day is a record of what was said on that day, and restyling it
 * is rewriting it. So these are not converted and not excused: the count is frozen at
 * what it was, and the census goes red if it grows. You cannot fix the past; you are not
 * allowed to add to it. A new page under these paths consumes a shared sheet.
 *
 * `frozen` was measured on the date below, not chosen.
 */
export const ARCHIVES = [
  { dir: 'obot.roadmap/reports', frozen: 93, since: '2026-08-21' },
  { dir: 'obot.roadmap/requirements/design', frozen: 18, since: '2026-08-21' },
];
