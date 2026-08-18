#!/usr/bin/env node
// session-audit — the loopback server behind the LOCAL audit lane
// (@jwildfire, 2026-07-27: "make the hosted version read-only and deploy a
// version locally in the hub page that triggers updates via claude code agent
// on click"). The deployed audit page holds no token and cannot write; this
// server is where deciding happens.
//
// It does four things and deliberately nothing else:
//   1. serves the live session dashboard at / (same-origin, like session-chat);
//   2. builds the hub's audit page with AUDIT_MODE=local and serves it at
//      /audit — same queue as the deployed copy, but ✓/✗ are live;
//   3. accepts a decision at POST /api/audit/decision — finding ids and
//      nothing else — and spawns a local Claude Code agent (claude --bg) that
//      runs the apply lane in the hub checkout: fresh-audit re-validation,
//      closed op vocabulary, judgment findings per roadmap-audit-policy.md,
//      ledger committed and pushed under the hub's standing grant;
//   4. reports progress at GET /api/audit/state — the spawned job's state.json
//      beside fresh entries from site/audit/decisions.json, so the page
//      re-reads outcomes from the ledger rather than assuming them (#109 D7).
//
// SECURITY — same posture as session-chat (design #77 §7): binds 127.0.0.1
// with no option to widen, requires JSON + a loopback Origin on writes, holds
// no credentials (the agent writes with the machine's own gh auth), and is not
// a daemon — it runs while someone is looking at the queue and stops with
// them. The payload is ids only: what actually runs is re-derived from a fresh
// audit by scripts/apply_audit_decision.mjs, never taken from the page.
//
// Usage (from the workspace root):
//   node obot.agent/tools/session-hub/session-audit.mjs                # port 4182
//   node obot.agent/tools/session-hub/session-audit.mjs --open
//
// Options:
//   --port <n>          listen port (default 4182), always on 127.0.0.1
//   --workspace <dir>   workspace root (default: cwd)
//   --hub <dir>         obot.roadmap clone (default: <workspace>/obot.roadmap)
//   --model <name>      model for the spawned apply agent (default opus)
//   --dry-run           log the spawn command instead of launching the agent
//   --open              print the URL after binding

