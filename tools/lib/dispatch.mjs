// Who else is in flight — the sideways half of jwildfire/obot.roadmap#267.
//
// Recorded on that issue as call `n0233`, in the Navigator's own words: "The constraint a
// worker most needs is often not a rule but a fact: someone else is already doing this.
// That is knowable at dispatch and known by exactly one party — the dispatcher — and it is
// currently carried by nothing."
//
// Three collisions in one week made the case, all of them on 2026-08-18:
//
//   - Two workers dispatched minutes apart wrote a correction on the same decision page.
//     Neither was told the other existed; the collision surfaced only because one noticed a
//     dirty tree in the shared checkout.
//   - A worker was dispatched at a deploy incident 🎩🤖 obot-prime had fixed four hours
//     earlier.
//   - A staged-file sweep put a false attribution on `main` that cannot be rewritten
//     (obot.agent#289).
//
// ## No new data source
//
// Everything here is already written down. `.claude/workers.journal` is the append-only
// record every `worker-id claim` appends to, and `~/.claude/jobs/<id>/state.json` is the
// harness's own record of what is still running. `readJobs` is imported from the wake
// rather than written again: two readers of the same records is how two halves of one
// detector come to disagree about which workers have stopped.
//
// ## Coverage is reported, never assumed
//
// A claim carries a requirement only if the dispatcher passed one. Where it did not, this
// reads the task text for a qualified reference and says how many claims it could place at
// all. That number is printed on every surface, because a detector that reads "nothing
// recorded" as "nothing overlapping" is the silent-success failure this house keeps
// finding: it would report a clean fleet forever while going blind.
import fs from 'node:fs';
import path from 'node:path';

import { readFailure } from '../ops-dashboard/lib/absent.mjs';
import { readJobs } from '../navigator/wake.mjs';

/** Where every `worker-id claim` appends. Written by Python, read here; JSONL is the seam. */
export const claimsPath = (ws) => path.join(ws, '.claude', 'workers.journal');

/** `W0099`, wherever it appears — in a claim record or inside a session name. */
export const WID_RE = /\bW\d{4}(?:\.\d+)?\b/;

/**
 * A qualified issue reference — `hub#267`, `oa#293`, `jwildfire/obot.agent#293`.
 *
 * Bare `#293` is deliberately NOT mined. It is the commonest way to write a reference and
 * the least resolvable: two workers under `#42` in different repos are not overlapping, and
 * an overlap finding that is wrong is a finding the fleet learns to ignore.
 */
export const REF_RE = /\b(?:[a-z][a-z0-9.-]*\/)?(?:hub|oa|sv|gs|og|roadmap|obot\.agent|obot\.roadmap|safety\.viz|gsm\.safety|open\.gismo|open\.csr|demo-301)#\d+\b/gi;

/** How long a claim with no job row yet still counts as in flight (a spawn in progress). */
export const SPAWNING_MS = 30 * 60 * 1000;

/** Canonical form, so `hub#267` and `HUB#267` are one requirement and not two. */
export const canonRef = (s) => String(s).trim().toLowerCase().replace(/^jwildfire\//, '')
  .replace(/^obot\.roadmap#/, 'hub#').replace(/^obot\.agent#/, 'oa#');

/** Every claim in the ledger, oldest first. */
export function readClaims(ws, { read = fs.readFileSync } = {}) {
  const p = claimsPath(ws);
  let text;
  try { text = read(p, 'utf8'); } catch (e) {
    const f = readFailure(e, p);
    return { read: !f.absent ? false : true, armed: false, claims: [], why: f.absent ? null : f.why };
  }
  const claims = [];
  for (const line of String(text).split('\n')) {
    if (!line.trim()) continue;
    let r; try { r = JSON.parse(line); } catch { continue; }
    if (r.op !== 'claim' || !r.id) continue;
    claims.push({
      id: r.id, slug: r.slug || '', task: r.task || '', requirement: r.requirement || null,
      parent: r.parent || null, ts: r.ts || null, actor: r.actor || null,
    });
  }
  return { read: true, armed: Boolean(claims.length), claims, why: null };
}

/**
 * What a claim is working under.
 *
 * The recorded `--requirement` first, because it is the only field a dispatcher states on
 * purpose. Failing that, any qualified reference in the task text — which is how the
 * existing ledger's 40-odd claims can be placed at all, since the field did not exist when
 * they were written.
 */
export function requirementsOf(claim) {
  if (claim.requirement) return [...new Set(String(claim.requirement).split(/[,\s]+/).filter(Boolean).map(canonRef))];
  const found = `${claim.task || ''} ${claim.slug || ''}`.match(REF_RE) || [];
  return [...new Set(found.map(canonRef))];
}

/**
 * The workers still in flight, newest claim first.
 *
 * In flight means the harness has not stamped a terminal watermark on the session — or the
 * claim is minutes old and no session row exists yet, which is a spawn in progress rather
 * than a finished worker. A blocked session stays listed: `blocked` is derived by a
 * classifier reading a session's own prose and has been wrong before (2026-08-18), so this
 * shows it and lets the reader confirm rather than deciding for them.
 */
export function adjacentWorkers({ ws, jobs, exclude = null, now = new Date(), jobList = null } = {}) {
  const c = readClaims(ws);
  if (!c.read) return { read: false, why: c.why, workers: [], coverage: null };
  let rows = jobList;
  if (!rows) { try { rows = readJobs(jobs); } catch { rows = []; } }
  const byId = new Map();
  for (const j of rows) {
    const m = (j.name || '').match(WID_RE);
    if (m) byId.set(m[0], j);
  }
  const self = exclude ? String(exclude).toUpperCase() : null;
  const t = new Date(now).getTime();
  const workers = [];
  for (const claim of c.claims) {
    if (self && claim.id === self) continue;
    const job = byId.get(claim.id);
    const age = claim.ts ? t - new Date(claim.ts).getTime() : Infinity;
    const live = job ? !job.firstTerminalAt : age < SPAWNING_MS && age >= 0;
    if (!live) continue;
    workers.push({
      ...claim,
      requirements: requirementsOf(claim),
      state: job?.state ?? 'spawning',
      startedAt: job?.startedAt ?? claim.ts,
    });
  }
  workers.reverse();
  return {
    read: true,
    why: null,
    workers,
    coverage: { inFlight: workers.length, placed: workers.filter((w) => w.requirements.length).length },
  };
}

/**
 * Two or more workers in flight under one requirement.
 *
 * This is the finding, and it is deliberately not a refusal. Two workers under one
 * requirement is often correct — a big requirement split two ways — so the check says who
 * and under what, and leaves the call to whoever reads it. What it removes is the state
 * that produced all three collisions: nobody able to see it at all.
 */
export function dispatchOverlap(args = {}) {
  const a = adjacentWorkers({ ...args, exclude: null });
  if (!a.read) return { read: false, why: a.why, groups: [], coverage: null };
  const groups = new Map();
  for (const w of a.workers) {
    for (const r of w.requirements) {
      if (!groups.has(r)) groups.set(r, []);
      groups.get(r).push(w);
    }
  }
  return {
    read: true,
    why: null,
    coverage: a.coverage,
    groups: [...groups.entries()].filter(([, ws2]) => ws2.length > 1)
      .map(([requirement, ws2]) => ({ requirement, workers: ws2 }))
      .sort((x, y) => x.requirement.localeCompare(y.requirement)),
  };
}
