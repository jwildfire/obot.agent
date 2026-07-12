// Session model assembly (design #24 §4): merge collector results into one
// plain object the renderer consumes. Applies the D4 lifecycle boundary and
// links agents ↔ priorities by their shared GitHub refs.

const REF_STOPWORDS = new Set(['pr', 'prs', 'issue', 'issues', 'session', 'sessions', 'job', 'jobs', 'step', 'phase', 'item', 'items', 'p', 'q', 'd', 't', 'k', 'rc', 'v']);
const REPO_ALIASES = { hub: 'obot.roadmap', oa: 'obot.agent', sv: 'safety.viz' };

/**
 * Extract normalized GitHub refs ("repo#N", lowercased) from free text:
 * full github.com URLs plus `repo#N` shorthand (with hub/oa/sv aliases).
 * Bare "#N" and generic words ("PR #23") are ignored — URLs carry those.
 */
export function extractRefs(text) {
  const refs = new Set();
  const s = String(text ?? '');
  for (const m of s.matchAll(/github\.com\/[^/\s]+\/([\w.-]+)\/(?:issues|pull)\/(\d+)/g)) {
    refs.add(`${m[1].toLowerCase()}#${m[2]}`);
  }
  for (const m of s.matchAll(/\b([A-Za-z][\w.-]*)\s?#(\d+)/g)) {
    let repo = m[1].toLowerCase();
    repo = REPO_ALIASES[repo] ?? repo;
    if (REF_STOPWORDS.has(repo)) continue;
    refs.add(`${repo}#${m[2]}`);
  }
  return refs;
}

/** Compact display name for an agent: strip emoji + date tokens from the session name. */
export function shortName(agent) {
  let s = String(agent.name ?? '').replace(/[^\x20-\x7E]/g, ' ');
  s = s.replace(/\b\d{4}-\d{2}-\d{2}\b/g, ' ').replace(/\b\d{2}-\d{2}\b/g, ' ');
  s = s.trim().replace(/\s+/g, ' ');
  if (!s || /^\d+$/.test(s)) {
    return agent.color === 'orange' ? 'lead' : String(agent.id ?? 'agent').slice(0, 6);
  }
  return s;
}

/**
 * Cross-link agents and priority items in place: a match is a shared ref between
 * the priority's text and the agent's briefing (`intent`), `detail`, `result`,
 * or produced `children` links. Priorities gain `num` (from their own leading
 * number, else running order) and `agents` [{id, color, short}]; agents gain
 * `short` and `priorities` [nums].
 */
export function linkAgentsToPriorities(agents, overview) {
  for (const a of agents) {
    a.short = shortName(a);
    const hay = [a.intent, a.detail, a.result, ...(a.children ?? []).map((c) => c.href)].join(' ');
    a.refs = [...extractRefs(hay)];
    a.priorities = [];
  }
  let counter = 0;
  for (const g of overview?.groups ?? []) {
    for (const it of g.items) {
      if (it.prose) continue;
      counter++;
      if (it.num == null) it.num = counter;
      const refs = extractRefs(it.text);
      it.agents = [];
      for (const a of agents) {
        if (a.refs.some((r) => refs.has(r))) {
          it.agents.push({ id: a.id, color: a.color ?? null, short: a.short });
          a.priorities.push(it.num);
        }
      }
    }
  }
}

/**
 * Resolve the session boundary (D4), in preference order:
 * 1. The session-init marker's own date + HH:MM (canonical marker shape).
 * 2. The createdAt of the job the marker names.
 * 3. Local midnight of `date`.
 * Returns { startIso, sessionNumber, anchor }.
 */
export function resolveBoundary({ scratchpad, jobs, date, tzOffsetMinutes }) {
  const marker = scratchpad?.data?.marker ?? null;
  const fallback = localMidnightIso(date, tzOffsetMinutes);
  if (marker?.time) {
    const [h, min] = marker.time.split(':').map(Number);
    const [y, mo, d] = (marker.date ?? date).split('-').map(Number);
    const utcMs = Date.UTC(y, mo - 1, d, h, min) + tzOffsetMinutes * 60 * 1000;
    return {
      startIso: new Date(utcMs).toISOString(),
      sessionNumber: marker.sessionNumber ?? 1,
      anchor: `session-init marker @ ${marker.time}`,
    };
  }
  if (marker?.jobId && Array.isArray(jobs?.data)) {
    const anchorJob = jobs.data.find((j) => j.id === marker.jobId);
    if (anchorJob?.createdAt) {
      return {
        startIso: anchorJob.createdAt,
        sessionNumber: marker.sessionNumber ?? 1,
        anchor: `session-init marker → job ${marker.jobId}`,
      };
    }
  }
  return {
    startIso: fallback,
    sessionNumber: marker?.sessionNumber ?? 1,
    anchor: marker ? 'session-init marker (no time, job unresolved) → local midnight' : 'no marker → local midnight',
  };
}

function localMidnightIso(date, tzOffsetMinutes) {
  // date: 'YYYY-MM-DD' in local time; tzOffsetMinutes: Date#getTimezoneOffset()
  const [y, m, d] = date.split('-').map(Number);
  const utcMs = Date.UTC(y, m - 1, d) + tzOffsetMinutes * 60 * 1000;
  return new Date(utcMs).toISOString();
}

/** Jobs in scope: workspace cwd + updated since start, or still running (D4). */
export function scopeAgents({ jobs, agentsCli, boundary, workspace }) {
  const out = [];
  const inWs = (cwd) => typeof cwd === 'string' && cwd.startsWith(workspace);
  for (const j of jobs?.data ?? []) {
    if (!inWs(j.cwd)) continue;
    const active = j.state === 'working' || j.state === 'needs-input';
    const recent = j.updatedAt && j.updatedAt >= boundary.startIso;
    if (active || recent) out.push({ ...j, kind: 'background' });
  }
  // interactive sessions come only from the CLI index (no state.json);
  // same boundary rule: currently busy, or started since session start
  for (const a of agentsCli?.data ?? []) {
    if (a.kind !== 'interactive') continue;
    if (!inWs(a.cwd)) continue;
    const startedIso = a.startedAt ? new Date(a.startedAt).toISOString() : null;
    if (a.status !== 'busy' && !(startedIso && startedIso >= boundary.startIso)) continue;
    out.push({
      id: a.sessionId?.slice(0, 8) ?? a.id ?? 'interactive',
      name: a.name || 'interactive session',
      state: a.status === 'busy' ? 'working' : 'idle',
      detail: '', tokens: null, children: [], result: null, model: null,
      kind: 'interactive',
      createdAt: a.startedAt ? new Date(a.startedAt).toISOString() : null,
    });
  }
  // liveness: a job whose process is gone but state says working → mark stale
  const live = new Set((agentsCli?.data ?? []).map((a) => a.id).filter(Boolean));
  if (agentsCli?.data) {
    for (const j of out) {
      if (j.kind === 'background' && j.state === 'working' && !live.has(j.id)) j.stale = true;
    }
  }
  return out.sort((a, b) => String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? '')));
}