import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { execFile, execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { generate } from './session-hub.mjs';
import { originAllowed } from './session-chat.mjs';

const HOST = '127.0.0.1'; // not configurable, by design
const DEFAULT_PORT = 4182;
export const MAX_FINDINGS = 40; // matches the page's MAX_BULK

function parseArgs(argv) {
  const args = { port: DEFAULT_PORT, open: false, dryRun: false, model: 'opus' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--port') args.port = Number(argv[++i]) || DEFAULT_PORT;
    else if (a === '--workspace') args.workspace = argv[++i];
    else if (a === '--hub') args.hub = argv[++i];
    else if (a === '--model') args.model = argv[++i];
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--open') args.open = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else { console.error(`unknown option: ${a}`); process.exit(2); }
  }
  return args;
}

/* ------------------------------------------------------------- validation */

// A finding id is RULE:owner/repo#N (rules are upper-kebab; a few subjects are
// repo-level conventions without a number). Tight on purpose: these strings
// travel into an agent prompt, so anything outside the audit's own vocabulary
// is refused here rather than quoted later.
const ID_RE = /^[A-Z0-9_-]{2,60}:[\w.-]+\/[\w.-]+(#\d+)?$/;

// Two payload shapes, one normal form. The original per-decision shape
// ({decision, findings}) and the queue's batch shape ({batch: [{decision,
// findings}...]}) both come out as `entries` — at most one accept set and one
// reject set, every id checked against the audit's own vocabulary.
export function validateDecision(payload) {
  const p = payload ?? {};
  const raw = Array.isArray(p.batch)
    ? p.batch
    : [{ decision: p.decision, findings: p.findings }];
  if (!raw.length || raw.length > 2) return { error: 'a batch carries one accept set and/or one reject set' };
  const seen = new Set();
  const entries = [];
  let total = 0;
  for (const b of raw) {
    const e = b ?? {};
    if (e.decision !== 'accept' && e.decision !== 'reject') {
      return { error: 'decision must be "accept" or "reject"' };
    }
    if (seen.has(e.decision)) return { error: `two ${e.decision} sets in one batch` };
    seen.add(e.decision);
    const list = Array.isArray(e.findings) ? e.findings : [];
    if (!list.length) return { error: 'at least one finding id is required' };
    total += list.length;
    for (const id of list) {
      if (typeof id !== 'string' || !ID_RE.test(id)) return { error: `not a finding id: ${JSON.stringify(id).slice(0, 80)}` };
    }
    entries.push({ decision: e.decision, findings: [...list] });
  }
  if (total > MAX_FINDINGS) return { error: `at most ${MAX_FINDINGS} findings per submit` };
  const fallback = entries.map((e) => `${e.decision} ${e.findings.length}`).join(' · ');
  // The label is display text from the page and rides into an agent prompt —
  // strip it to a conservative charset so nothing shell- or markdown-shaped
  // survives, whatever the page (or anything POSTing here) sent.
  const label = (typeof p.label === 'string' && p.label.trim()
    ? p.label.replace(/[^\w\s.,:;#/·—-]/g, '').replace(/\s+/g, ' ').trim()
    : fallback).slice(0, 120);
  return { entries, label };
}

/* -------------------------------------------------------------- the agent */

// The whole contract in one prompt: ids only, fresh-audit re-validation, the
// bounded-agent policy for judgment findings, hub grant limits, a run token so
// delegated ledger entries can be finalized — and worktree isolation, so
// several apply agents can run at once without racing the shared checkout.
export function agentPrompt({ entries, hub, runToken, label, workspace }) {
  const decisions = entries.flatMap((e) => [
    `Decision: ${e.decision}`,
    ...e.findings.map((id) => `- ${id}`),
  ]);
  // WHOSE NAME THE APPLY GOES OUT UNDER — obot.agent#197. This lane ran entirely on
  // `gh auth token`, which authenticates as @jwildfire, so every label, milestone,
  // assignee and close it applied was recorded by GitHub as his own act on issues he
  // had not read. apply_audit_decision.mjs already separates the two credentials
  // (GH_TOKEN for repo operations, PROJECT_TOKEN for the board), so the repo half
  // simply moves to the app token and stops lying.
  //
  // The board half cannot move. A GitHub App installed on a user account cannot reach
  // a user-owned ProjectsV2 board at all — GitHub's REST reference says so on every
  // user-owned project endpoint ("does not work with ... GitHub App installation
  // access tokens"), and there is no permission to grant: the only Projects permission
  // GitHub offers is organization-scoped. So PROJECT_TOKEN stays his, and stays
  // spelled out here rather than being folded back into one token that hides which
  // writes are which.
  const root = workspace ?? path.dirname(path.resolve(hub));
  const appToken = path.join(root, 'obot.agent/scripts/obot-app-token');
  const applies = entries.map((e) =>
    `AUDIT_AGENTIC_PACK="$CLAUDE_JOB_DIR/tmp/audit-agentic.md" GH_TOKEN="$(${appToken})" PROJECT_TOKEN="$(gh auth token)" node scripts/apply_audit_decision.mjs --decision ${e.decision} --findings ${e.findings.join(',')} --by jwildfire --run-id ${runToken}`);
  return [
    `You are one local audit apply lane for jwildfire/obot.roadmap. @jwildfire submitted "${label.replace(/"/g, "'")}" from the local hub audit queue; you complete that batch. The payload is finding ids only — what runs is derived from a FRESH audit, never from the page. Other apply agents may be running in parallel: you own your worktree, and main is shared — take rejected pushes calmly.`,
    '',
    ...decisions,
    '',
    `Hub checkout: ${hub}`,
    'Steps:',
    `1. Work in your OWN worktree: cd ${hub} && git fetch origin && git worktree add .claude/worktrees/audit-apply-${runToken} -b audit-apply-${runToken} origin/main, then cd into it. Never edit the shared checkout. The hub standing grant covers standard updates to main — never delete files, issues or history.`,
    '2. In the worktree, run each apply in order:',
    ...applies.map((c) => `   ${c}`),
    '   The script re-runs the whole audit, refuses ids the current state no longer reports (stale) or could not check (blocked), applies mechanical ops directly, appends every outcome to site/audit/decisions.json, and writes judgment findings to the pack file.',
    `3. If the pack file is non-empty after the accept run, work it one finding at a time. .github/roadmap-audit-policy.md is binding — only the operations the pack asks for, nothing broader. Any gh write you type yourself goes through ${root}/obot.agent/scripts/obot-gh, which mints an obotclaw[bot] token — the ambient gh token authenticates as @jwildfire and records him as having done it (obot.agent#197). Then finalize the delegated entries: node scripts/apply_audit_decision.mjs --finalize-run ${runToken} --outcome applied (or failed, if a finding could not be completed — never claim applied for work not done).`,
    '4. Commit in the worktree, then land on main: git push origin HEAD:main. If the push is rejected (another apply agent landed first), git pull --rebase origin main and retry, up to 3 times. A conflict in site/audit/decisions.json is two appends to the same array — keep BOTH sets of entries. A conflict in site/audit/findings.json: keep the other side (theirs) — it is as fresh as yours and the next audit run rewrites it anyway. Verify the push landed (git ls-remote origin main).',
    `5. Clean up: from ${hub}, git worktree remove .claude/worktrees/audit-apply-${runToken} --force and git branch -D audit-apply-${runToken}.`,
    '6. End with a result: line summarizing the outcome per finding id.',
    '',
    'If a step fails honestly (audit cannot run, push still rejected after 3 rebases), push nothing inconsistent, leave the worktree for inspection, and say exactly what happened in the result line — never retry-forever, never force-push.',
  ].join('\n');
}

export function spawnArgs({ name, prompt, model }) {
  // Background siblings spawn unbridged (@jwildfire 2026-08-15 — obot.agent
  // docs/remote-control.md). Dropping --remote-control would not be enough:
  // the global remoteControlAtStartup setting bridges a flagless spawn too, so
  // the opt-out has to force the key off for this process.
  const args = [
    '--bg',
    '--permission-mode', 'auto',
    '--settings', JSON.stringify({ remoteControlAtStartup: false }),
    '-n', name,
  ];
  if (model) args.push('--model', model);
  args.push(prompt);
  return args;
}

function localDate(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Find the job the spawn created: newest jobs-dir entry whose intent carries
// our run token. claude --bg prints human text, not a stable id, so the
// filesystem is the join — the token rides in the prompt.
export function findJobByToken(runToken, { jobsDir = path.join(os.homedir(), '.claude', 'jobs') } = {}) {
  let entries;
  try {
    entries = fs.readdirSync(jobsDir, { withFileTypes: true }).filter((e) => e.isDirectory());
  } catch {
    return null;
  }
  for (const e of entries) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(jobsDir, e.name, 'state.json'), 'utf8'));
      if (typeof raw.intent === 'string' && raw.intent.includes(runToken)) return e.name;
    } catch { /* not a job */ }
  }
  return null;
}

export function jobState(job, { jobsDir = path.join(os.homedir(), '.claude', 'jobs') } = {}) {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(jobsDir, job, 'state.json'), 'utf8'));
    return {
      state: typeof raw.state === 'string' ? raw.state : 'unknown',
      detail: typeof raw.detail === 'string' ? raw.detail : '',
      terminal: Boolean(raw.firstTerminalAt),
      updatedAt: raw.updatedAt ?? null,
    };
  } catch {
    return { state: 'unknown', detail: '', terminal: false, updatedAt: null };
  }
}

