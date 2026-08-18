// The day's diary entry, composed mechanically (obot.agent#202, under
// jwildfire/obot.roadmap#238).
//
// There is no entry for 17 August. That day carried ninety-one commits and a
// shipped release. There is none for 15 August either, and a nine-day gap before
// 14 August. The diary stopped because its trigger was the end of a session, and
// the standing sessions do not end.
//
// It is written for someone who was not present. That is the register, and this
// house makes it cheap: every squash subject here is already a declarative
// outcome sentence — "A quiet night is provably quiet: the fold decides whether
// there is anything to say (#200) (#208)" — so an entry built from them reads as
// prose rather than as a changelog. The composer's job is to select and link,
// never to summarise, because a model that summarises is a model that can bloat.
//
// The narrative paragraph is the one genuinely authored part, and it is left
// marked as owed rather than faked. Starting an agent on a clock is A2 and A2 is
// not enabled; a mechanically-composed record on the morning after is the
// guarantee that was lost, and an unwritten one is where we are now.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseLanded, composeEntry, NARRATIVE_OWED } from '../lib/diary.mjs'

const LOG = [
  'be5b622\t2026-08-18T05:41:23Z\t07:00 arrives whether or not anyone is awake, and a stopped clock says so (#204) (#216)',
  'f05b5cd\t2026-08-18T05:33:00Z\tYour dashboard could not read the machine it describes, and called that an empty list (#206) (#213)',
  '3d8159a\t2026-08-18T05:10:00Z\tA worker is told a requirement is not an approval, and given the command that says what is (#211)',
].join('\n')

test('a squash subject yields the sentence, the pull request and the issues it closed', () => {
  const [first] = parseLanded('obot.agent', LOG)
  assert.equal(first.title, '07:00 arrives whether or not anyone is awake, and a stopped clock says so')
  assert.equal(first.pr, 216)
  assert.deepEqual(first.issues, [204])
  assert.equal(first.repo, 'obot.agent')
})

test('the LAST parenthesised number is the pull request, the rest are issues', () => {
  const [, , third] = parseLanded('obot.agent', LOG)
  assert.equal(third.pr, 211, 'a subject with one ref is a PR with no closing issue recorded')
  assert.deepEqual(third.issues, [])
})

test('a subject with no reference at all still counts as landed', () => {
  const l = parseLanded('safety.viz', 'abc1234\t2026-08-18T04:00:00Z\tSomething merged without a number')
  assert.equal(l.length, 1)
  assert.equal(l[0].pr, null)
  assert.equal(l[0].title, 'Something merged without a number')
})

test('an entry a stranger can read: the ask first, then what changed, each a link', () => {
  const md = composeEntry(FIXTURE())
  const ask = md.indexOf('🚦 Release candidates')
  const decisions = md.indexOf('🧭 Decisions')
  const record = md.indexOf('## What landed')
  assert.ok(ask > 0 && ask < decisions && decisions < record,
    'the summaries this replaces put seven real asks at line 38 behind 500 words of recap')
  assert.match(md, /\[open\.gismo#10\]\(https:\/\/github\.com/)
  assert.match(md, /\[obot\.agent#216\]\(https:\/\/github\.com\/jwildfire\/obot\.agent\/pull\/216\)/)
})

test('both headline sections are present even when empty', () => {
  const md = composeEntry({ ...FIXTURE(), rcs: [], decisions: [] })
  assert.match(md, /## 🚦 Release candidates needing review/)
  assert.match(md, /## 🧭 Decisions needed/)
  assert.match(md, /_None waiting on you\._/)
})

test('the meta line exists and matches the index regex, or the entry has no summary', () => {
  const md = composeEntry(FIXTURE())
  // scripts/render_diary.mjs extracts it with /<span class="meta">([^<]*)<\/span>/
  const m = md.match(/<span class="meta">([^<]*)<\/span>/)
  assert.ok(m, 'without this the diary index renders a blank row')
  assert.ok(m[1].length > 40, 'and it has to say something a stranger can use')
  assert.match(m[1], /3 change/, 'it leads with what happened, not with how it was produced')
  assert.doesNotMatch(m[1], /largest/, 'nothing here measures size; the list is ordered by time')
  assert.match(m[1], /most recently/)
})

test('the narrative is marked owed rather than faked', () => {
  const md = composeEntry(FIXTURE())
  assert.match(md, NARRATIVE_OWED)
  assert.match(md, /not yet reviewed by @jwildfire/i, 'it publishes to a public site')
})

test('it links its own operational record, by the paired slug', () => {
  const md = composeEntry(FIXTURE())
  assert.match(md, /📊 \[Session report\]\(\.\.\/reports\/sessions\/2026-08-18\.html\)/)
})

test('it emits no section it cannot fill honestly', () => {
  const md = composeEntry({ ...FIXTURE(), landed: [], todos: [] })
  assert.doesNotMatch(md, /## Scaffold changes/, 'an empty heading reads as "nothing happened", which is a claim')
  assert.doesNotMatch(md, /## Next session: loose ends/)
  assert.doesNotMatch(md, /## What landed/)
  assert.match(md, /## 🚦 Release candidates needing review/, 'except the two headlines, which are always present')
})

test('carried items say they are carried, so a repeat is not read as news', () => {
  const md = composeEntry(FIXTURE())
  assert.match(md, /\*\(carried from 08-16\)\*/)
})

test('the config figure is a count and never item text', () => {
  const md = composeEntry({ ...FIXTURE(), configOpen: 12 })
  assert.match(md, /12 config items/)
  assert.doesNotMatch(md, /\bc0\d{3}\b/, 'that list is local-only and the deploy greps the site for its sentinel')
})

test('it groups by repo so a reader sees where the work went', () => {
  const md = composeEntry(FIXTURE())
  assert.match(md, /\*\*obot\.agent\*\*/)
})

function FIXTURE() {
  return {
    date: '2026-08-18',
    landed: parseLanded('obot.agent', LOG),
    rcs: [{ key: 'jwildfire/open.gismo#10', title: 'open.gismo v0.2.0-RC1', url: 'https://github.com/jwildfire/open.gismo/pull/10', since: '2026-08-17T06:00:00Z' }],
    decisions: [{ key: 'D0019', title: 'Scheduled sessions: what is ready', url: 'https://github.com/jwildfire/obot.roadmap/discussions/222', since: '2026-08-16' }],
    todos: [{ key: 't1', title: 'Arm the 07:00 fold' }],
    configOpen: 10,
    previousEntry: '2026-08-16',
  }
}

test('a direct commit with no pull request does not render a dangling dash', () => {
  const md = composeEntry({
    ...FIXTURE(),
    landed: parseLanded('obot.roadmap', 'abc\t2026-08-18T04:00:00Z\tThe checker cannot mistake an example for the thing'),
  })
  assert.match(md, /- The checker cannot mistake an example for the thing\n/)
  assert.doesNotMatch(md, /for the thing —\n/, 'an em dash with nothing after it reads as a lost link')
})

test('a referenced issue is called a reference, not a closure', () => {
  const md = composeEntry(FIXTURE())
  assert.match(md, /· refs \[#204\]/)
  assert.doesNotMatch(md, /closes \[#204\]/,
    'a squash subject records the numbers, not the keyword — a PR that merely referenced an issue is indistinguishable here')
})
