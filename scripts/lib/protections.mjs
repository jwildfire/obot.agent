// The pure half of obot-protect: spec -> expected shape, API response -> observed
// shape, and the comparison between them. No network, no gh, no side effects, so
// the verifier's judgment can be tested against recorded API responses instead of
// against whatever the live repositories happen to say today.
//
// One rule about the shape: a field the spec pins OFF is compared as strictly as a
// field it pins ON. A protection that stops the agents is a failure of the spec,
// not a stricter version of it - so `requiredApprovals: 1` appearing on a branch
// this file says should carry 0 is a disagreement, and the verifier exits non-zero
// on it exactly as it does on a missing force-push ban.

/** Every field the spec pins, in the order a report should read them. */
export const FIELDS = [
  'requirePullRequest',
  'requiredApprovals',
  'requiredChecks',
  'strictChecks',
  'requireLinearHistory',
  'allowForcePushes',
  'allowDeletions',
  'requireConversationResolution',
  'enforceAdmins',
  'requireSignatures',
  'lockBranch',
  'blockCreations',
];

/** Human-readable name for a branch entry, used in every message. */
export const label = (entry) => `${entry.repo}/${entry.branch}`;

/**
 * What the spec says this branch should look like: its tier's field values, with
 * the entry's own `checks` list filled in. Throws on an unknown tier rather than
 * silently protecting nothing - a typo in the spec must not read as "no rule".
 */
export function expectedFor(spec, entry) {
  const tier = spec.tiers?.[entry.tier];
  if (!tier) throw new Error(`${label(entry)}: unknown tier '${entry.tier}'`);
  const out = {};
  for (const f of FIELDS) {
    if (f === 'requiredChecks') out[f] = [...(entry.checks ?? [])].sort();
    else out[f] = tier[f];
  }
  for (const f of FIELDS) {
    if (out[f] === undefined) throw new Error(`${label(entry)}: tier '${entry.tier}' does not define '${f}'`);
  }
  return out;
}

/**
 * What GitHub actually has. `null` means the protection endpoint returned 404,
 * which is the API's way of saying the branch is unprotected - and unprotected is
 * a real, comparable state, not an error: every guard reads as absent, every
 * permissive field as allowed.
 */
export function normalizeObserved(json) {
  if (!json) {
    return {
      requirePullRequest: false,
      requiredApprovals: 0,
      requiredChecks: [],
      strictChecks: false,
      requireLinearHistory: false,
      allowForcePushes: true,
      allowDeletions: true,
      requireConversationResolution: false,
      enforceAdmins: false,
      requireSignatures: false,
      lockBranch: false,
      blockCreations: false,
    };
  }
  const rsc = json.required_status_checks;
  const rpr = json.required_pull_request_reviews;
  return {
    requirePullRequest: Boolean(rpr),
    requiredApprovals: rpr?.required_approving_review_count ?? 0,
    requiredChecks: [...(rsc?.contexts ?? (rsc?.checks ?? []).map((c) => c.context))].sort(),
    strictChecks: Boolean(rsc?.strict),
    requireLinearHistory: Boolean(json.required_linear_history?.enabled),
    allowForcePushes: Boolean(json.allow_force_pushes?.enabled),
    allowDeletions: Boolean(json.allow_deletions?.enabled),
    requireConversationResolution: Boolean(json.required_conversation_resolution?.enabled),
    enforceAdmins: Boolean(json.enforce_admins?.enabled),
    requireSignatures: Boolean(json.required_signatures?.enabled),
    lockBranch: Boolean(json.lock_branch?.enabled),
    blockCreations: Boolean(json.block_creations?.enabled),
  };
}

const same = (a, b) =>
  Array.isArray(a) || Array.isArray(b)
    ? JSON.stringify(a ?? []) === JSON.stringify(b ?? [])
    : a === b;

const show = (v) => (Array.isArray(v) ? (v.length ? v.join(', ') : '(none)') : String(v));

/** Every field where the live state and the spec disagree, spec first. */
export function diff(expected, observed) {
  const out = [];
  for (const field of FIELDS) {
    if (!same(expected[field], observed[field])) {
      out.push({ field, expected: show(expected[field]), actual: show(observed[field]) });
    }
  }
  return out;
}

/**
 * The exact body of PUT /repos/{owner}/{repo}/branches/{branch}/protection.
 *
 * `restrictions` is null on purpose and not merely omitted: push restrictions are
 * an organization-only feature, and null is also the honest value here - no rule
 * in this spec restricts WHO may merge, which is the reason obotclaw[bot] needs no
 * bypass entry anywhere.
 */
export function payloadFor(expected) {
  return {
    required_status_checks: expected.requiredChecks.length
      ? { strict: expected.strictChecks, contexts: expected.requiredChecks }
      : null,
    enforce_admins: expected.enforceAdmins,
    required_pull_request_reviews: expected.requirePullRequest
      ? {
          dismiss_stale_reviews: false,
          require_code_owner_reviews: false,
          require_last_push_approval: false,
          required_approving_review_count: expected.requiredApprovals,
        }
      : null,
    restrictions: null,
    required_linear_history: expected.requireLinearHistory,
    allow_force_pushes: expected.allowForcePushes,
    allow_deletions: expected.allowDeletions,
    block_creations: expected.blockCreations,
    required_conversation_resolution: expected.requireConversationResolution,
    lock_branch: expected.lockBranch,
    allow_fork_syncing: false,
  };
}
