// A role name is not a role identity — the workspace a session runs in is
// (obot.agent#188).
//
// WHAT HAPPENED. `scripts/test/obot-admiral.test.mjs` ran the real launcher against
// a temporary workspace, the launch branch was reachable, and four genuine
// `claude --bg -n '⚓🤖 obot-admiral'` sessions were created in the machine's real
// job ledger. Every consumer that asks "is this the admiral" asked it of the NAME
// alone, so all four were the admiral:
//
//   - the Agents tab pinned one into the admiral's slot as RUNNING, on the one
//     surface that is supposed to answer "what is each of my roles doing";
//   - `overrun` put two **ADMIRAL KILLED ON A BREACHED BUDGET** headlines on the
//     dashboard and sent a real SIGTERM;
//   - the singleton in `shouldLaunch` held every real launch behind them;
//   - `classify` produced four WAITING wake detections.
//
// Two agents independently diagnosed a runaway launcher from that row before the
// launch log settled it.
//
// WHY THIS IS NOT A NAME MATCH. Excluding the fixtures by their session name, or by
// their `admiralws-`/`fleetws-` temp prefix, would hold only until the next fixture
// picked different ones — and the same population already had two of each: the four
// admirals ran under `fleetws-`, and a fifth sandboxed session from an earlier
// integration run carried the retired `🚦🤖 obot-fleet` tag from
// `~/.claude/jobs/cafb815c/tmp/sweep-sandbox`. The one property all five share is
// structural and none of them can shed: they were not running in this workspace.
// All 110 job records on the machine carry `cwd`, and 104 of them are the workspace
// or a directory inside it.
//
// The condition is POSITIVE, in the house style: a session IS this workspace's role
// when it runs inside this workspace. Unknown is not foreign — a record with no cwd,
// or a caller that names no workspace, falls back to the name exactly as before,
// because a role that vanished from the band on a missing field would read as health.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { inWorkspace, isForeignRole, roleOf, roleOfSession } from '../../lib/roles.mjs'
import { ADMIRAL_NAME } from '../admiral.mjs'

const WS = '/Users/jwildfire/Documents/obot2'

test('a session is in the workspace when it runs in it or under it', () => {
  assert.equal(inWorkspace(WS, WS), true)
  assert.equal(inWorkspace(`${WS}/obot.agent`, WS), true, 'a repo inside the workspace')
  assert.equal(inWorkspace(`${WS}/obot.agent/.claude/worktrees/x`, WS), true, 'a worktree inside it')
  assert.equal(inWorkspace(`${WS}/`, WS), true, 'a trailing slash is not a different directory')
})

test('a session somewhere else is somewhere else, whatever it is called', () => {
  assert.equal(inWorkspace('/var/folders/_9/T/fleetws-skwFFQ', WS), false)
  assert.equal(inWorkspace('/private/var/folders/_9/T/admiralws-QQ', WS), false)
  assert.equal(inWorkspace('/Users/jwildfire/.claude/jobs/cafb815c/tmp/sweep-sandbox', WS), false)
  assert.equal(inWorkspace('/Users/jwildfire/Documents/nbot/scripts', WS), false)
  // The prefix is a path prefix, never a string prefix: a sibling whose name starts
  // with the workspace's is not inside it.
  assert.equal(inWorkspace('/Users/jwildfire/Documents/obot2-worktrees/x', WS), false)
})

test('unknown is a third answer, and it is not false', () => {
  // A record with no cwd, or a caller with no workspace to compare against. Failing
  // closed here would drop a real role out of the pinned band the first time a field
  // went missing, and an absent row reads as health.
  assert.equal(inWorkspace(null, WS), null)
  assert.equal(inWorkspace(WS, null), null)
  assert.equal(inWorkspace('', ''), null)
})

test('a role session is its role; the same name from outside the workspace is not', () => {
  const real = { name: ADMIRAL_NAME, cwd: WS }
  const fixture = { name: ADMIRAL_NAME, cwd: '/var/folders/_9/T/fleetws-skwFFQ' }
  assert.equal(roleOfSession(real, { workspace: WS })?.short, 'admiral')
  assert.equal(roleOfSession(fixture, { workspace: WS }), null, 'it wears the name; it is not the role')
  // And the name question still answers the way it always did, because that is a
  // different question and other callers still ask it.
  assert.equal(roleOf(fixture.name)?.short, 'admiral')
})

test('the retired tag is caught by the same structure, with no rule of its own', () => {
  // The sandboxed session from the earlier integration run carried 🚦🤖 obot-fleet.
  // Nothing here mentions it: it is foreign for the reason every fixture is foreign.
  const old = { name: '\u{1F6A6}\u{1F916} obot-fleet', cwd: '/Users/jwildfire/.claude/jobs/cafb815c/tmp/sweep-sandbox' }
  assert.equal(roleOf(old.name)?.short, 'admiral', 'it still resolves to the role by name')
  assert.equal(roleOfSession(old, { workspace: WS }), null, 'but it is not this workspace\'s admiral')
})

test('a session with no cwd falls back to the name, and says nothing false', () => {
  const bare = { name: ADMIRAL_NAME }
  assert.equal(roleOfSession(bare, { workspace: WS })?.short, 'admiral')
  assert.equal(isForeignRole(bare, { workspace: WS }), false, 'unknown is not a finding')
})

test('a session with no workspace to compare against is unchanged behaviour', () => {
  const fixture = { name: ADMIRAL_NAME, cwd: '/var/folders/_9/T/fleetws-skwFFQ' }
  assert.equal(roleOfSession(fixture)?.short, 'admiral', 'no workspace named, so nothing to be outside of')
  assert.equal(isForeignRole(fixture), false)
})

test('a worker is never a foreign ROLE — it is not a role at all', () => {
  const worker = { name: '\u{1F46F}\u{1F916} W0040 fixture', cwd: '/var/folders/_9/T/anything' }
  assert.equal(isForeignRole(worker, { workspace: WS }), false)
  assert.equal(roleOfSession(worker, { workspace: WS }), null)
})

test('roleOfSession reads a row label as readily as a job name', () => {
  // The dashboard's rows carry `label`; the job ledger carries `name`. One function
  // answers for both, or the two views drift on the question that matters most.
  assert.equal(roleOfSession({ label: ADMIRAL_NAME, cwd: WS }, { workspace: WS })?.short, 'admiral')
  assert.equal(roleOfSession({ label: ADMIRAL_NAME, cwd: '/tmp/x' }, { workspace: WS }), null)
})
