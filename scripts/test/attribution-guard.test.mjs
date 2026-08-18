import { test } from 'node:test';
import assert from 'node:assert/strict';

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const GUARD = path.join(ROOT, 'hooks/attribution-guard.sh');

/**
 * The guard that keeps @jwildfire's GitHub history from recording things he did not
 * do — obot.agent#197.
 *
 * For two days every structural roadmap edit — labels, milestones, sub-issue links,
 * project additions, board moves — went out under his own account, on roughly a
 * hundred issues. Issue *bodies* read `obotclaw` because the app token was passed to
 * `gh issue create`; the pattern was never carried to anything else, and the ambient
 * `gh` token authenticates as him. It was invisible where anyone looks: the body
 * reads correctly and only the timeline disagrees.
 *
 * Documenting it would not have fixed it. The same session that filed the issue had
 * already proved the mechanism worked, and the mechanism was never the problem —
 * remembering was. So the write is refused at the moment it is about to run.
 *
 * Two failure modes decide whether this guard survives, and both are tested here:
 *
 *   A guard that MISSES a write is worthless. The obvious miss is a compound
 *   command whose first half is wrapped: `obot-gh ... && gh issue edit ...`. Each
 *   segment is therefore judged on its own.
 *
 *   A guard that FIRES ON PROSE gets switched off within a day, and then it protects
 *   nothing. Drafts, commit messages and scratchpad lines are full of these exact
 *   command strings, so quoted spans and heredoc bodies are stripped before matching.
 */

function verdict(command) {
  const out = execFileSync(GUARD, {
    input: JSON.stringify({ tool_input: { command } }),
    encoding: 'utf8',
  });
  if (!out.trim()) return { decision: 'defer' };
  const parsed = JSON.parse(out);
  return {
    decision: parsed.hookSpecificOutput.permissionDecision,
    reason: parsed.hookSpecificOutput.permissionDecisionReason,
  };
}

const denied = (cmd) => assert.equal(verdict(cmd).decision, 'deny', `should deny: ${cmd}`);
const deferred = (cmd) => assert.equal(verdict(cmd).decision, 'defer', `should defer: ${cmd}`);

test('the four structural writes named in #197 are all refused', () => {
  // Labels — the instance a worker found, on hub#215 and hub#236.
  denied('gh issue edit 215 -R jwildfire/obot.roadmap --add-label ws-delivery');
  denied('gh issue edit 215 -R jwildfire/obot.roadmap --remove-label ws-delivery');
  // Milestones.
  denied('gh issue edit 12 -R jwildfire/obot.agent --milestone v0.5.0');
  // Sub-issue (parent) links, both routes.
  denied('gh api -X POST /repos/jwildfire/obot.roadmap/issues/215/sub_issues -f sub_issue_id=42');
  denied(`gh api graphql -f query='mutation { addSubIssue(input: {issueId: "I_1", subIssueId: "I_2"}) { clientMutationId } }'`);
  // Board moves.
  denied('gh project item-add 1 --owner jwildfire --url https://github.com/jwildfire/obot.roadmap/issues/215');
  denied('gh project item-edit --id PVTI_x --field-id PVTSSF_y --project-id PVT_z --single-select-option-id abc');
});

test('other writes that carry his name are refused too', () => {
  denied('gh issue create -R jwildfire/obot.agent --title x --body y');
  denied('gh issue comment 197 -R jwildfire/obot.agent --body "done"');
  denied('gh pr create -R jwildfire/obot.agent --title x --body y');
  denied('gh pr edit 12 -R jwildfire/obot.agent --add-label bug');
  denied('gh label create ws-officer -R jwildfire/obot.roadmap --color ededed');
  denied('gh release create v0.5.0 -R jwildfire/obot.agent --notes x');
  denied('gh issue close 197 -R jwildfire/obot.agent');
});

test('a REST write is caught whether or not the method is spelled out', () => {
  denied('gh api --method PATCH /repos/jwildfire/obot.agent/issues/197 -f state=closed');
  // gh defaults to POST as soon as a field flag appears, so a missing -X proves nothing.
  denied('gh api /repos/jwildfire/obot.roadmap/issues/215/labels -f labels[]=ws-delivery');
  denied('gh api /repos/jwildfire/obot.agent/issues/1/comments --input body.json');
  denied('curl -X POST -H "Authorization: Bearer x" https://api.github.com/repos/jwildfire/obot.agent/issues/1/labels');
  denied('curl https://api.github.com/repos/jwildfire/obot.agent/issues/1/labels -X POST');
});

