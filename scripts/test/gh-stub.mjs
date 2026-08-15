// A fake `gh` on PATH, so the merge lane's gates can be exercised over crafted
// pull requests without a network, a token, or a real PR to spoil.
//
// obot-merge reaches GitHub through four calls, and every one of them is a
// decision input: `gh pr view` for the PR, `gh issue view` per closing
// reference, `gh api .../pulls/N/files` for the carve-out gate, and
// `gh api .../contents/policy.json` for the authority check. The stub answers
// all four from environment variables, and records the calls it was asked to
// make so a test can assert what was *not* done — an audit comment that never
// got posted leaves no other trace.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const SCRIPTS = path.join(HERE, '..');
export const MERGE = path.join(SCRIPTS, 'obot-merge');
export const POLICY = path.join(SCRIPTS, 'policy.json');

/** The blob sha git would give a file — what the authority check compares. */
export function blobSha(file) {
  const data = fs.readFileSync(file);
  return crypto.createHash('sha1')
    .update(Buffer.concat([Buffer.from(`blob ${data.length}\0`), data]))
    .digest('hex');
}

const SCRIPT = `#!/usr/bin/env bash
# One line per call, so a multi-line comment body stays one recorded call.
{ printf '%s' "$*" | tr '\\n' ' '; printf '\\n'; } >> "$GH_CALL_LOG"

if [ "$1" = "pr" ] && [ "$2" = "view" ]; then
  # The mergeability poll asks for two fields and a --jq template; everything
  # else wants the PR blob.
  case "$*" in
    *"--json mergeable,mergeStateStatus"*)
      n=0; [ -f "$GH_POLL_COUNT" ] && n="$(cat "$GH_POLL_COUNT")"
      n=$((n + 1)); printf '%s' "$n" > "$GH_POLL_COUNT"
      if [ -n "$FAKE_UNKNOWN_UNTIL" ] && [ "$n" -lt "$FAKE_UNKNOWN_UNTIL" ]; then
        echo "UNKNOWN UNKNOWN"; exit 0
      fi
      echo "\${FAKE_MERGEABLE:-MERGEABLE} \${FAKE_MERGE_STATUS:-CLEAN}"; exit 0 ;;
    *state,mergedAt,mergedBy*|*mergedAt*)
      echo "MERGED at 2026-08-15T00:00:00Z by app/obotclaw"; exit 0 ;;
    *) printf '%s' "$FAKE_PR_JSON"; exit 0 ;;
  esac
fi

if [ "$1" = "pr" ] && { [ "$2" = "comment" ] || [ "$2" = "merge" ]; }; then
  exit 0
fi

if [ "$1" = "issue" ] && [ "$2" = "view" ]; then
  n="$3"
  case ",$FAKE_MILESTONED," in *",$n,"*) echo "v1.6.0"; exit 0;; esac
  case ",$FAKE_UNREADABLE," in *",$n,"*) exit 1;; esac
  echo "NONE"; exit 0
fi

if [ "$1" = "api" ]; then
  case "$2" in
    *"/pulls/"*"/files"*)
      [ -n "$FAKE_FILES_FAIL" ] && exit 1
      printf '%s' "$FAKE_FILES"; exit 0 ;;
    *"/contents/"*)
      [ -z "$FAKE_AUTHORITY_SHA" ] && exit 1
      printf '%s\\n' "$FAKE_AUTHORITY_SHA"; exit 0 ;;
  esac
fi
exit 1
`;

/**
 * A stub directory plus the environment obot-merge needs to reach it.
 * `calls()` returns every gh invocation, `posted()` just the PR comments.
 */
export function stubGh() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'obot-merge-stub-'));
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'gh'), SCRIPT, { mode: 0o755 });
  // The token mint is the first irreversible side effect on the real merge
  // path, so tests replace it rather than risk minting one.
  fs.writeFileSync(path.join(bin, 'fake-token'), '#!/usr/bin/env bash\necho fake-token\n', { mode: 0o755 });
  return {
    bin,
    log: path.join(dir, 'gh-calls.log'),
    poll: path.join(dir, 'poll-count'),
    token: path.join(bin, 'fake-token'),
  };
}

const STUB = stubGh();

/** A synthetic PR blob, in the shape `gh pr view --json …` returns. */
export function pr({
  base = 'dev', body = '', milestone = null, changedFiles = 1, isDraft = false,
} = {}) {
  return JSON.stringify({
    baseRefName: base,
    isDraft,
    state: 'OPEN',
    mergeable: 'MERGEABLE',
    mergeStateStatus: 'CLEAN',
    changedFiles,
    headRefOid: 'abc1234',
    url: 'https://example.invalid/pr/1',
    title: 'test PR',
    body,
    milestone,
  });
}

/**
 * Run obot-merge against the stub. Defaults to `--check`, because a test that
 * reaches the merge itself is a test that can have side effects.
 */
export function runMerge({
  repo = 'jwildfire/safety.viz',
  prJson,
  files = [],
  filesFail = false,
  authoritySha = blobSha(POLICY),
  mergeable = 'MERGEABLE',
  mergeStatus = 'CLEAN',
  unknownUntil = '',
  milestoned = '',
  unreadable = '',
  args = ['--check'],
} = {}) {
  fs.writeFileSync(STUB.log, '');
  fs.writeFileSync(STUB.poll, '0');
  const r = spawnSync(MERGE, ['1', '-R', repo, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${STUB.bin}:${process.env.PATH}`,
      OBOT_MERGE_POLL_SECONDS: '0',
      OBOT_APP_TOKEN_CMD: STUB.token,
      GH_CALL_LOG: STUB.log,
      GH_POLL_COUNT: STUB.poll,
      FAKE_PR_JSON: prJson ?? pr(),
      FAKE_FILES: files.join('\n'),
      FAKE_FILES_FAIL: filesFail ? '1' : '',
      FAKE_AUTHORITY_SHA: authoritySha,
      FAKE_MERGEABLE: mergeable,
      FAKE_MERGE_STATUS: mergeStatus,
      FAKE_UNKNOWN_UNTIL: String(unknownUntil),
      FAKE_MILESTONED: milestoned,
      FAKE_UNREADABLE: unreadable,
    },
  });
  const calls = fs.readFileSync(STUB.log, 'utf8').split('\n').filter(Boolean);
  return {
    code: r.status,
    out: `${r.stdout}${r.stderr}`,
    calls,
    posted: calls.filter((c) => c.startsWith('pr comment')),
    merged: calls.filter((c) => c.startsWith('pr merge')),
  };
}