/* -------------------------------------------------------------- the ledger */

// Fresh read on every call — the whole point is that outcomes come from the
// file the agent commits, not from anything this server remembers.
export function decisionsFor(hub, ids) {
  let ledger;
  try {
    ledger = JSON.parse(fs.readFileSync(path.join(hub, 'site', 'audit', 'decisions.json'), 'utf8'));
  } catch {
    return [];
  }
  const wanted = new Set(ids);
  const latest = new Map();
  for (const d of ledger.decisions ?? []) {
    if (!wanted.has(d.id)) continue;
    const prev = latest.get(d.id);
    if (!prev || String(d.at) >= String(prev.at)) latest.set(d.id, d);
  }
  return [...latest.values()].map((d) => ({ id: d.id, outcome: d.outcome, detail: d.detail ?? null, at: d.at }));
}

/* --------------------------------------------------------------- the page */

// Build the hub's audit page in local mode when its sources moved. The build
// only reads committed files, so it needs no token and takes well under a
// second; a failed build serves the previous copy with a warning rather than
// a blank queue.
function auditPage(hub, cache) {
  const srcs = ['site/audit/findings.json', 'site/audit/decisions.json', 'scripts/build_audit_page.mjs'];
  const stamp = srcs.map((s) => {
    try { return fs.statSync(path.join(hub, s)).mtimeMs; } catch { return 0; }
  }).join(':');
  if (cache.html && cache.stamp === stamp) return cache.html;
  try {
    execFileSync('node', ['scripts/build_audit_page.mjs'], {
      cwd: hub, env: { ...process.env, AUDIT_MODE: 'local' }, stdio: 'pipe',
    });
    cache.html = fs.readFileSync(path.join(hub, '_site', 'audit', 'index.html'), 'utf8');
    cache.stamp = stamp;
  } catch (err) {
    console.error(`[session-audit] audit page build failed: ${err.message}`);
    if (!cache.html) throw err;
  }
  return cache.html;
}

/* ---------------------------------------------------------------- server */

const json = (res, code, body) => {
  const text = JSON.stringify(body);
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
    'cache-control': 'no-store',
  });
  res.end(text);
};

