// The push lane, and the two ways it is allowed to fail (obot.agent#241, under
// jwildfire/obot.roadmap#260).
//
// Every remote in this workspace is SSH, so `git push` authenticates as @jwildfire
// whatever token is in the environment — no token fixes it, because the credential is
// the one the remote uses. The working lane already existed and was already proven:
// tools/fold/lib/publish.mjs pushes to an https://x-access-token:… URL, and the
// repository activity feed shows those pushes as obotclaw[bot] while agent branch
// pushes the same night show as jwildfire.
//
// What this wrapper adds is that nobody types it. The URL is exactly the shape a model
// reconstructs from memory, which is how thirty-eight fabricated user ids got into the
// commit history, and the empty-token fall-through it must avoid is obot.agent#207
// arriving in a third place: an empty credential is not an error to git, it is a
// prompt to fall back on whatever is ambient — @jwildfire's keyring.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, chmodSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const PUSH = join(ROOT, 'scripts/obot-push')

/** Run the wrapper with a stub minter and a stub git, capturing what it did. */
function run({ args = [], token = 'ghs_stub', remote = 'git@github.com:jwildfire/obot.agent.git', gitExit = 0 } = {}) {
  const bin = mkdtempSync(join(tmpdir(), 'push-bin-'))
  const log = join(bin, 'git.log')

  writeFileSync(join(bin, 'obot-app-token'), `#!/bin/sh\nprintf '%s' '${token}'\n`)
  chmodSync(join(bin, 'obot-app-token'), 0o755)

  // A git stub that answers the two reads the wrapper makes and records the push.
  writeFileSync(join(bin, 'git'), `#!/bin/sh
if [ "$1" = "remote" ]; then printf '%s\\n' '${remote}'; exit 0; fi
if [ "$1" = "rev-parse" ]; then printf '%s\\n' 'w0060-branch'; exit 0; fi
echo "$@" >> '${log}'
exit ${gitExit}
`)
  chmodSync(join(bin, 'git'), 0o755)

  const res = execFileSync('/bin/sh', ['-c',
    `PATH='${bin}':"$PATH" OBOT_APP_TOKEN_BIN='${bin}/obot-app-token' '${PUSH}' ${args.join(' ')} 2>&1; echo "exit=$?"`,
  ], { encoding: 'utf8' })
  let pushed = ''
  try { pushed = readFileSync(log, 'utf8') } catch { pushed = '' }
  return { out: res, code: Number(/exit=(\d+)/.exec(res)[1]), pushed }
}

test('it pushes over https with a minted token, never over the SSH remote', () => {
  const r = run({})
  assert.equal(r.code, 0, r.out)
  assert.match(r.pushed, /https:\/\/x-access-token:ghs_stub@github\.com\/jwildfire\/obot\.agent\.git/)
  assert.match(r.pushed, /w0060-branch/)
  // The token must never be echoed: this output goes to a transcript.
  assert.doesNotMatch(r.out, /ghs_stub/)
})

test('an empty token refuses rather than falling through to his credential', () => {
  // obot.agent#207, third instance. An empty credential is not an error to git.
  const r = run({ token: '' })
  assert.notEqual(r.code, 0)
  assert.match(r.out, /mint/i)
  assert.equal(r.pushed, '', 'nothing was pushed on an unminted token')
})

test('a remote outside the jwildfire org is refused, not attempted', () => {
  const r = run({ remote: 'git@github.com:Gilead-BioStats/open.gismo.git' })
  assert.notEqual(r.code, 0)
  assert.match(r.out, /jwildfire/)
  assert.equal(r.pushed, '', 'the standing rule is read-only outside the org, with no exceptions')
})

test('an https remote is handled as well as an ssh one', () => {
  const r = run({ remote: 'https://github.com/jwildfire/obot.roadmap.git' })
  assert.equal(r.code, 0, r.out)
  assert.match(r.pushed, /github\.com\/jwildfire\/obot\.roadmap\.git/)
})

test('a failing push is reported as a failure, not swallowed', () => {
  const r = run({ gitExit: 1 })
  assert.notEqual(r.code, 0)
})

test('--force is refused: a rewrite is his call, not a wrapper default', () => {
  // Two force-pushes inside a three-hour window are part of what #260 measured. The
  // wrapper is the attribution lane; it does not become the lane that makes a rewrite
  // easier to reach for.
  const r = run({ args: ['--force'] })
  assert.notEqual(r.code, 0)
  assert.match(r.out, /force/i)
  assert.equal(r.pushed, '')
})
