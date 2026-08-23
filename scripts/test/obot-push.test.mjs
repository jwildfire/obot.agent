// The push lane, and the two ways it is allowed to fail (obot.agent#241, under
// jwildfire/obot.roadmap#260), plus the three states a remote can be in (obot.agent#320).
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
//
// THE THREE STATES (#320). The org check used to read the remote's URL text as the
// authority on who owns the repository, and for a transferred repository that text is
// stale by design and stays stale for as long as the clone lives. `gsm.safety`'s
// origin still says `obot-claw/gsm.safety`; GitHub resolves it to
// `jwildfire/gsm.safety`. Refusing there did not merely block a correct write — it
// routed the agent toward `git push`, which is the one unguarded path and the exact
// thing this wrapper exists to close. So the decision is made on where the remote
// RESOLVES, and a remote has three states, not two:
//
//   resolves inside the org  -> push, to the resolved name
//   resolves outside it      -> refuse, naming the resolved owner
//   cannot be resolved       -> refuse, for a reason that says so in its own words
//
// The third is the one this program keeps finding collapsed into one of the others,
// and collapsing it permissively here costs a push recorded as @jwildfire forever.
// Every test below says which of the three it is proving.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, chmodSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), '../..')
const PUSH = join(ROOT, 'scripts/obot-push')

/**
 * Run the wrapper with a stub minter, a stub git and a stub gh, capturing what it did.
 *
 * `remotes` is the clone's remote table, name -> URL. `resolve` is what GitHub says
 * about a slug: `'owner/name'`, `{ full_name, archived }`, the string `'FAIL'` for a
 * call that errors the way a 404 or a dead network does, or any other raw string for
 * an answer that is neither an owner/name nor an error. Anything not named resolves to
 * itself, which is the ordinary case — a remote whose URL is already the truth.
 */
function run({
  args = [],
  token = 'ghs_stub',
  remote = 'git@github.com:jwildfire/obot.agent.git',
  remotes = null,
  resolve = {},
  gitExit = 0,
  env = '',
} = {}) {
  const bin = mkdtempSync(join(tmpdir(), 'push-bin-'))
  const log = join(bin, 'git.log')
  const ghLog = join(bin, 'gh.log')
  const table = remotes ?? { origin: remote }

  writeFileSync(join(bin, 'obot-app-token'), `#!/bin/sh\nprintf '%s' '${token}'\n`)
  chmodSync(join(bin, 'obot-app-token'), 0o755)

  // A git stub that answers the reads the wrapper makes — the remote table, the
  // branch name — and records the push.
  const getUrl = Object.entries(table)
    .map(([n, u]) => `  if [ "$3" = "${n}" ]; then printf '%s\\n' '${u}'; exit 0; fi`)
    .join('\n')
  writeFileSync(join(bin, 'git'), `#!/bin/sh
if [ "$1" = "remote" ] && [ "$2" = "get-url" ]; then
${getUrl}
  echo "error: No such remote '$3'" >&2; exit 2
fi
if [ "$1" = "remote" ] && [ -z "$2" ]; then
  printf '%s\\n' ${Object.keys(table).map((n) => `'${n}'`).join(' ')}
  exit 0
fi
if [ "$1" = "rev-parse" ]; then printf '%s\\n' 'w0060-branch'; exit 0; fi
echo "$@" >> '${log}'
exit ${gitExit}
`)
  chmodSync(join(bin, 'git'), 0o755)

  // A gh stub answering `gh api repos/<owner>/<name>`. It records the call AND the
  // credential it was handed, because resolving as somebody else is its own bug.
  const cases = Object.entries(resolve).map(([slug, answer]) => {
    if (answer === 'FAIL') {
      return `  *"repos/${slug}"*) echo "gh: Not Found (HTTP 404)" >&2; exit 1 ;;`
    }
    if (answer === 'NOISY_FAIL') {
      // What real gh does: the response body, then its own diagnosis, no newline between.
      return `  *"repos/${slug}"*) printf '%s' '{"message":"Not Found","documentation_url":"https://docs.github.com/rest/repos/repos#get-a-repository","status":"404"}' >&2; echo "gh: Not Found (HTTP 404)" >&2; exit 1 ;;`
    }
    const full = typeof answer === 'string' ? answer : answer.full_name
    const archived = typeof answer === 'string' ? false : !!answer.archived
    // A raw answer that is not an owner/name is passed through verbatim, so the
    // ambiguous case can be exercised.
    return `  *"repos/${slug}"*) printf '%s\\t%s\\n' '${full}' '${archived}'; exit 0 ;;`
  }).join('\n')
  writeFileSync(join(bin, 'gh'), `#!/bin/sh
printf '%s\\n' "$*" >> '${ghLog}'
printf 'GH_TOKEN=%s\\n' "\${GH_TOKEN-unset}" >> '${ghLog}'
case "$*" in
${cases}
esac
# Anything not named resolves to itself: the remote whose URL is already the truth.
slug=$(printf '%s' "$2" | sed 's#^repos/##')
printf '%s\\t%s\\n' "$slug" 'false'
exit 0
`)
  chmodSync(join(bin, 'gh'), 0o755)

  const res = execFileSync('/bin/sh', ['-c',
    `${env} PATH='${bin}':"$PATH" OBOT_APP_TOKEN_BIN='${bin}/obot-app-token' '${PUSH}' ${args.join(' ')} 2>&1; echo "exit=$?"`,
  ], { encoding: 'utf8' })
  const read = (f) => { try { return readFileSync(f, 'utf8') } catch { return '' } }
  return { out: res, code: Number(/exit=(\d+)/.exec(res)[1]), pushed: read(log), gh: read(ghLog) }
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
  assert.equal(r.gh, '', 'and nothing was asked of GitHub on a credential we do not have')
})

