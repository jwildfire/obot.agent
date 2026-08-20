// The one thing this lane must never do: post a decision answer of his to a PUBLIC board.
//
// `reminders-to-ideas` has filed everything on the `obot` Reminders list to the hub's
// Ideas discussions since July. jwildfire/obot.roadmap#265 makes the same list the place
// he answers open decisions from a car — so from now on some of what is on it is his
// verbatim decision, which is local-only by construction (`.claude/ops/`, never
// committed, never published).
//
// These run the real script against a stubbed Reminders and a stubbed `gh`, and assert
// on what `gh` was and was not asked to do. A grep for the guard would pass whether or
// not the guard works.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const SCRIPTS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const LANE = path.join(SCRIPTS, 'reminders-to-ideas');
const FS_ = String.fromCharCode(31);
const RS_ = String.fromCharCode(30);

const REG = {
  prefix: 'D',
  artifacts: [{
    id: 'D0022', slug: '2026-08-20-branch-protections', date: '2026-08-20', state: 'open',
    title: 'Branch protections', questions: [{ id: 'D0022.1', code: 'P1', question: 'Which set?' }],
  }],
};

/** A Reminders app, a gh, and an app-token that all record what they were asked. */
function bed(items) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lane-'));
  const bin = path.join(dir, 'bin');
  const hub = path.join(dir, 'hub');
  fs.mkdirSync(bin, { recursive: true });
  fs.mkdirSync(path.join(hub, 'reports', 'decisions'), { recursive: true });
  fs.writeFileSync(path.join(hub, 'reports', 'decisions', 'registry.json'), JSON.stringify(REG));

  const payload = items.map((i) => [i.id, i.name, i.body ?? ''].join(FS_)).join(RS_);
  // `-e` carries the script as an argument (that is how `mark_done` calls it); the
  // read path pipes it on stdin. Reading stdin in both cases hangs the argument form.
  fs.writeFileSync(path.join(bin, 'osascript'), `#!/bin/sh
if [ "$1" = "-e" ]; then script="$2"; else script=$(cat); fi
echo "$script" >> "${dir}/osascript.log"
case "$script" in
  *"repeat with r in"*) printf '%s' '${payload.replace(/'/g, "'\\''")}' ;;
  *) : ;;
esac
`, { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'obot-app-token'), '#!/bin/sh\necho ghs_stubtoken\n', { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'gh'), `#!/bin/sh
printf '%s\n' "$*" | tr '\n' ' ' >> "${dir}/gh.log"
printf '\n' >> "${dir}/gh.log"
echo "https://example.invalid/discussion/1"
`, { mode: 0o755 });
  return { dir, bin, hub, ghLog: path.join(dir, 'gh.log'), osaLog: path.join(dir, 'osascript.log') };
}

const run = (b, env = {}) => spawnSync('bash', [LANE], {
  encoding: 'utf8',
  env: {
    ...process.env,
    PATH: `${b.bin}:${process.env.PATH}`,
    OBOT_WORKSPACE: b.dir,
    OBOT_HUB: b.hub,
    CLAUDE_PROJECT_DIR: b.dir,
    OBOT_APP_TOKEN_CMD: path.join(b.bin, 'obot-app-token'),
    ...env,
  },
});

const ghCalls = (b) => (fs.existsSync(b.ghLog) ? fs.readFileSync(b.ghLog, 'utf8').trim().split('\n').filter(Boolean) : []);
const answers = (b) => {
  const d = path.join(b.dir, '.claude', 'ops', 'answers');
  return fs.existsSync(d) ? fs.readdirSync(d).filter((n) => n.endsWith('.json')) : [];
};

test('a dictated decision answer is recorded locally and NEVER posted', () => {
  const b = bed([{ id: 'a1', name: 'branch protections, option A' }]);
  const r = run(b);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(ghCalls(b), [], 'his decision must not reach a public discussion board');
  assert.equal(answers(b).length, 1, 'and it must reach the store the dashboard reads');
  assert.match(r.stdout, /answered: branch protections/);
});

test('an ordinary idea is still filed, exactly as it always was', () => {
  const b = bed([{ id: 'a1', name: 'a goals page in the hub would be good' }]);
  const r = run(b);
  assert.equal(r.status, 0, r.stderr);
  const posts = ghCalls(b).filter((c) => /createDiscussion/.test(c));
  assert.equal(posts.length, 1, `the lane that has always worked still works: ${JSON.stringify(ghCalls(b))}`);
  assert.equal(answers(b).length, 0);
});

test('FAILS CLOSED: with the router unavailable, nothing is posted and the item is left pending', () => {
  const b = bed([{ id: 'a1', name: 'branch protections, option A' }]);
  const r = run(b, { OBOT_VOICE_CLI: path.join(b.dir, 'no-such-router') });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(ghCalls(b), [], 'unable to tell an answer from an idea means posting neither');
  assert.match(r.stderr, /leaving reminder pending/);
  assert.equal(fs.readFileSync(b.osaLog, 'utf8').includes('set completed'), false,
    'and it is not completed, so the next run still sees it');
});

test('a receipt this lane wrote is never read back in and never posted', () => {
  const b = bed([{ id: 'a1', name: '✅ branch protections - recorded: branch protections, option A' }]);
  const r = run(b);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(ghCalls(b), []);
  assert.equal(answers(b).length, 0);
});

test('private: still never leaves the machine', () => {
  const b = bed([{ id: 'a1', name: 'private: something for me only' }]);
  const r = run(b);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(ghCalls(b), []);
  assert.match(fs.readFileSync(path.join(b.dir, '.claude', 'private-inbox.md'), 'utf8'), /something for me only/);
});

test('PRIVATE, said any way he says it, is written locally and never counted as kept when it was not', () => {
  // The bash pre-check was `private:*` — case-sensitive, no leading space — while the
  // router matched /^\s*private\s*:/i. So "Private: ..." missed the branch that writes
  // the file, reached the router, came back `private`, and the lane counted it as
  // "1 kept private" while writing nothing anywhere and completing nothing. The note
  // was never persisted and was re-counted on every run forever.
  for (const said of ['private: my salary thoughts', 'Private: my salary thoughts', ' private : my salary thoughts']) {
    const b = bed([{ id: 'a1', name: said }]);
    const r = run(b);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(ghCalls(b).filter((c) => /createDiscussion/.test(c)), [], `${said} must never be posted`);
    const inbox = path.join(b.dir, '.claude', 'private-inbox.md');
    assert.ok(fs.existsSync(inbox), `${said} must actually be written somewhere`);
    assert.match(fs.readFileSync(inbox, 'utf8'), /my salary thoughts/);
    assert.match(fs.readFileSync(b.osaLog, 'utf8'), /set completed/, `${said} must be completed, or it repeats forever`);
  }
});
