// Importance, and the one tag allowed to claim it.
//
// @jwildfire, 2026-08-15: "I expect the list is going to get long, so you should
// order items in a way that highlights importance. true blockers first. maybe use
// a 'critical' tag. but use it sparingly. I'm going to be annoyed if you tell me
// something is critical when it isn't."
//
// That last sentence is a trust contract, so the tag is built to be hard to claim
// rather than easy to set:
//
// **Earned, not asserted.** There is no boolean an agent can write. An item is
// critical only if it names filed work stuck behind it - `Blocks: owner/repo#12`
// - and something resolved that reference to an open issue or PR. `blocker-log`
// asks GitHub at capture time and writes the `(verified open ...)` stamp only on
// a real answer; with no `gh`, or a closed or missing reference, no stamp is
// written and the item is ordinary. Fail-closed in every direction.
//
// **Displayed, so a weak claim is visible.** The row does not say "critical", it
// says `critical - blocks obot.roadmap#182`. He can judge the claim at a glance,
// which is the check no rule can perform for him.
//
// **Budgeted.** Sparingly is enforced, not requested: at most three rows carry
// the tag at once. A fourth claim is neither shown as critical nor hidden - the
// count is reported on the page, because silently dropping it would be the same
// dishonesty in the other direction.
//
// **Cross-section, above everything.** His section order (release candidates,
// then decisions, then config) still governs the three sections, but the critical
// pin sits above all of them. That is what "true blockers first" asks for, and it
// matches the reality that a config item holding up filed work outranks a routine
// release candidate. What it costs: the clean one-to-one mapping between the
// three sections and the three worker outcomes - an agent reading the Config
// section no longer sees every config item there. Mitigated two ways: a pinned
// row is *moved*, never duplicated (a row appearing twice in a phone list is a
// bug), and the section header says how many moved up. `/queue.json` keeps the
// unpinned grouping, so machine consumers are unaffected.
//
// Today only config items can earn the tag, because only the config list carries
// a `Blocks:` field. Release candidates come from `reviews-queue`, which holds no
// evidence of what is stuck behind a PR; decisions come from the hub collector,
// same. The seam is `item.blocks` on any item - when a collector can populate it,
// that kind starts competing here with no change to this file. Nothing is ever
// promoted on age, size, or how urgent the filing agent felt.
export const CRITICAL_BUDGET = 3;

/** The claim a row displays, or null when the item has earned nothing. */
export function criticalClaim(item) {
  const refs = (item?.blocks ?? []).filter((b) => b?.verified && b.ref);
  if (!refs.length) return null;
  const [first, ...rest] = refs;
  return `blocks ${first.ref}${rest.length ? ` +${rest.length} more` : ''}`;
}

const days = (date) => {
  const t = Date.parse(`${date ?? ''}T00:00:00Z`);
  return Number.isNaN(t) ? 0 : Math.max(0, (Date.now() - t) / 86400000);
};

/**
 * How a row sorts inside its section. Deliberately shallow: earned criticality,
 * then how much is stuck behind it, then how long it has been waiting. Nothing
 * here can promote an item across the critical line - only `criticalClaim` does.
 */
export function score(item) {
  const refs = (item?.blocks ?? []).filter((b) => b?.verified).length;
  return refs * 100 + days(item?.date) * 0.1;
}

const sorted = (items) => [...items].sort((a, b) => score(b) - score(a)
  || String(a.date ?? '9999').localeCompare(String(b.date ?? '9999'))
  || String(a.key).localeCompare(String(b.key)));

/**
 * The queue, ordered: the critical pin, then his three sections.
 *
 * Pure - it takes the collected groups and returns new ones, so the collector
 * stays the thing that knows where items come from and this stays the thing that
 * knows what order he reads them in.
 */
export function rankQueue(queue, { budget = CRITICAL_BUDGET } = {}) {
  const groups = ['rcs', 'decisions', 'config'];
  const eligible = [];
  for (const g of groups) {
    for (const it of queue[g]?.items ?? []) {
      const claim = criticalClaim(it);
      if (claim) eligible.push({ ...it, criticalClaim: claim, _g: g });
    }
  }
  eligible.sort((a, b) => score(b) - score(a) || String(a.date ?? '').localeCompare(String(b.date ?? '')));

  const critical = eligible.slice(0, budget).map(({ _g, ...it }) => ({ ...it, critical: true }));
  const pinned = new Set(critical.map((i) => i.key));
  const out = { ...queue, critical, overBudget: Math.max(0, eligible.length - critical.length) };

  for (const g of groups) {
    const all = queue[g]?.items ?? [];
    const kept = all.filter((i) => !pinned.has(i.key));
    out[g] = {
      ...queue[g],
      // An over-budget claim keeps its sentence and loses only the tag, so it
      // still sorts to the top of its own section rather than melting into it.
      items: sorted(kept).map((i) => (criticalClaim(i) ? { ...i, criticalClaim: criticalClaim(i) } : i)),
      moved: all.length - kept.length,
    };
  }
  out.items = [...out.critical, ...out.rcs.items, ...out.decisions.items, ...out.config.items];
  return out;
}