test('an https remote is handled as well as an ssh one', () => {
  const r = run({ remote: 'https://github.com/jwildfire/obot.roadmap.git' })
  assert.equal(r.code, 0, r.out)
  assert.match(r.pushed, /github\.com\/jwildfire\/obot\.roadmap\.git/)
})

test('-u never reaches git push, because it would write the token into .git/config', () => {
  // Found by using the wrapper for the first time, on this very branch: `git push -u
  // <url>` records the URL it was given as branch.<name>.remote, and that URL carries a
  // live installation token. It sat in .git/config until it was scrubbed by hand. The
  // flag is now handled here — pushed without it, then the branch is pointed at the
  // NAMED remote afterwards.
  const r = run({ args: ['-u'] })
  assert.equal(r.code, 0, r.out)
  const pushLine = r.pushed.split('\n').find((l) => l.includes('x-access-token'))
  assert.ok(pushLine, 'the push still happens over the tokenised URL')
  assert.doesNotMatch(pushLine, /(^|\s)(-u|--set-upstream)(\s|$)/, 'but never with -u')
  // The tracking branch is set separately, against the remote NAME.
  assert.match(r.pushed, /^branch --quiet --set-upstream-to=origin\/w0060-branch/m)
  assert.match(r.pushed, /^fetch -q origin w0060-branch/m)
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

// ---------------------------------------------------------------------------
// STATE ONE: it resolves inside the org.
// ---------------------------------------------------------------------------

test('state 1 — a transferred remote whose URL names the old org is pushed, to its real name', () => {
  // gsm.safety, exactly as the clone stands: origin says obot-claw, GitHub says
  // jwildfire. Two release candidates for a clinical package were held on this.
  const r = run({
    remotes: {
      origin: 'git@github.com:obot-claw/gsm.safety.git',
      jwildfire: 'git@github.com:jwildfire/gsm.safety.git',
    },
    resolve: { 'obot-claw/gsm.safety': 'jwildfire/gsm.safety' },
  })
  assert.equal(r.code, 0, r.out)
  // The push goes to the name GitHub gave us, not the stale one we were handed. A
  // redirect would have carried it there anyway; relying on that is relying on a
  // redirect nobody has promised to keep.
  assert.match(r.pushed, /https:\/\/x-access-token:ghs_stub@github\.com\/jwildfire\/gsm\.safety\.git/)
  assert.doesNotMatch(r.pushed, /obot-claw/, 'nothing is pushed to the stale name')
  assert.doesNotMatch(r.out, /ghs_stub/)
})

test('state 1 — the redirect is said out loud, so a transcript records which repo was written', () => {
  const r = run({
    remotes: { origin: 'git@github.com:obot-claw/gsm.safety.git' },
    resolve: { 'obot-claw/gsm.safety': 'jwildfire/gsm.safety' },
  })
  assert.equal(r.code, 0, r.out)
  assert.match(r.out, /obot-claw\/gsm\.safety/)
  assert.match(r.out, /jwildfire\/gsm\.safety/)
})

test('state 1 — resolution authenticates as the app, not as whatever is ambient', () => {
  const r = run({ resolve: { 'jwildfire/obot.agent': 'jwildfire/obot.agent' } })
  assert.equal(r.code, 0, r.out)
  assert.match(r.gh, /^GH_TOKEN=ghs_stub$/m, 'the minted token is the credential the read uses')
})

// ---------------------------------------------------------------------------
// STATE TWO: it resolves outside the org.
// ---------------------------------------------------------------------------

test('state 2 — a remote genuinely outside the org is still refused, not attempted', () => {
  // open.gismo: origin is Gilead-BioStats upstream, and it resolves to itself. The
  // standing rule is read-only there, with no exceptions.
  const r = run({
    remotes: {
      origin: 'git@github.com:Gilead-BioStats/open.gismo.git',
      fork: 'git@github.com:jwildfire/open.gismo.git',
    },
    resolve: { 'Gilead-BioStats/open.gismo': 'Gilead-BioStats/open.gismo' },
  })
  assert.notEqual(r.code, 0)
  assert.equal(r.pushed, '', 'read-only outside the org, with no exceptions')
  assert.match(r.out, /Gilead-BioStats\/open\.gismo/)
})

test('state 2 — a remote that resolves outside is refused even when its URL says jwildfire', () => {
  // The permissive half of the same stale-text bug. A URL that reads `jwildfire/...`
  // is no more authoritative than one that reads `obot-claw/...`; if the repository
  // has left the account, the text says so last. Trusting it here would be the exact
  // defect #320 is about, pointed the other way.
  const r = run({
    remotes: { origin: 'git@github.com:jwildfire/gone.git' },
    resolve: { 'jwildfire/gone': 'somebody-else/gone' },
  })
  assert.notEqual(r.code, 0)
  assert.equal(r.pushed, '')
  assert.match(r.out, /somebody-else\/gone/)
})

test('state 2 — the refusal names the remote in this clone that does point at the right place', () => {
  // The whole point. An agent told "refused, with no exceptions" in a clone that has a
  // writable remote sitting next to the one it reached for goes and types `git push`.
  const r = run({
    remotes: {
      origin: 'git@github.com:Gilead-BioStats/open.gismo.git',
      fork: 'git@github.com:jwildfire/open.gismo.git',
    },
    resolve: {
      'Gilead-BioStats/open.gismo': 'Gilead-BioStats/open.gismo',
      'jwildfire/open.gismo': 'jwildfire/open.gismo',
    },
  })
  assert.notEqual(r.code, 0)
  assert.match(r.out, /fork/, 'the remote that works is named')
  assert.match(r.out, /OBOT_PUSH_REMOTE=fork/, 'and so is the way to use it')
  assert.equal(r.pushed, '')
})

test('state 2 — safety-histogram, as the clone stands: both copies archived, and it says so', () => {
  // The clone where the temptation is highest: the repository is real, the work is
  // real, and the only thing wrong looks like which remote was reached for. Measured
  // against GitHub on 2026-08-22, BOTH copies are archived — `obot-claw/…` and the
  // `jwildfire/…` the second remote points at — so there is no way out here, and the
  // brief's assumption that the second remote was one is wrong.
  //
  // `archived` is not a decision input; the refusal is on the owner. But it is in the
  // same answer we already have, and a push to an archived repository fails at the far
  // end whatever this guard decides, so the message says it rather than leaving the
  // reader to discover it.
  const r = run({
    remotes: {
      origin: 'git@github.com:obot-claw/safety-histogram.git',
      jwildfire: 'git@github.com:jwildfire/safety-histogram.git',
    },
    resolve: {
      'obot-claw/safety-histogram': { full_name: 'obot-claw/safety-histogram', archived: true },
      'jwildfire/safety-histogram': { full_name: 'jwildfire/safety-histogram', archived: true },
    },
  })
  assert.notEqual(r.code, 0)
  assert.equal(r.pushed, '')
  assert.match(r.out, /obot-claw\/safety-histogram/)
  assert.match(r.out, /archived/i)
  assert.doesNotMatch(r.out, /OBOT_PUSH_REMOTE=/, 'an archived target is never offered as the remedy')
})

test('state 2 — an in-org remote that is archived is reported as that, not as "none found"', () => {
  // Two different facts, and collapsing them is this program's recurring defect in
  // miniature: "no remote here points inside the org" would be false in a clone whose
  // second remote points at an archived repository inside it. The reader needs to know
  // the difference, because one of them means look somewhere else entirely and the
  // other means the repository is closed.
  const r = run({
    remotes: {
      origin: 'git@github.com:obot-claw/safety-histogram.git',
      jwildfire: 'git@github.com:jwildfire/safety-histogram.git',
    },
    resolve: {
      'obot-claw/safety-histogram': { full_name: 'obot-claw/safety-histogram', archived: true },
      'jwildfire/safety-histogram': { full_name: 'jwildfire/safety-histogram', archived: true },
    },
  })
  assert.match(r.out, /jwildfire\/safety-histogram/, 'the in-org remote it did find is named')
  assert.doesNotMatch(r.out, /No remote in this clone resolves inside/,
    'because one does — it just cannot accept a push')
})

test('state 2 — with no better remote in the clone, it says to hand the change over', () => {
  const r = run({
    remotes: { origin: 'git@github.com:Gilead-BioStats/open.gismo.git' },
    resolve: { 'Gilead-BioStats/open.gismo': 'Gilead-BioStats/open.gismo' },
  })
  assert.notEqual(r.code, 0)
  assert.match(r.out, /@jwildfire/)
  assert.doesNotMatch(r.out, /OBOT_PUSH_REMOTE=/, 'no remedy is invented where none exists')
})

test('state 2 — an archived jwildfire remote is not offered as the way out', () => {
  // Suggesting a target that cannot accept a push is worse than suggesting nothing:
  // it spends the agent's next attempt and then fails at the far end.
  const r = run({
    remotes: {
      origin: 'git@github.com:Gilead-BioStats/open.gismo.git',
      fork: 'git@github.com:jwildfire/open.gismo.git',
    },
    resolve: {
      'Gilead-BioStats/open.gismo': 'Gilead-BioStats/open.gismo',
      'jwildfire/open.gismo': { full_name: 'jwildfire/open.gismo', archived: true },
    },
  })
  assert.notEqual(r.code, 0)
  assert.doesNotMatch(r.out, /OBOT_PUSH_REMOTE=fork/)
})

// ---------------------------------------------------------------------------
// STATE THREE: it cannot be resolved. The state this program keeps finding
// collapsed into one of the other two.
// ---------------------------------------------------------------------------

test('state 3 — a remote that cannot be resolved refuses, and says that is why', () => {
  // No network, a repository the credential cannot see, a 404. An unresolvable remote
  // is not a jwildfire remote. The reason has to be its own words, or the refusal
  // reads as "outside the org" and somebody goes looking for a transfer that never
  // happened.
  const r = run({
    remotes: { origin: 'git@github.com:jwildfire/obot.agent.git' },
    resolve: { 'jwildfire/obot.agent': 'FAIL' },
  })
  assert.notEqual(r.code, 0)
  assert.equal(r.pushed, '', 'nothing is pushed on an answer we never got')
  assert.match(r.out, /could not be resolved/i)
  assert.doesNotMatch(r.out, /writes outside the jwildfire org/,
    'the unresolvable case is distinguishable from the refused-owner case')
})

test('state 3 — the underlying failure is quoted, not swallowed', () => {
  const r = run({
    remotes: { origin: 'git@github.com:jwildfire/obot.agent.git' },
    resolve: { 'jwildfire/obot.agent': 'FAIL' },
  })
  assert.match(r.out, /404/, 'what GitHub actually said survives to the reader')
})

test('state 3 — the quoted failure is the diagnosis, not the raw response body', () => {
  // `gh` prints the JSON body and then its own one-line reading of it. Against real
  // GitHub that made the first line of the refusal a wall of `documentation_url`, with
  // the part a reader needs at the end of it. The status survives; the body does not.
  const r = run({
    remotes: { origin: 'git@github.com:jwildfire/nope.git' },
    resolve: { 'jwildfire/nope': 'NOISY_FAIL' },
  })
  assert.notEqual(r.code, 0)
  assert.match(r.out, /HTTP 404/)
  assert.doesNotMatch(r.out, /documentation_url/, 'the response body is noise in a refusal')
})

test('state 3 — an answer that is not an owner/name is treated as no answer at all', () => {
  // `.full_name` absent, an HTML error page, a proxy interstitial: an ambiguous answer
  // is an unresolved one, and the fail-closed rule applies to it identically.
  const r = run({
    remotes: { origin: 'git@github.com:jwildfire/obot.agent.git' },
    resolve: { 'jwildfire/obot.agent': 'null' },
  })
  assert.notEqual(r.code, 0)
  assert.equal(r.pushed, '')
  assert.match(r.out, /could not be resolved/i)
})

test('state 3 — with no way to ask GitHub at all, it refuses rather than guessing', () => {
  // `gh` missing is the same class as the network being down: the question cannot be
  // asked, so the answer is not "probably fine".
  const r = run({
    env: "OBOT_PUSH_GH_BIN='/nonexistent/gh'",
    remotes: { origin: 'git@github.com:jwildfire/obot.agent.git' },
  })
  assert.notEqual(r.code, 0)
  assert.equal(r.pushed, '')
  assert.match(r.out, /could not be resolved/i)
})

test('state 3 — a remote it could not CHECK is not reported as one it checked and ruled out', () => {
  // The same collapse one layer down, and this program's most-repeated defect. When
  // resolution is broken, every other remote in the clone is unresolvable too — and
  // saying "no remote in this clone resolves inside the org" then states as measured
  // absence a thing that was never looked at. Watched live: with the resolver removed,
  // gsm.safety refused (correctly) and claimed its sibling remote did not point inside
  // the org (falsely — it does).
  const r = run({
    env: "OBOT_PUSH_GH_BIN='/nonexistent/gh'",
    remotes: {
      origin: 'git@github.com:obot-claw/gsm.safety.git',
      jwildfire: 'git@github.com:jwildfire/gsm.safety.git',
    },
  })
  assert.notEqual(r.code, 0)
  assert.equal(r.pushed, '')
  assert.doesNotMatch(r.out, /No remote in this clone resolves inside/,
    'nothing was measured, so nothing can be reported as absent')
  assert.match(r.out, /jwildfire/, 'the remote it could not check is named')
  assert.match(r.out, /could not be resolved either/i)
})

test('state 3 — resolution failure never becomes a permissive default, even for the obvious repo', () => {
  // The one that would be tempting to special-case: obot.agent's own origin, written
  // jwildfire, obviously fine. It still refuses, because "obviously fine" is a
  // judgement made from the URL text and that is the thing that is not authoritative.
  const r = run({ resolve: { 'jwildfire/obot.agent': 'FAIL' } })
  assert.notEqual(r.code, 0)
  assert.equal(r.pushed, '')
})
