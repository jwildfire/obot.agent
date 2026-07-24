#!/usr/bin/env node
// session-hub — one-page live dashboard + frozen wrapup report for obot working
// sessions. Design: jwildfire/obot.roadmap#24 (requirements/design/24_design.html).
//
// Zero dependencies. Read-only over sources the session framework already
// maintains; the only thing it writes is the rendered HTML (and a gh-sweep cache).
//
// Usage (from the workspace root):
//   node obot.agent/tools/session-hub/session-hub.mjs                # one live render
//   node obot.agent/tools/session-hub/session-hub.mjs --watch        # live mode, ~60s loop
//   node obot.agent/tools/session-hub/session-hub.mjs --report       # frozen wrapup report
//
// Options:
//   --workspace <dir>   workspace root (default: cwd)
//   --hub <dir>         obot.roadmap clone (default: <workspace>/obot.roadmap)
//   --out <file>        output path (defaults: live → .claude/session-hub/live.html,
//                       report → <hub>/reports/sessions/<slug>.html)
//   --slug <slug>       report slug override (default: derived from the session marker)
//   --interval <sec>    watch interval (default 60)
//   --open              print the file:// URL after the first render
//   --emit-state <file> also write a small session-state JSON (see sessionState below)

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import {
  collectJobs, collectAgentsCli, collectScratchpad, collectNextSession, collectGhSweep,
} from './lib/collect.mjs';
import { buildModel } from './lib/model.mjs';
import { render } from './lib/render.mjs';

function parseArgs(argv) {
  const args = { watch: false, report: false, open: false, interval: 60 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--watch') args.watch = true;
    else if (a === '--report') args.report = true;
    else if (a === '--open') args.open = true;
    else if (a === '--workspace') args.workspace = argv[++i];
    else if (a === '--hub') args.hub = argv[++i];
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--slug') args.slug = argv[++i];
    else if (a === '--interval') args.interval = Number(argv[++i]) || 60;
    else if (a === '--emit-state') args.emitState = argv[++i];
    else if (a === '--help' || a === '-h') { args.help = true; }
    else { console.error(`unknown option: ${a}`); process.exit(2); }
  }
  return args;
}

function localDate(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Compact, publishable projection of the model for the roadmap page's session
// indicator (jwildfire/obot.roadmap#57). Deliberately aggregate-only: the hub site
// is public, and agent-authored `detail` strings are free text, so this publishes
// counts and the session slug rather than forwarding whatever a running agent
// happened to write about itself.
export function sessionState(model) {
  const byState = model.tiles.agents.byState ?? {};
  const working = byState.working ?? 0;
  const needsInput = model.alerts.length;
  const state = needsInput > 0 ? 'needs-input' : working > 0 ? 'working' : 'idle';
  const parts = [`${model.tiles.agents.total} agent${model.tiles.agents.total === 1 ? '' : 's'}`];
  if (working) parts.push(`${working} working`);
  if (needsInput) parts.push(`${needsInput} needs input`);
  return {
    state,
    name: `obot session ${model.slug}`,
    detail: parts.join(' · '),
    agents: { total: model.tiles.agents.total, working, needsInput },
    slug: model.slug,
    updatedAt: model.generatedAtIso,
  };
}

export function generate({ workspace, hub, slug, mode }) {
  const date = localDate();
  const collected = {
    jobs: collectJobs(),
    agentsCli: collectAgentsCli({ workspace }),
    scratchpad: collectScratchpad({ workspace, date }),
    nextSession: collectNextSession({ workspace, hubDir: hub }),
  };
  // boundary needs scratchpad+jobs; the gh sweep needs the boundary
  const probe = buildModel({
    collected: { ...collected, ghSweep: { notice: 'pending' } },
    workspace, date, mode, generatedAtIso: new Date().toISOString(),
    tzOffsetMinutes: new Date().getTimezoneOffset(),
  });
  collected.ghSweep = collectGhSweep({ workspace, sinceIso: probe.boundary.startIso });
  const model = buildModel({
    collected, workspace, date, mode, slug,
    generatedAtIso: new Date().toISOString(),
    tzOffsetMinutes: new Date().getTimezoneOffset(),
  });
  return { model, html: render(model) };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 23).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
    return;
  }
  const workspace = path.resolve(args.workspace ?? process.cwd());
  const hub = path.resolve(args.hub ?? path.join(workspace, 'obot.roadmap'));
  const mode = args.report ? 'report' : 'live';

  const once = () => {
    const { model, html } = generate({ workspace, hub, slug: args.slug, mode });
    const out = path.resolve(
      args.out ??
        (mode === 'report'
          ? path.join(hub, 'reports', 'sessions', `${model.slug}.html`)
          : path.join(workspace, '.claude', 'session-hub', 'live.html')),
    );
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, html);
    if (args.emitState) {
      const statePath = path.resolve(args.emitState);
      fs.mkdirSync(path.dirname(statePath), { recursive: true });
      fs.writeFileSync(statePath, `${JSON.stringify(sessionState(model), null, 2)}\n`);
    }
    const notices = Object.entries(model.notices).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`);
    console.log(`[session-hub] ${mode} → ${out}` + (notices.length ? `  (degraded — ${notices.join('; ')})` : ''));
    return out;
  };

  const out = once();
  if (args.open) console.log(`file://${out}`);
  if (args.watch && mode === 'live') {
    console.log(`[session-hub] watching — regenerating every ${args.interval}s (ctrl-c to stop)`);
    setInterval(() => {
      try { once(); } catch (err) { console.error(`[session-hub] render failed: ${err.message}`); }
    }, args.interval * 1000);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
