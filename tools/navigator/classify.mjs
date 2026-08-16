// What counts as a release candidate — the one answer, for every surface that asks.
//
// This lived inside `sweep.mjs` until 2026-08-16, when the Operations Dashboard was
// measured against it and disagreed: the sweep listed two RCs, the dashboard listed
// three, and the extra one was `gsm.safety#51` — an ordinary feature PR into `dev`.
// The dashboard had no classifier at all. It took `reviews-queue`'s `bucket === 'you'`
// (mergeable, checks green, nothing sent back) and called the result a release
// candidate, which is a statement about *readiness*, not about *lane*.
//
// That is a defect on the exact surface the RC-only review rule exists to protect
// (@jwildfire's standing rule: only release candidates reach him for review), so the
// classifier moved here and both callers import it. One classifier, not two — a second
// copy is how the two would drift again the first time either lane changed.
//
// The judgement is by branch ROLE, never by branch name: `policy.json` maps each
// repo's own branch names onto `integration` and `release`, so obot.agent's RC lane
// (`main` → `stable`) and gsm.safety's (`dev` → `main`) are the same rule, and a repo
// whose branches are named something else needs no special case.
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

export const REVIEWER = 'jwildfire'

export const POLICY_FILE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts', 'policy.json')

/** Every repo the policy file lists, with the branch names holding each role. */
export function discoverRepos(policy) {
  return Object.entries(policy.repos || {}).map(([repo, entry]) => ({
    repo,
    release: (entry.branches && entry.branches.release) || [],
    class: entry.class || 'unclassified',
  }))
}

/**
 * The release branches for one repo, indexed by `owner/name`.
 *
 * A repo absent from the policy gets an empty list rather than an error: the dashboard
 * sweeps every repo @jwildfire owns, the policy lists only the seven in the program,
 * and an unlisted repo simply has no release lane this program knows about. It can
 * still reach the queue by the review-request route below, which is the honest answer
 * — the classifier degrades to "did he ask to see it", not to "everything is an RC".
 */
export function releaseBranchesByRepo(policy = readPolicy()) {
  return new Map(discoverRepos(policy).map((r) => [r.repo, r.release]))
}

export function readPolicy(file = POLICY_FILE) {
  return JSON.parse(readFileSync(file, 'utf8'))
}

/**
 * Is this open PR a release candidate — something that is @jwildfire's to review?
 *
 * Three ways in, and the first is the one that matters: the PR targets a branch
 * holding the `release` role, so merging it changes what the world sees. The other two
 * are the escape hatches for work that is his call without being a release — he was
 * asked for a review by name, or he has already reviewed it and it is still open.
 *
 * Drafts are excluded. In this workspace agents ship drafts by default, so `isDraft` is
 * not a readiness signal in general — but an RC is promoted out of draft as part of
 * being handed over, and `obot-merge` refuses a draft outright, so a draft targeting a
 * release branch is work in flight rather than a candidate awaiting him.
 */
export function classifyRC(pr, releaseBranches) {
  if (pr.isDraft) return false
  if ((releaseBranches || []).includes(pr.baseRefName)) return true
  if ((pr.reviewRequests || []).some((r) => r.login === REVIEWER)) return true
  if (pr.reviewDecision) return true // reviewed already, still open — still his queue
  return false
}
