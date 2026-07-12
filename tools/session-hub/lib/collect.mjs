// Collectors for the session hub (design #24 §4).
//
// Every collector is independent and fallible: it returns { data } on success or
// { notice: '<why the panel is degraded>' } on any failure. Collectors never throw.
// The state.json parser pins exactly the fields in design §2 and treats everything
// else as opaque.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { splitSections, findSection, parseItems, findSessionMarker } from './scratchpad.mjs';

const PINNED_STATE_FIELDS = [
  'name', 'color', 'state', 'detail', 'tempo', 'tokens', 'children',
  'output', 'createdAt', 'firstTerminalAt', 'updatedAt', 'cwd',
  'respawnFlags', 'intent',
];

/** Normalize one state.json object down to the pinned contract. Never throws. */
export function normalizeJobState(id, raw) {
  const job = { id };
  if (raw == null || typeof raw !== 'object') return { id, degraded: 'unreadable state.json' };
  for (const f of PINNED_STATE_FIELDS) {
    if (raw[f] !== undefined) job[f] = raw[f];
  }
  job.tokens = typeof job.tokens === 'number' ? job.tokens : null;
  job.state = typeof job.state === 'string' ? job.state : 'unknown';
  job.name = typeof job.name === 'string' && job.name ? job.name : `job ${id}`;
  job.detail = typeof job.detail === 'string' ? job.detail : '';
  job.children = Array.isArray(job.children)
    ? job.children.filter((c) => c && typeof c.href === 'string')
    : [];
  job.result =
    job.output && typeof job.output === 'object' && typeof job.output.result === 'string'
      ? job.output.result
      : null;
  job.model = extractModel(job.respawnFlags);
  delete job.respawnFlags;
  delete job.output;
  return job;
}

function extractModel(flags) {
  if (!Array.isArray(flags)) return null;
  const i = flags.indexOf('--model');
  if (i === -1 || typeof flags[i + 1] !== 'string') return null;
  return flags[i + 1].replace(/^claude-/, '');
}

/** Read every ~/.claude/jobs/<id>/state.json. */
export function collectJobs({ jobsDir = path.join(os.homedir(), '.claude', 'jobs') } = {}) {
  let entries;
  try {
    entries = fs.readdirSync(jobsDir, { withFileTypes: true });
  } catch (err) {
    return { notice: `jobs directory unreadable (${err.code ?? err.message})` };
  }
  const jobs = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const file = path.join(jobsDir, e.name, 'state.json');
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      jobs.push(normalizeJobState(e.name, raw));
    } catch {
      // no state.json (not a job dir) or unparseable — skip silently unless it existed
      if (fs.existsSync(file)) jobs.push({ id: e.name, name: `job ${e.name}`, state: 'unknown', detail: '', children: [], tokens: null, result: null, model: null, degraded: 'unparseable state.json' });
    }
  }
  return { data: jobs };
}

/** `claude agents --json --cwd <ws>` — interactive sessions + liveness. */
export function collectAgentsCli({ workspace, exec = execFileSync } = {}) {
  try {
    const out = exec('claude', ['agents', '--json', '--cwd', workspace], {
      encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'ignore'],
    });
    const list = JSON.parse(out);
    if (!Array.isArray(list)) return { notice: 'claude agents returned non-array' };
    return { data: list };
  } catch (err) {
    return { notice: `claude agents unavailable (${err.code ?? 'error'})` };
  }
}

/** Today's scratchpad, parsed. `date` is a local YYYY-MM-DD string. */
export function collectScratchpad({ workspace, date }) {
  const file = path.join(workspace, '.claude', 'session-notes', `${date}.md`);
  let md;
  try {
    md = fs.readFileSync(file, 'utf8');
  } catch {
    return { notice: `no scratchpad at .claude/session-notes/${date}.md` };
  }
  const parsed = splitSections(md);
  const section = (name) => {
    const s = findSection(parsed, name);
    return s ? { groups: parseItems(s) } : null;
  };
  return {
    data: {
      file,
      title: parsed.title,
      marker: findSessionMarker(md),
      overview: section('Overview'),
      todo: section('Todo'),
      notes: section('Notes'),
      scaffold: section('Scaffold'),
    },
  };
}