/**
 * Session accomplishments (@jwildfire 2026-07-11): releases and requirements
 * progress, with closure emphasized — closed issues, merged PRs, published
 * releases, hub `requirement`-labeled issues that moved.
 */
export function buildAccomplishments(ghSweep, boundary) {
  const d = ghSweep?.data;
  if (!d) return null;
  const items = (d.items ?? []).filter((i) => i.updatedAt >= boundary.startIso);
  const closedIssues = items.filter((i) => !i.isPullRequest && i.event === 'closed');
  const mergedPrs = items.filter((i) => i.isPullRequest && i.event === 'merged');
  const requirements = items.filter((i) => i.repo === 'obot.roadmap' && (i.labels ?? []).includes('requirement'));
  const releases = (d.releases ?? []).filter((r) => r.publishedAt >= boundary.startIso);
  return { releases, closedIssues, mergedPrs, requirements };
}

/** Assemble the full model. All inputs are collector results ({data}|{notice}). */
export function buildModel({ collected, workspace, date, mode, generatedAtIso, tzOffsetMinutes = 0, slug = null }) {
  const { jobs, agentsCli, scratchpad, nextSession, ghSweep } = collected;
  const boundary = resolveBoundary({ scratchpad, jobs, date, tzOffsetMinutes });
  const agents = scopeAgents({ jobs, agentsCli, boundary, workspace });

  const overview = scratchpad?.data?.overview ?? null;
  linkAgentsToPriorities(agents, overview);
  const priorities = { open: 0, done: 0 };
  for (const g of overview?.groups ?? []) {
    for (const it of g.items) {
      if (it.checked === true) priorities.done++;
      else if (it.checked === false) priorities.open++;
    }
  }
  const activity = ghSweep?.data?.items?.filter((i) => i.updatedAt >= boundary.startIso) ?? null;
  const accomplishments = buildAccomplishments(ghSweep, boundary);

  const byState = {};
  let tokens = 0;
  let tokensKnown = 0;
  for (const a of agents) {
    byState[a.state] = (byState[a.state] ?? 0) + 1;
    if (typeof a.tokens === 'number') { tokens += a.tokens; tokensKnown++; }
  }

  const alerts = agents.filter((a) => a.state === 'needs-input' || a.state === 'failed');

  return {
    mode, // 'live' | 'report'
    workspace,
    date,
    generatedAtIso,
    slug: slug ?? (boundary.sessionNumber > 1 ? `${date}-${boundary.sessionNumber}` : date),
    boundary,
    agents,
    alerts,
    tiles: {
      priorities,
      agents: { total: agents.length, byState },
      tokens: { total: tokens, reporting: tokensKnown },
      activity: activity ? activity.length : null,
      closure: accomplishments
        ? accomplishments.closedIssues.length + accomplishments.mergedPrs.length + accomplishments.releases.length
        : null,
    },
    accomplishments,
    panels: {
      overview,
      todo: scratchpad?.data?.todo ?? null,
      notes: scratchpad?.data?.notes ?? null,
      scaffold: scratchpad?.data?.scaffold ?? null,
      nextSession: nextSession?.data ?? null,
      activity,
    },
    notices: {
      jobs: jobs?.notice ?? null,
      agentsCli: agentsCli?.notice ?? null,
      scratchpad: scratchpad?.notice ?? null,
      nextSession: nextSession?.notice ?? null,
      ghSweep: ghSweep?.notice ?? (ghSweep?.data?.stale ? 'gh sweep failed — showing stale cache' : null),
    },
    sweepFetchedAt: ghSweep?.data?.fetchedAt ?? null,
  };
}
