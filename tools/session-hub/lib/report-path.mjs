// Where a frozen session report is allowed to land (obot.agent#201).
//
// The slug comes from the marker's `session #N`, defaulting to 1 when there is
// no marker — and there has been no marker since 2026-08-04. So every session of
// a day resolved to the same slug, and `--report` wrote over the previous
// session's frozen operational record. It produced a correct-looking file every
// time, which is why nobody saw it.
//
// The evidence that it used to work is in the hub: reports/sessions/ holds
// 2026-07-24.html beside 2026-07-24-3.html and 2026-08-04.html beside
// 2026-08-04-2.html, from when the marker was still being written by hand.
//
// The rule is the safe direction. Overwriting is correct ONLY when it is the
// same session re-rendering, which is decided by comparing the boundary this
// render is scoped to against the one recorded in the file already there. When
// that cannot be established — including every file written during the silent
// two weeks, which carry no boundary at all — a free suffix is taken instead.
// A stray extra report is a far cheaper mistake than a destroyed one.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/** Stamped into every report so a later render can tell whose it is. */
export const BOUNDARY_ATTR = 'data-session-start'

const recordedBoundary = (file) => {
  try {
    const m = readFileSync(file, 'utf8').match(new RegExp(`${BOUNDARY_ATTR}="([^"]+)"`))
    return m ? m[1] : null
  } catch {
    return null
  }
}

/**
 * @returns {{ path, reused: boolean, explicit: boolean, why: string|null }}
 */
export function reportPath({ hub, slug, boundaryStart, explicitOut = null }) {
  if (explicitOut) return { path: explicitOut, reused: false, explicit: true, why: null }

  const dir = join(hub, 'reports', 'sessions')
  const first = join(dir, `${slug}.html`)
  if (!existsSync(first)) return { path: first, reused: false, explicit: false, why: null }

  if (boundaryStart && recordedBoundary(first) === boundaryStart) {
    return { path: first, reused: true, explicit: false, why: null }
  }

  for (let n = 2; n < 100; n++) {
    const candidate = join(dir, `${slug}-${n}.html`)
    if (!existsSync(candidate)) {
      return {
        path: candidate,
        reused: false,
        explicit: false,
        why: `${slug}.html already holds a different session's record — writing ${slug}-${n}.html rather than overwriting it`,
      }
    }
  }
  throw new Error(`reportPath: ${slug} has 99 reports already; refusing to guess`)
}