export function createServer({ workspace, hub, port, model = 'opus', dryRun = false, spawn = null }) {
  const pageCache = { html: null, stamp: null };
  let dashCache = { html: null, at: 0 };
  // Several submits may run at once (@jwildfire, 2026-07-27 follow-up: no
  // serialization) — each agent gets its own hub worktree, and the ledger
  // merge is the agents' push-rebase loop, not a server lock.
  const runs = new Map(); // runToken → { job, ids, at }

  const launch = spawn ?? ((args, opts, cb) => {
    const child = execFile('claude', args, { ...opts, timeout: 60_000 }, (err, stdout, stderr) => cb(err, `${stdout}\n${stderr}`));
    child.unref?.();
  });

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${HOST}:${port}`);
    if (req.method === 'POST' && !originAllowed(req.headers.origin, port)) {
      json(res, 403, { error: 'cross-origin write refused' });
      return;
    }

    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      const now = Date.now();
      if (!dashCache.html || now - dashCache.at > 20_000) {
        try {
          const { html } = generate({ workspace, hub, mode: 'live' });
          dashCache = { html, at: now };
        } catch (err) {
          if (!dashCache.html) { json(res, 500, { error: `render failed: ${err.message}` }); return; }
        }
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(dashCache.html);
      return;
    }

    if (req.method === 'GET' && (url.pathname === '/audit' || url.pathname === '/audit/' || url.pathname === '/audit/index.html')) {
      let html;
      try { html = auditPage(hub, pageCache); } catch (err) { json(res, 500, { error: `audit build failed: ${err.message}` }); return; }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(html);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/assets/styles.css') {
      try {
        const css = fs.readFileSync(path.join(hub, 'site', 'assets', 'styles.css'));
        res.writeHead(200, { 'content-type': 'text/css; charset=utf-8', 'cache-control': 'no-store' });
        res.end(css);
      } catch { json(res, 404, { error: 'stylesheet not found' }); }
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/audit/state') {
      const job = url.searchParams.get('job') || '';
      const ids = (url.searchParams.get('ids') || '').split(',').filter(Boolean);
      json(res, 200, {
        job: job ? jobState(job) : null,
        decisions: decisionsFor(hub, ids),
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/audit/decision') {
      if (!String(req.headers['content-type'] ?? '').includes('application/json')) {
        json(res, 415, { error: 'application/json required' });
        return;
      }
      let body = '';
      req.on('data', (c) => { body += c; if (body.length > 64_000) req.destroy(); });
      req.on('end', () => {
        let payload;
        try { payload = JSON.parse(body); } catch { json(res, 400, { error: 'bad JSON' }); return; }
        const v = validateDecision(payload);
        if (v.error) { json(res, 400, { error: v.error }); return; }
        const runToken = `local-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
        const name = `👯🤖 ${localDate()} audit-apply ${runToken.slice(-4)}`;
        const prompt = agentPrompt({ ...v, hub, runToken, workspace });
        const args = spawnArgs({ name, prompt, model });
        if (dryRun) {
          console.log(`[session-audit] dry-run — would spawn: claude ${args.slice(0, -1).join(' ')} <prompt ${prompt.length} chars>`);
          json(res, 200, { job: null, runToken, dryRun: true });
          return;
        }
        launch(args, { cwd: hub }, (err, output) => {
          if (err) console.error(`[session-audit] spawn: ${err.message} ${String(output).slice(0, 200)}`);
        });
        // The job directory appears within a beat of the spawn; the token in
        // the prompt is the join key. Reply as soon as it shows up (or after
        // ~8s with job:null — the page still lands outcomes via the ledger).
        const started = Date.now();
        const wait = () => {
          const job = findJobByToken(runToken);
          if (job) {
            const ids = v.entries.flatMap((e) => e.findings);
            runs.set(runToken, { job, ids, at: started });
            console.log(`[session-audit] ${v.label} → job ${job} (${runToken})`);
            json(res, 200, { job, runToken });
          } else if (Date.now() - started > 8000) {
            console.warn(`[session-audit] spawned but no job with token ${runToken} found yet`);
            json(res, 200, { job: null, runToken });
          } else {
            setTimeout(wait, 400);
          }
        };
        wait();
      });
      return;
    }

    json(res, 404, { error: 'not found' });
  });

  return server;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 40).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
    return;
  }
  const workspace = path.resolve(args.workspace ?? process.cwd());
  const hub = path.resolve(args.hub ?? path.join(workspace, 'obot.roadmap'));
  if (!fs.existsSync(path.join(hub, 'scripts', 'build_audit_page.mjs'))) {
    console.error(`[session-audit] ${hub} does not look like an obot.roadmap checkout`);
    process.exit(1);
  }
  const server = createServer({ workspace, hub, port: args.port, model: args.model, dryRun: args.dryRun });
  server.listen(args.port, HOST, () => {
    const url = `http://${HOST}:${args.port}/audit`;
    console.log(`[session-audit] listening on ${url} (loopback only) · hub ${hub}${args.dryRun ? ' · DRY RUN' : ''}`);
    if (args.open) console.log(url);
  });
  server.on('error', (err) => {
    console.error(`[session-audit] ${err.code === 'EADDRINUSE' ? `port ${args.port} already in use` : err.message}`);
    process.exit(1);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
