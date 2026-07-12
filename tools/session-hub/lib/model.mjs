// Session model assembly (design #24 §4): merge collector results into one
// plain object the renderer consumes. Applies the D4 lifecycle boundary.

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

/** Assemble the full model. All inputs are collector results ({data}|{notice}). */
export function buildModel({ collected, workspace, date, mode, generatedAtIso, tzOffsetMinutes = 0, slug = null }) {
  const { jobs, agentsCli, scratchpad, nextSession, ghSweep } = collected;
  const boundary = resolveBoundary({ scratchpad, jobs, date, tzOffsetMinutes });
  const agents = scopeAgents({ jobs, agentsCli, boundary, workspace });

  const overview = scratchpad?.data?.overview ?? null;
  const priorities = { open: 0, done: 0 };
  for (const g of overview?.groups ?? []) {
    for (const it of g.items) {
      if (it.checked === true) priorities.done++;
      else if (it.checked === false) priorities.open++;
    }
  }
  const activity = ghSweep?.data?.items?.filter((i) => i.updatedAt >= boundary.startIso) ?? null;

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
    },
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
