// The day boundary the dashboard reads (obot.agent#201, under jwildfire/obot.roadmap#238).
//
// findSessionMarker() in the session hub scopes the Agents and Roadmap-activity
// panels by a marker comment in the day's scratchpad. It was written by hand, by
// the model, as step 3 of interactive session-init — and nobody runs interactive
// session-init any more. The last scratchpad carrying one is 2026-08-04, so the
// dashboard has been scoping to the whole day for two weeks while its own labels
// said "since session start". The only signal was one clause in the page footer.
//
// This is a SECOND writer, not a replacement. session-init still writes its own
// when someone runs it, and #238 retires nothing — obot.roadmap#240 owns that.
//
// Two details that are cheap to get wrong and expensive to have wrong:
//
//   findSessionMarker takes the LAST match in the file, not the first. So the
//   most recently written boundary wins, in both directions, and this writer
//   REPLACES its own previous marker rather than appending a second one — a
//   launchd fire that lands late must not leave two boundaries behind.
//
//   The marker's instant is the FOLD, not midnight. The fold has just folded the
//   overnight work into the diary and the briefing, so the live dashboard's new
//   day starts there. Anchoring at midnight would leave the fold's own subject
//   matter sitting in the panel it was just reported out of.
//
// The time is always passed in by the caller and shelled at the boundary of the
// program — never formatted from a model's idea of the clock (obot.agent#57).
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const NOTES_REL = '.claude/session-notes'

// The marker this writer emits, and the only one it will replace. It is
// deliberately the `session-init` string the reader is anchored on: widening
// that regex would mean a marker the CURRENT session-hub cannot see, and a
// boundary the reader ignores is the bug this task exists to close. The `(fold)`
// tag is what tells a human — and a later cleanup — which writer left it.
export const MARKER_RE = /^<!--\s*session-init\s+\d{4}-\d{2}-\d{2}\s+\d{1,2}:\d{2}\s*\(fold\)\s*-->$/

const SKELETON = (stem) =>
  `# Session scratchpad — ${stem}\n\n## Overview\n\n## Todo\n\n## Notes\n\n## Scaffold\n\n## Session log\n`

/**
 * Write the day boundary into {workspace}/.claude/session-notes/{date}.md.
 *
 * The insertion follows tools/scratchpad-log exactly — read the lines, find the
 * heading, insert, write back — because the scratchpad is shared by the lead,
 * every sibling and every unattended job, and a 07:00 write racing a night
 * sibling's append is a lost-write window this must not widen.
 *
 * @param time  'HH:MM', shelled by the caller. Never formatted here.
 */
export function writeDayBoundary(workspace, { date, time, ifAbsent = false }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) throw new Error(`writeDayBoundary: bad date ${date}`)
  if (!/^\d{1,2}:\d{2}$/.test(time ?? '')) throw new Error(`writeDayBoundary: bad time ${time}`)

  const file = join(workspace, NOTES_REL, `${date}.md`)
  const created = !existsSync(file)
  if (created) {
    mkdirSync(join(workspace, NOTES_REL), { recursive: true })
    writeFileSync(file, SKELETON(date))
  }

  const marker = `<!-- session-init ${date} ${time} (fold) -->`
  const lines = readFileSync(file, 'utf8').split('\n')

  // Replace our own previous marker in place if there is one. Anyone else's —
  // an interactive session-init's — is left exactly where it is.
  const mine = lines.findIndex((l) => MARKER_RE.test(l.trim()))
  if (mine !== -1 && ifAbsent) {
    // The day turned over once. A fold that fires again in the same window —
    // which launchd will do after a missed fire — folded nothing new, so moving
    // the boundary would be churn on a file the lead, every sibling and every
    // unattended job are also writing to.
    return { file, created, time: lines[mine].match(/(\d{1,2}:\d{2})/)?.[1] ?? time, replaced: false, kept: true }
  }
  if (mine !== -1) {
    lines[mine] = marker
    writeFileSync(file, lines.join('\n'))
    return { file, created, time, replaced: true }
  }

  let i = lines.findIndex((l) => l.trim() === '## Overview')
  if (i === -1) {
    // A scratchpad whose sections have drifted still gets a boundary — a silent
    // skip here is the failure being fixed. The heading goes near the TOP, after
    // the title, and never at the end: appended last it would fall inside the
    // span of whatever section is currently last, and `## Session log` is
    // measured by byte length to detect activity. A marker landing in that span
    // makes the next run see growth that is only its own writing.
    const title = lines.findIndex((l) => l.startsWith('# '))
    i = title === -1 ? 0 : title + 1
    lines.splice(i, 0, '', '## Overview')
    i += 1
  }
  let j = i + 1
  while (j < lines.length && !lines[j].startsWith('## ')) j++
  while (j > i + 1 && !lines[j - 1].trim()) j--
  lines.splice(j, 0, marker)

  writeFileSync(file, lines.join('\n'))
  return { file, created, time, replaced: false }
}