test('handing the write his own credential is refused, not admitted as explicit', () => {
  denied('GH_TOKEN=$(gh auth token) gh issue edit 215 -R jwildfire/obot.roadmap --add-label ws-delivery');
  denied('GITHUB_TOKEN="$(gh auth token)" gh project item-edit --id x');
});

test('the wrapper and an explicit token are admitted', () => {
  deferred('obot.agent/scripts/obot-gh issue edit 215 -R jwildfire/obot.roadmap --add-label ws-delivery');
  deferred('scripts/obot-gh project item-edit --id x --as-jeremy');
  deferred('/Users/jwildfire/Documents/obot2/obot.agent/scripts/obot-gh issue create -R jwildfire/obot.agent --title x');
  deferred('GH_TOKEN=$(obot.agent/scripts/obot-app-token) gh issue edit 197 -R jwildfire/obot.agent --milestone v0.5.0');
  deferred('obot.agent/scripts/obot-merge 12 -R jwildfire/obot.agent --squash --delete-branch');
});

test('one wrapped call does not launder the rest of the command', () => {
  // The whole point of judging segments separately.
  denied('obot-gh issue edit 1 -R jwildfire/obot.agent --add-label a && gh issue edit 2 -R jwildfire/obot.agent --add-label b');
  denied('GH_TOKEN=$(obot-app-token) gh issue create --title x ; gh issue edit 5 --milestone v1');
  denied('gh issue view 1 --json title | gh issue edit 2 --add-label x');
});

test('reads are never blocked', () => {
  deferred('gh issue view 197 -R jwildfire/obot.agent --json title,body');
  deferred('gh issue list -R jwildfire/obot.roadmap --limit 200 --json number,labels');
  deferred('gh project item-list 1 --owner jwildfire --format json --limit 200');
  deferred('gh api /repos/jwildfire/obot.agent/issues/197');
  deferred(`gh api graphql -f query='query { user(login: "jwildfire") { projectV2(number: 1) { id } } }'`);
  deferred('gh pr view 12 -R jwildfire/obot.agent --json state');
  deferred('gh search issues --owner jwildfire --label bug');
});

test('nothing unrelated to GitHub is blocked', () => {
  deferred('git commit -m "fix the thing"');
  deferred('node --test scripts/test/*.test.mjs');
  deferred('grep -rn "add-label" skills/');
});

test('prose about a write is not a write', () => {
  // A guard that fires on drafts and commit messages gets switched off, and then it
  // protects nothing. Quoted spans and heredoc bodies are stripped before matching.
  deferred(`git commit -m "labels now go through obot-gh, not gh issue edit --add-label"`);
  deferred(`bash obot.agent/tools/scratchpad-log 'W0043' 'stopped using gh issue edit --add-label directly'`);
  deferred(`echo "run: gh project item-edit --id x" >> notes.md`);
  deferred([
    "cat > drafts/obot.agent/ISSUE_N_x.md <<'EOF'",
    'Every structural edit ran as `gh issue edit --add-label`, and',
    'gh api -X POST /repos/o/r/issues/1/sub_issues went out as him.',
    'EOF',
  ].join('\n'));
  // A mutation named in prose, with no graphql call anywhere, is just prose.
  deferred(`echo "addSubIssue(input: {}) is the mutation we were missing"`);
});

test('the advice names a lane that exists on this checkout', () => {
  // A guard that refuses a write and then sends the agent to a command which is not
  // there has not removed the class; it has replaced it with a dead end, and the next
  // agent works around the guard rather than around the problem. The wrapper is absent
  // in a workspace whose obot.agent checkout predates it - during the very change that
  // introduces both, and on any machine that has not pulled.
  const withWrapper = execFileSync(GUARD, {
    input: JSON.stringify({ tool_input: { command: 'gh issue edit 1 --add-label x' } }),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: path.resolve(ROOT, '../../..') },
  });
  assert.match(JSON.parse(withWrapper).hookSpecificOutput.permissionDecisionReason,
    /obot\.agent\/scripts\/obot-gh/);

  const withoutWrapper = execFileSync(GUARD, {
    input: JSON.stringify({ tool_input: { command: 'gh issue edit 1 --add-label x' } }),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: '/nonexistent-workspace' },
  });
  const reason = JSON.parse(withoutWrapper).hookSpecificOutput.permissionDecisionReason;
  assert.match(reason, /obot-app-token/);
  assert.doesNotMatch(reason, /Run it through the wrapper/);
});

test('the guard is registered by the installer, so a fresh machine gets it', () => {
  const installer = fs.readFileSync(path.join(ROOT, 'hooks/install.sh'), 'utf8');
  assert.match(installer, /attribution-guard\.sh:PreToolUse:Bash/,
    'hooks/install.sh must register attribution-guard.sh under PreToolUse/Bash');
});
