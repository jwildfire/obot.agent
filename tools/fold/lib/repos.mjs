// Commits since the last fold, across the repos the policy file names
// (jwildfire/obot.roadmap#238, task obot.agent#200).
//
// The repo list comes from scripts/policy.json, the same source the Navigator's
// discoverRepos uses, so the fold and the sweep never disagree about what counts
// as a project repo.
//
// A repo that cannot be read returns unknown, not zero. That distinction is the
// whole point of this module: the direction of failure that matters is claiming
// a night was quiet on a night nobody could look.
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

export function policyRepos(repoRoot) {
  try {
    const p = JSON.parse(readFileSync(join(repoRoot, 'scripts', 'policy.json'), 'utf8'))
    return Object.keys(p.repos ?? {}).map((full) => full.split('/').pop())
  } catch {
    return []
  }
}

export function commitsSince(workspace, repos, sinceIso, { run = defaultRun, untilIso = null } = {}) {
  const commits = []
  const failed = []
  for (const name of repos) {
    const dir = join(workspace, name)
    if (!existsSync(join(dir, '.git'))) continue
    try {
      const out = run(dir, sinceIso, untilIso)
      for (const line of out.split('\n').filter(Boolean)) commits.push(`${name} ${line}`)
    } catch (e) {
      failed.push(`${name}: ${e.message.split('\n')[0]}`)
    }
  }
  return { commits, failed, unknown: failed.length > 0 }
}

function defaultRun(dir, sinceIso, untilIso) {
  // --all so work on an unmerged branch or in a linked worktree counts; a night
  // spent on a feature branch is not a quiet night. --until exists so the gate can
  // be checked against a closed window of real history, not only against now.
  const args = ['-C', dir, 'log', '--all', `--since=${sinceIso}`]
  if (untilIso) args.push(`--until=${untilIso}`)
  args.push('--format=%h %s')
  return execFileSync('git', args, {
    encoding: 'utf8', timeout: 20000, stdio: ['ignore', 'pipe', 'pipe'],
  })
}
