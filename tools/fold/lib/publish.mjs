// Getting the entry off this machine (obot.agent#202, under jwildfire/obot.roadmap#238).
//
// An entry that exists only in a local clone is not a record — the diary is
// published, and @jwildfire reads it on the deployed site rather than in a
// working copy. But publishing is the one part of the fold that leaves the
// machine, so every failure here is reported rather than swallowed, and none of
// it is assumed to have worked because a command exited zero.
//
// The credential is the obotclaw app token, minted per push. Whether the
// Keychain read behind it succeeds under launchd — which has no user session and
// no shell profile — is NOT established, because the schedule is not armed. It is
// named as a known unknown rather than assumed: a mint that fails leaves the
// entry written on disk and says so, and the next run picks it up.
import { execFileSync } from 'node:child_process'
import { existsSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'

const git = (cwd, args, extra = {}) =>
  execFileSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8', timeout: 120000, stdio: ['ignore', 'pipe', 'pipe'], ...extra,
  })

/**
 * Write the entry, never over one that already exists.
 *
 * A hand-written entry is the better artefact and the fold must not replace one.
 * The same rule protects a re-run: the second fold of a day finds the first
 * fold's entry and leaves it alone.
 */
export function writeEntry(hub, date, markdown) {
  const file = join(hub, 'diary', `${date}.md`)
  if (existsSync(file)) return { file, written: false, why: 'an entry for this day already exists' }
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, markdown)
  return { file, written: true, why: null }
}

/**
 * Commit and push the entry under the standing hub grant (direct commits to
 * main for standard updates, @jwildfire 2026-07-04 — diary entries are named in
 * it by name).
 *
 * Returns what happened. Nothing here throws into the fold: a publish that fails
 * must not cost the record, which is already on disk by this point.
 */
export function publishEntry(hub, { date, paths, mintToken, message }) {
  const out = { committed: false, pushed: false, why: null, sha: null }
  try {
    const dirty = git(hub, ['status', '--porcelain', ...paths]).trim()
    if (!dirty) { out.why = 'nothing to commit — the entry was already committed'; return out }
  } catch (e) {
    out.why = `could not read the hub clone: ${first(e)}`
    return out
  }

  // Never commit a hub clone that is carrying somebody else's work. The fold
  // stages only its own paths, and refuses if the tree holds unrelated changes
  // it would sweep into the same commit.
  try {
    const all = git(hub, ['status', '--porcelain']).trim().split('\n').filter(Boolean)
    const mine = new Set(paths.map((p) => p.replace(/^\.\//, '')))
    const foreign = all.filter((l) => ![...mine].some((p) => l.includes(p)))
    if (foreign.length) {
      out.why = `the hub clone carries ${foreign.length} unrelated change(s) — refusing to commit into someone else's work`
      return out
    }
  } catch (e) {
    out.why = `could not inspect the hub clone: ${first(e)}`
    return out
  }

  try {
    git(hub, ['add', ...paths])
    git(hub, [
      '-c', 'user.name=obotclaw[bot]',
      '-c', 'user.email=219968887+obotclaw[bot]@users.noreply.github.com',
      'commit', '-q', '-m', message,
    ])
    out.committed = true
    out.sha = git(hub, ['rev-parse', 'HEAD']).trim().slice(0, 7)
  } catch (e) {
    out.why = `commit failed: ${first(e)}`
    return out
  }

  let token = null
  try {
    token = mintToken()
  } catch (e) {
    out.why = `committed ${out.sha} but could not mint a token: ${first(e)}`
    return out
  }
  if (!token) {
    // The empty-token case is called out by name: an empty credential falls back
    // to the ambient keyring, and the write lands as @jwildfire (obot.agent#207).
    out.why = `committed ${out.sha} but the token mint returned nothing — refusing to push on whatever credential is ambient`
    return out
  }

  try {
    git(hub, ['push', '-q', `https://x-access-token:${token}@github.com/jwildfire/obot.roadmap.git`, 'HEAD:main'])
    out.pushed = true
  } catch (e) {
    out.why = `committed ${out.sha} but the push failed: ${first(e)}`
  }
  return out
}

const first = (e) => String(e.stderr || e.message || e).split('\n')[0].slice(0, 200)