/** next-session memory + latest diary loose ends. Both best-effort. */
export function collectNextSession({ workspace, hubDir }) {
  const out = { memory: null, diary: null };
  const projDir = '-' + workspace.replaceAll('/', '-').replace(/^-+/, '');
  const memFile = path.join(os.homedir(), '.claude', 'projects', projDir, 'memory', 'next-session-todo.md');
  try {
    const md = fs.readFileSync(memFile, 'utf8');
    out.memory = md.replace(/^---[\s\S]*?---\s*/, '').trim();
  } catch { /* absent is fine */ }
  try {
    const dir = path.join(hubDir, 'diary');
    const files = fs.readdirSync(dir).filter((f) => /^\d{4}-\d{2}-\d{2}(-\d+)?\.md$/.test(f)).sort();
    const newest = files[files.length - 1];
    if (newest) {
      const md = fs.readFileSync(path.join(dir, newest), 'utf8');
      const lines = md.split('\n');
      const start = lines.findIndex((l) => /^##\s+Next session/i.test(l));
      if (start !== -1) {
        let end = lines.length;
        for (let i = start + 1; i < lines.length; i++) {
          if (/^##\s/.test(lines[i])) { end = i; break; }
        }
        out.diary = { file: newest, body: lines.slice(start + 1, end).join('\n').trim() };
      }
    }
  } catch { /* absent is fine */ }
  if (!out.memory && !out.diary) return { notice: 'no next-session memory or diary loose ends found' };
  return { data: out };
}

/**
 * Batched gh sweep: issues + PRs owned by `owner` updated since `sinceIso`,
 * cached at <workspace>/.claude/session-hub/cache/gh-sweep.json with a TTL.
 * Never stored beyond the cache (design: derived, never committed).
 */
export function collectGhSweep({ workspace, sinceIso, owner = 'jwildfire', ttlMs = 5 * 60 * 1000, exec = execFileSync, now = () => Date.now() } = {}) {
  const cacheDir = path.join(workspace, '.claude', 'session-hub', 'cache');
  const cacheFile = path.join(cacheDir, 'gh-sweep.json');
  try {
    const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    if (cached.sinceIso === sinceIso && now() - cached.fetchedAt < ttlMs) {
      return { data: cached };
    }
  } catch { /* cold cache */ }

  const fields = 'repository,number,title,state,url,updatedAt,createdAt,closedAt,isPullRequest';
  const run = (kind, extra = []) =>
    JSON.parse(
      exec('gh', ['search', kind, '--owner', owner, '--updated', `>=${sinceIso}`,
        '--limit', '50', '--sort', 'updated', ...extra,
        '--json', kind === 'prs' ? fields.replace(',isPullRequest', '') : fields],
      { encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'ignore'] }),
    );
  try {
    const issues = run('issues').filter((i) => !i.isPullRequest);
    const prs = run('prs').map((p) => ({ ...p, isPullRequest: true }));
    // the search API reports PRs only as open/closed — a third (cached) query
    // identifies which closed PRs actually merged
    let mergedUrls = new Set();
    try {
      mergedUrls = new Set(run('prs', ['--merged']).map((p) => p.url));
    } catch { /* merged detection is best-effort */ }
    const items = [...issues, ...prs]
      .map((i) => ({
        repo: (i.repository?.nameWithOwner ?? i.repository?.name ?? '').replace(`${owner}/`, ''),
        number: i.number, title: i.title,
        state: mergedUrls.has(i.url) ? 'merged' : (i.state?.toLowerCase?.() ?? ''),
        url: i.url, updatedAt: i.updatedAt, createdAt: i.createdAt, closedAt: i.closedAt,
        isPullRequest: !!i.isPullRequest,
        event: deriveEvent({ ...i, state: mergedUrls.has(i.url) ? 'merged' : i.state }, sinceIso),
      }))
      .sort((a, b) => String(a.updatedAt).localeCompare(String(b.updatedAt)));
    const data = { fetchedAt: now(), sinceIso, items };
    try {
      fs.mkdirSync(cacheDir, { recursive: true });
      fs.writeFileSync(cacheFile, JSON.stringify(data));
    } catch { /* cache write is best-effort */ }
    return { data };
  } catch (err) {
    // fall back to a stale cache if one exists
    try {
      const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      return { data: { ...cached, stale: true } };
    } catch { /* none */ }
    return { notice: `gh sweep failed (${err.code ?? 'error'})` };
  }
}

/** Best-effort event label from search fields (documented in the README). */
export function deriveEvent(item, sinceIso) {
  const closed = item.closedAt && item.closedAt >= sinceIso;
  const created = item.createdAt && item.createdAt >= sinceIso;
  const state = String(item.state ?? '').toLowerCase();
  if (closed && item.isPullRequest) return state === 'merged' ? 'merged' : 'closed';
  if (closed) return 'closed';
  if (created) return 'opened';
  return 'updated';
}
