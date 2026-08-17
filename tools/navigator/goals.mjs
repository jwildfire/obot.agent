// Goal membership — which standing direction a counted item belongs to.
//
// @jwildfire, 2026-08-17 (jwildfire/obot.roadmap#227): "I want to be able to filter
// by repo and by goal." Repo is a field on every item. Goal is not: it is an
// ancestor question, answered by walking the sub-issue chain upward until a
// `goal`-labelled hub issue is reached.
//
// THE WALK IS THE AUDIT'S WALK. jwildfire/obot.roadmap `scripts/lib/audit/rules.mjs`
// answers the same question for GOALLESS-REQUIREMENT with `hasGoalAncestor`, and the
// commissioning issue is explicit about why this must agree with it: if the dashboard
// and the discipline checks disagree about an issue's goal, the dashboard is quietly
// contradicting the thing that polices it. So the semantics are copied deliberately,
// not reinvented:
//
//   - Membership is an ANCESTOR question at any depth, never a parent question.
//     Requirement-under-requirement nesting is legitimate (#122 → #18 → goal #73);
//     checking only the direct parent is what made that rule report two false
//     positives out of three on 2026-08-15.
//   - Only the structural sub-issue link counts. A requirement named in a sentence
//     of an issue body is not a link — one of the six untracked issues on 2026-08-15
//     was read as linked by two people and GitHub recorded no parent for it.
//   - A visited set makes a data cycle terminate rather than hang.
//
// What is new here, and is not the audit's problem: an item can be under MORE than
// one goal (a chain that forks, or a goal nested under a goal), and the answer has to
// survive being counted. So this returns the SET of goals reachable, and a filtered
// count includes an item if the selected goal is anywhere in that set. Counting an
// item once per goal would make the goal columns sum to more than the total, which is
// the sort of arithmetic nobody can defend when he asks.
//
// The other half of the honesty is UNATTRIBUTABLE. A release is published from a
// repo, not from a goal; a decision artifact carries no goal link at all. Rendering
// those as 0 under a goal filter is the failure this whole page is built against — a
// zero that means "not measured" reading as a zero that means "nothing happened". So
// items and whole series can be `null` (unresolvable) as distinct from `[]` (walked,
// no goal found), and the view says which it is.

/** `owner/repo#number` — the key both maps are built on. */
export const refKey = (repo, number) => `${repo}#${number}`;

/**
 * A parent reference from GitHub's REST `parent_issue_url`.
 *
 * The field is an API URL, so it names the parent's repo as well as its number, and
 * cross-repo parents resolve correctly without any assumption that parents live in
 * the hub. They almost always do; "almost always" is not a thing to hard-code.
 */
export function parseParentUrl(url) {
  const m = /repos\/([^/]+\/[^/]+)\/issues\/(\d+)/.exec(String(url ?? ''));
  return m ? { repo: m[1], number: Number(m[2]) } : null;
}

/**
 * The graph the walk runs over, built once per render from the metrics cache.
 *
 * `parentOf` is a single edge per key, because GitHub allows an issue exactly one
 * parent. It is still walked as a graph rather than followed as a chain so a data
 * cycle costs a terminated walk instead of a hung page.
 */
export function buildGoalIndex(cache = {}) {
  const parentOf = new Map();
  for (const i of cache.issues ?? []) {
    if (i.parent) parentOf.set(refKey(i.repo, i.number), i.parent);
  }
  const goals = new Map();
  for (const g of cache.goals ?? []) {
    goals.set(refKey(g.repo, g.number), g);
  }
  return { parentOf, goals };
}

/**
 * Every goal reachable from one item by walking parents upward.
 *
 * Returns an array of goal keys — empty when the chain terminates without one, which
 * is a real answer ("this belongs to no standing direction") and the same finding the
 * audit's GOALLESS rule reports.
 */
export function goalsOf(key, index, { maxDepth = 20 } = {}) {
  const { parentOf, goals } = index;
  const found = [];
  const seen = new Set();
  let queue = [key];
  for (let depth = 0; depth <= maxDepth && queue.length; depth++) {
    const next = [];
    for (const k of queue) {
      if (seen.has(k)) continue;
      seen.add(k);
      // A goal that is itself nested under another goal counts as both: the walk
      // records this one and keeps climbing rather than stopping at the first.
      if (goals.has(k) && k !== key) found.push(k);
      const p = parentOf.get(k);
      if (p) next.push(refKey(p.repo, p.number));
    }
    queue = next;
  }
  return found;
}

/**
 * An issue's goals. `null` means the question could not be asked of this item —
 * never confuse it with `[]`, which means it was asked and the answer is none.
 */
export function issueGoals(issue, index) {
  if (!issue?.repo || !issue?.number) return null;
  return goalsOf(refKey(issue.repo, issue.number), index);
}

/**
 * A pull request's goals, through the issues it closes.
 *
 * A PR is not a sub-issue of anything; its only structural route into the plan is
 * `closingIssuesReferences`, the same field the roadmap-discipline check treats as a
 * PR's ancestor evidence (tools/navigator/checks.mjs, `shapeRepo`). A PR that closes
 * nothing has no route at all — `null`, not `[]`, because nothing was walked.
 */
export function prGoals(pr, index) {
  const closes = pr?.closes ?? [];
  if (!closes.length) return null;
  const out = new Set();
  for (const ref of closes) {
    for (const g of goalsOf(ref, index)) out.add(g);
  }
  return [...out];
}

/**
 * Does this item pass the selected goal filter?
 *
 * Four answers, because "it did not pass" hides three different situations and a
 * counter that cannot tell them apart will report the wrong one:
 *
 *   - `yes`             — this goal is among its ancestors.
 *   - `other`           — it belongs to a goal, and to a different one. The only
 *                         verdict that genuinely means "this is somebody else's work".
 *   - `none`            — the walk finished and reached no goal at all. It belongs to
 *                         no standing direction; on this record that is about half the
 *                         issues, and it is the finding GOALLESS-REQUIREMENT reports.
 *   - `unattributable`  — there was nothing to walk. A pull request closing no issue,
 *                         a release, a decision artifact.
 *
 * The last two are counted together where the page speaks to him — both mean "in no
 * goal's numbers" — and kept apart here, because one is a discipline finding somebody
 * can fix and the other is a fact about what GitHub records.
 */
export function goalMatch(goalKey, resolved) {
  if (!goalKey) return 'yes';
  if (resolved === null) return 'unattributable';
  if (!resolved.length) return 'none';
  return resolved.includes(goalKey) ? 'yes' : 'other';
}
