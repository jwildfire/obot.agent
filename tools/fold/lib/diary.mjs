// The day's diary entry (obot.agent#202, under jwildfire/obot.roadmap#238).
//
// There is no entry for 17 August. That day carried ninety-one commits and a
// shipped release. The diary stopped because its trigger was the end of a
// session and the standing sessions do not end — and the diary is the R/Pharma
// keynote's raw material, which is why its quality has to be independent of
// whether anyone reads it daily.
//
// IT IS WRITTEN FOR SOMEONE WHO WAS NOT PRESENT. That is the whole register, and
// this house makes it cheap: every squash subject here is already a declarative
// outcome sentence — "A quiet night is provably quiet: the fold decides whether
// there is anything to say (#200) (#208)" — so an entry built from them reads as
// prose rather than as a changelog of identifiers. The composer selects, orders
// and links. It never summarises, because a composer that summarises is one that
// can grow, and monotonic growth from 136 to 865 words is the measured failure
// signature of the daily summaries this replaces.
//
// The narrative paragraph is the one genuinely authored part of an entry, and it
// is left MARKED AS OWED rather than faked. Writing it needs a model; starting an
// agent on a clock is A2 and A2 is not enabled (D0019, answer "not yet"). A
// mechanically-composed record on the morning after is the guarantee that was
// lost. An unwritten one, because no model was available, is where we are now.

/** The line any session can search for to find an entry still wanting its lead. */
export const NARRATIVE_OWED = /_Narrative not yet written — this entry was composed by the 07:00 fold\._/

const REF = /\(#(\d+(?:,\s*#\d+)*)\)/g

/**
 * Parse `sha\tISO\tsubject` lines into landed work.
 *
 * The squash subject convention here is `Title (#issue) (#pr)`: the LAST
 * parenthesised group is the pull request and any earlier ones are the issues it
 * closed. A subject with neither still counts as landed — it is work that
 * happened, and dropping it because it lacks an identifier would be the record
 * losing exactly the changes nobody filed.
 */
export function parseLanded(repo, log) {
  const out = []
  for (const line of String(log ?? '').split('\n').filter((l) => l.trim())) {
    const [sha, at, ...rest] = line.split('\t')
    const subject = rest.join('\t')
    const groups = [...subject.matchAll(REF)]
    const nums = groups.map((g) => g[1].split(',').map((n) => Number(n.replace(/\D/g, ''))))
    const flat = nums.flat()
    const pr = flat.length ? flat[flat.length - 1] : null
    const issues = flat.slice(0, -1)
    out.push({
      repo,
      sha,
      at,
      pr,
      issues,
      title: subject.replace(REF, '').replace(/\s+$/, '').trim(),
    })
  }
  return out
}

const ghUrl = (repo, kind, n) => `https://github.com/jwildfire/${repo}/${kind}/${n}`
const mmdd = (d) => (d ?? '').slice(5, 10)

/**
 * The entry, in the shape the last two entries already use, minus every section
 * this composer cannot fill honestly.
 *
 * An empty heading is not neutral — it reads as "nothing happened here", which
 * is a claim. The two headline sections are the exception: they are always
 * present because a missing heading is indistinguishable from a dropped one, and
 * they are the part he scans first.
 */
export function composeEntry({
  date, landed = [], rcs = [], decisions = [], todos = [], configOpen = null, previousEntry = null,
}) {
  const byRepo = new Map()
  for (const l of landed) {
    if (!byRepo.has(l.repo)) byRepo.set(l.repo, [])
    byRepo.get(l.repo).push(l)
  }

  const L = []
  L.push(`# Daily diary: ${date}`)
  L.push('')
  L.push(`<span class="meta">${meta({ landed, byRepo, rcs, decisions })}</span>`)
  L.push('')
  L.push(`📊 [Session report](../reports/sessions/${date}.html)`)
  L.push('')
  L.push('_Narrative not yet written — this entry was composed by the 07:00 fold._')
  L.push('_Posted unattended; not yet reviewed by @jwildfire._')
  L.push('')

  L.push('## 🚦 Release candidates needing review')
  L.push('')
  if (!rcs.length) L.push('_None waiting on you._')
  for (const r of rcs) {
    L.push(`- **${r.title}** — [${short(r.key)}](${r.url})${carried(r.since, date, previousEntry)}`)
  }
  L.push('')

  L.push('## 🧭 Decisions needed')
  L.push('')
  if (!decisions.length) L.push('_None waiting on you._')
  for (const d of decisions) {
    L.push(`- **${d.title}** — ${d.key}, [answer in Q&A](${d.url})${carried(d.since, date, previousEntry)}`)
  }
  L.push('')

  if (landed.length) {
    L.push('## What landed')
    L.push('')
    for (const [repo, items] of byRepo) {
      L.push(`**${repo}**`)
      L.push('')
      for (const i of items) {
        const link = i.pr ? ` [${repo}#${i.pr}](${ghUrl(repo, 'pull', i.pr)})` : ''
        // "refs", not "closes". A squash subject records the numbers, not the
        // keyword that produced them — a PR that merely referenced an issue looks
        // identical here to one that closed it, and asserting the stronger of the
        // two is a claim the source cannot support.
        const closes = i.issues.length
          ? ` · refs ${i.issues.map((n) => `[#${n}](${ghUrl(repo, 'issues', n)})`).join(', ')}`
          : ''
        // A direct commit to main carries no pull request, and a dangling em
        // dash with nothing after it reads as a line that lost its link.
        const tail = link || closes ? ` —${link}${closes}` : ''
        L.push(`- ${i.title}${tail}`)
      }
      L.push('')
    }
  }

  const asks = [...todos.map((t) => `- ${t.title}`)]
  if (configOpen) {
    asks.push(`- ${configOpen} config items are open on the local list — the count only; the list never leaves the machine.`)
  }
  if (asks.length) {
    L.push('## 🙋 ToDo')
    L.push('')
    L.push(...asks)
    L.push('')
  }

  return L.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n'
}

function meta({ landed, byRepo, rcs, decisions }) {
  const bits = []
  bits.push(landed.length
    ? `${landed.length} change${landed.length === 1 ? '' : 's'} landed across ${byRepo.size} repo${byRepo.size === 1 ? '' : 's'} overnight` +
      // "most recent", not "largest": the list is ordered by time and nothing
      // here measures size. A superlative the data cannot support is the kind of
      // small false claim that costs a record its credibility.
      (landed[0] ? `, most recently: ${landed[0].title.replace(/[<>]/g, '')}` : '')
    : 'No changes landed overnight')
  const waiting = []
  if (rcs.length) waiting.push(`${rcs.length} release candidate${rcs.length === 1 ? '' : 's'}`)
  if (decisions.length) waiting.push(`${decisions.length} decision${decisions.length === 1 ? '' : 's'}`)
  bits.push(waiting.length
    ? `${waiting.join(' and ')} ${waiting.length === 1 && !rcs.length ? 'is' : 'are'} waiting on @jwildfire`
    : 'Nothing is waiting on @jwildfire')
  return bits.join('. ') + '.'
}

const short = (key) => String(key).replace(/^jwildfire\//, '')

// "Carried" is what stops a cumulative queue reading as news every morning. The
// summaries this replaces re-listed the same eight unchanged pull requests night
// after night with no indication they were the same ones.
function carried(since, date, previousEntry) {
  if (!since || !previousEntry) return ''
  const day = String(since).slice(0, 10)
  return day < date ? ` *(carried from ${mmdd(previousEntry)})*` : ''
}
