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

export function validateDecision(payload) {
  const p = payload ?? {};
  if (p.decision !== 'accept' && p.decision !== 'reject') {
    return { error: 'decision must be "accept" or "reject"' };
  }
  const list = Array.isArray(p.findings) ? p.findings : [];
  if (!list.length) return { error: 'at least one finding id is required' };
  if (list.length > MAX_FINDINGS) return { error: `at most ${MAX_FINDINGS} findings per decision` };
  for (const id of list) {
    if (typeof id !== 'string' || !ID_RE.test(id)) return { error: `not a finding id: ${JSON.stringify(id).slice(0, 80)}` };
  }
  // The label is display text from the page and rides into an agent prompt —
  // strip it to a conservative charset so nothing shell- or markdown-shaped
  // survives, whatever the page (or anything POSTing here) sent.
  const label = (typeof p.label === 'string' && p.label.trim()
    ? p.label.replace(/[^\w\s.,:;#/·—-]/g, '').replace(/\s+/g, ' ').trim()
    : `${p.decision} ${list.length} finding${list.length === 1 ? '' : 's'}`).slice(0, 120);
  return { decision: p.decision, findings: [...list], label };
}

/* -------------------------------------------------------------- the agent */

// The whole contract in one prompt: ids only, fresh-audit re-validation, the
// bounded-agent policy for judgment findings, hub grant limits, and a run
// token so delegated ledger entries can be finalized by the same lane.
export function agentPrompt({ decision, findings, hub, runToken, label }) {
  return [
    `You are the local audit apply lane for jwildfire/obot.roadmap. @jwildfire clicked "${label.replace(/"/g, "'")}" on the local hub audit page; you complete that decision. The payload is finding ids only — what runs is derived from a FRESH audit, never from the page.`,
    '',
    `Decision: ${decision}`,
    'Finding ids:',
    ...findings.map((id) => `- ${id}`),
    '',
    `Hub checkout: ${hub}`,
    'Steps:',
    `1. cd ${hub} && git pull --ff-only (work on main; the hub standing grant covers standard updates — never delete files, issues or history).`,
    `2. Run: AUDIT_AGENTIC_PACK="$CLAUDE_JOB_DIR/tmp/audit-agentic.md" GITHUB_TOKEN="$(gh auth token)" node scripts/apply_audit_decision.mjs --decision ${decision} --findings ${findings.join(',')} --by jwildfire --run-id ${runToken}`,
    '   It re-runs the whole audit, refuses ids the current state no longer reports (stale) or could not check (blocked), applies mechanical ops directly, appends every outcome to site/audit/decisions.json, and writes judgment findings to the pack file.',
    '3. If the pack file is non-empty, work it one finding at a time. .github/roadmap-audit-policy.md is binding — only the operations the pack asks for, nothing broader. Then finalize the delegated entries: node scripts/apply_audit_decision.mjs --finalize-run ' + runToken + ' --outcome applied (or failed, if a finding could not be completed — never claim applied for work not done).',
    '4. Commit the ledger and any changed files to main and push; verify the push landed (git ls-remote). The local audit page reads outcomes from this ledger, so the decision is not done until the commit exists.',
    '5. End with a result: line summarizing the outcome per finding id.',
    '',
    'If a step fails honestly (audit cannot run, push rejected), record what happened in the ledger where the script already did, push what is consistent, and say so in the result line — never retry-forever, never force-push.',
  ].join('\n');
}

export function spawnArgs({ name, prompt, model }) {
  const args = ['--bg', '--permission-mode', 'auto', '-n', name];
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
  const runs = new Map(); // runToken → { job, ids, decision, at }

  // One decision at a time: the apply lane serializes on GitHub for the same
  // reason (board mutations must not interleave), so the local lane does too.
  let inFlight = null;

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
        if (inFlight && !jobState(inFlight).terminal) {
          json(res, 409, { error: `a decision is already being applied (job ${inFlight}) — wait for it to land` });
          return;
        }
        const runToken = `local-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
        const name = `👯🤖 ${localDate()} audit-apply`;
        const prompt = agentPrompt({ ...v, hub, runToken });
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
            inFlight = job;
            runs.set(runToken, { job, ids: v.findings, decision: v.decision, at: started });
            console.log(`[session-audit] ${v.decision} ${v.findings.length} finding(s) → job ${job} (${runToken})`);
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
