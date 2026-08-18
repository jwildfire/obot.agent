// A fake `claude` and `gh` on PATH, so the admiral launcher's suite can exercise
// the launch DECISION without touching the machine it is running on
// (obot.agent#188).
//
// WHY THIS EXISTS. The suite ran the real launcher, and the real launcher spawns a
// real `claude --bg -n '⚓🤖 obot-admiral'`. Two runs on the evening of 2026-08-17
// therefore created four genuine background sessions in the machine's real job
// ledger, each wearing the admiral's exact session name — and every consumer that
// asks "is this the admiral" asked it of the name. One of them was pinned into the
// admiral's slot on the Agents tab as RUNNING, two produced
// **ADMIRAL KILLED ON A BREACHED BUDGET** headlines on @jwildfire's dashboard, the
// singleton held every real launch behind them, and the wake raised four WAITING
// detections. Nothing was wrong; the surface that exists to say so said otherwise.
//
// THREE THINGS THE REAL BINARIES DID TO THIS SUITE, all of them the same mistake:
//
//   1. `claude --bg` created sessions. Not a hypothetical: four of them.
//   2. `claude agents --json` fed `killAdmiral`, whose fallback joined on the
//      SESSION NAME — so a fixture named `⚓🤖 obot-admiral` could aim a real
//      SIGTERM at the real admiral. That join is gone, and this stub means the
//      suite could not reach a real pid even if it came back.
//   3. `gh pr list` hit GitHub, twice per case, for a condition the cases do not
//      control. Every assertion that the trigger did NOT fire was therefore one
//      idle operational pull request away from failing, and the suite was slow for
//      the privilege. The pull requests are fixtures now, like everything else.
//
// The stub is the floor, not the fix. The launcher's own `OBOT_ADMIRAL_SPAWN=0`
// switch is what the cases actually set; this is what makes a case that forgets it
// harmless anyway.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// One line per call, so a test can assert on what was NOT run — a spawn that never
// happened leaves no other trace, which is the whole property under test here.
const CLAUDE = `#!/usr/bin/env bash
{ printf 'claude %s' "$*" | tr '\\n' ' '; printf '\\n'; } >> "$OBOT_STUB_LOG"
if [ "$1" = "agents" ]; then printf '%s\\n' "\${FAKE_AGENTS_JSON:-[]}"; exit 0; fi
# Anything else is a launch. It records and exits; it never becomes a session.
exit 0
`;

const GH = `#!/usr/bin/env bash
{ printf 'gh %s' "$*" | tr '\\n' ' '; printf '\\n'; } >> "$OBOT_STUB_LOG"
if [ "$1" = "pr" ] && [ "$2" = "list" ]; then
  if [ -n "$FAKE_PR_LIST_FAIL" ]; then exit 1; fi
  printf '%s\\n' "\${FAKE_PR_LIST:-[]}"; exit 0
fi
exit 1
`;

/**
 * The stub bin directory, and a fresh call log per run.
 *
 * PER RUN, not per suite. The launcher spawns DETACHED and exits, so its child
 * writes its line after `spawnSync` has already returned — into whatever log is
 * current when it gets round to it. One shared file therefore let a launch from one
 * case appear inside the next case's assertions, which is the same class of bug as
 * the one under test: a record attributed to the wrong thing.
 */
export function stubHarness() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'obot-admiral-stub-'));
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'claude'), CLAUDE, { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'gh'), GH, { mode: 0o755 });
  let n = 0;
  return { bin, dir, nextLog: () => path.join(dir, `calls-${++n}.log`) };
}

/**
 * An open pull request in the shape `gh pr list --json …` returns.
 *
 * `minsIdle` rather than a timestamp: every threshold in the launcher is minutes
 * against now, and a fixture written as an absolute date is a fixture that changes
 * meaning tomorrow.
 */
export function openPR({ number = 1, minsIdle = 600, base = 'main', isDraft = false,
                         title = 'a pull request that stopped moving',
                         reviewDecision = null, reviewRequests = [], now = Date.now() } = {}) {
  return {
    number,
    title,
    url: `https://github.com/jwildfire/obot.agent/pull/${number}`,
    baseRefName: base,
    isDraft,
    reviewRequests,
    reviewDecision,
    updatedAt: new Date(now - minsIdle * 60000).toISOString(),
  };
}

/** Every call the stubs recorded, oldest first. */
export const calls = (log) => {
  try { return fs.readFileSync(log, 'utf8').split('\n').filter(Boolean); } catch { return []; }
};

/** The calls that would have started a background session. */
export const launches = (log) => calls(log).filter((c) => /^claude .*--bg/.test(c));

/**
 * Wait for the detached child to have written, or for a grace period to pass.
 *
 * A detached spawn is asynchronous by definition, so `launches(log).length === 0`
 * read immediately after `spawnSync` proves nothing — it is equally the answer for
 * "nothing was launched" and for "it has not got there yet". Both directions have to
 * wait: the positive case until the line appears, the negative case for long enough
 * that its absence is a measurement rather than a race.
 */
export async function settle(log, { want = 0, ms = want ? 4000 : 500, step = 25 } = {}) {
  const until = Date.now() + ms;
  for (;;) {
    const got = launches(log);
    // A positive expectation returns the moment it is met; a negative one has to
    // sit out the whole grace period, because that IS the measurement.
    if (want > 0 && got.length >= want) return got;
    if (Date.now() >= until) return got;
    await new Promise((r) => setTimeout(r, step));
  }
}
