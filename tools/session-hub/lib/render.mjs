// Renderer (design #24 §5): one self-contained HTML page from the session model.
// Visual system = the concept mockup's (warm palette, light/dark, inline CSS).
// Every panel header names its source; degraded collectors render a notice line.

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Escape, then apply minimal inline markdown: `code`, [text](url), **bold**, bare URLs. */
export function inline(text) {
  let s = esc(text);
  s = s.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2">$1</a>');
  s = s.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, (m, pre, url) => `${pre}<a href="${url}">${shortUrl(url)}</a>`);
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  return s;
}

function shortUrl(url) {
  const gh = url.match(/github\.com\/[^/]+\/([^/]+)\/(?:issues|pull)\/(\d+)/);
  if (gh) return `${gh[1]}#${gh[2]}`;
  return url.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

const AGENT_COLORS = {
  orange: 'var(--agent-orange)', green: 'var(--agent-green)', pink: 'var(--agent-pink)',
  blue: 'var(--agent-blue)', purple: 'var(--agent-purple)',
};
const agentDot = (color) => AGENT_COLORS[color] ?? 'var(--agent-none)';

const STATE_PILL = {
  working: ['working', '●'], 'needs-input': ['blocked', '⏸'], failed: ['failed', '✕'],
  done: ['done', '✓'], idle: ['idle', '○'], unknown: ['idle', '?'],
};

function fmtTokens(n) {
  if (typeof n !== 'number') return '—';
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

function fmtTime(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  } catch { return ''; }
}

function fmtDuration(a, b) {
  if (!a || !b) return '';
  const min = Math.max(0, Math.round((new Date(b) - new Date(a)) / 60000));
  return min >= 60 ? `${Math.floor(min / 60)}h ${min % 60}m` : `${min}m`;
}

const notice = (msg) => (msg ? `<p class="notice">⚠ ${esc(msg)}</p>` : '');

function itemsList(groups, { numbered = false } = {}) {
  if (!groups) return '';
  let n = 0;
  return groups
    .filter((g) => g.items.length)
    .map((g) => {
      const label = g.group ? `<div class="group-label">${esc(g.group)}</div>` : '';
      const lis = g.items
        .map((it) => {
          n++;
          const box = it.checked === null ? '' : `<span class="box${it.checked ? ' done' : ''}"></span>`;
          const num = numbered && !it.prose ? `<span class="num">${n}</span>` : '';
          const time = it.time ? `<time>${esc(it.time)}</time>` : '';
          const cls = it.checked === true ? ' class="is-done"' : '';
          return `<li${cls}>${box}${num}${time}<span class="txt">${inline(it.text)}</span></li>`;
        })
        .join('\n');
      return `${label}<ul class="todo">${lis}</ul>`;
    })
    .join('\n');
}

function panel(title, src, body, { badge = '' } = {}) {
  return `<section class="panel">
  <div class="panel-head"><h2>${title}${badge}</h2><span class="src">${esc(src)}</span></div>
  <div class="panel-body">${body}</div>
</section>`;
}

function agentCard(a, mode) {
  const [pillCls, icon] = STATE_PILL[a.state] ?? STATE_PILL.unknown;
  const maxTok = 400000;
  const pct = typeof a.tokens === 'number' ? Math.min(100, Math.round((a.tokens / maxTok) * 100)) : 0;
  const since =
    mode === 'report' && a.createdAt
      ? `${fmtTime(a.createdAt)}–${fmtTime(a.updatedAt)} (${fmtDuration(a.createdAt, a.updatedAt)})`
      : a.createdAt ? `since ${fmtTime(a.createdAt)}` : '';
  const chips = (a.children ?? [])
    .map((c) => `<a class="refchip" href="${esc(c.href)}">${esc(c.kind === 'pr' ? 'PR ' : '')}${esc(shortUrl(c.href))}</a>`)
    .join(' ');
  const detail = mode === 'report' && a.result ? a.result : a.detail;
  const dot = agentDot(a.color);
  return `<div class="agent">
  <div class="agent-top">
    <span class="agent-dot" style="background:${dot}"></span>
    <span class="agent-name">${esc(a.name)}</span>
    <span class="pill ${pillCls}"><i>${icon}</i>${esc(a.state)}${a.stale ? ' (stale)' : ''}</span>
  </div>
  ${detail ? `<div class="agent-detail">${inline(detail)}</div>` : ''}
  <div class="agent-meta">
    ${since ? `<span>${esc(since)}</span>` : ''}
    ${typeof a.tokens === 'number' ? `<span class="tokbar"><b style="width:${pct}%;background:${dot}"></b></span><span>${fmtTokens(a.tokens)} tok</span>` : ''}
    ${a.model ? `<span>${esc(a.model)}</span>` : ''}
    ${a.kind === 'interactive' ? '<span>interactive</span>' : ''}
  </div>
  ${chips ? `<div class="agent-chips">${chips}</div>` : ''}
  ${a.degraded ? `<div class="notice">⚠ ${esc(a.degraded)}</div>` : ''}
</div>`;
}

function activityFeed(items) {
  if (!items?.length) return '<p class="notice">no roadmap activity since session start</p>';
  return `<div class="feed">${items
    .map(
      (i) => `<div class="evt"><time>${fmtTime(i.updatedAt)}</time><span class="repo">${esc(i.repo)}</span><span class="txt"><a href="${esc(i.url)}">${esc(i.isPullRequest ? 'PR ' : '')}#${i.number}</a> ${esc(i.title)} — <strong>${esc(i.event)}</strong></span></div>`,
    )
    .join('\n')}</div>`;
}

export function render(model) {
  const m = model;
  const isReport = m.mode === 'report';
  const stamp = `generated ${fmtTime(m.generatedAtIso)}${isReport ? '' : ' · auto-refresh 60s'}`;
  const stateCounts = Object.entries(m.tiles.agents.byState)
    .map(([k, v]) => `${v} ${k}`)
    .join(' · ');

  const banner = isReport
    ? `<div class="banner ok"><span class="dot"></span>Session report — frozen at wrapup. ${m.tiles.agents.total} agents, ${fmtTokens(m.tiles.tokens.total)} tokens, ${m.tiles.activity ?? '?'} roadmap events.</div>`
    : m.alerts.length
      ? `<div class="banner"><span class="dot"></span>${m.alerts.map((a) => `${esc(a.name)} — ${esc(a.state)}${a.detail ? `: ${esc(a.detail)}` : ''}`).join(' · ')}</div>`
      : '';

  const nextSessionBody = m.panels.nextSession
    ? [
        m.panels.nextSession.memory ? `<div class="prose">${inline(m.panels.nextSession.memory)}</div>` : '',
        m.panels.nextSession.diary
          ? `<div class="group-label">last diary (${esc(m.panels.nextSession.diary.file)})</div><div class="prose">${m.panels.nextSession.diary.body.split('\n').filter((l) => l.trim()).slice(0, 12).map((l) => `<div>${inline(l)}</div>`).join('')}</div>`
          : '',
      ].join('\n')
    : '';

  const left = [
    panel('Priorities', 'scratchpad · ## Overview (session-init)',
      notice(m.notices.scratchpad) + (m.panels.overview ? itemsList(m.panels.overview.groups, { numbered: true }) : notice(m.panels.overview === null && !m.notices.scratchpad ? 'no ## Overview section in today’s scratchpad' : ''))),
    m.panels.todo ? panel('Todo', 'scratchpad · ## Todo (session-update)', itemsList(m.panels.todo.groups)) : '',
    panel('Roadmap activity', `gh search issues/prs · updated ≥ session start (derived, cached${m.sweepFetchedAt ? ` · swept ${fmtTime(new Date(m.sweepFetchedAt).toISOString())}` : ''})`,
      notice(m.notices.ghSweep) + (m.panels.activity ? activityFeed(m.panels.activity) : '')),
  ].filter(Boolean).join('\n');

  const right = [
    panel('Agents', '~/.claude/jobs/*/state.json + claude agents --json',
      notice(m.notices.jobs) + notice(m.notices.agentsCli) +
      (m.agents.length ? `<div class="agents">${m.agents.map((a) => agentCard(a, m.mode)).join('\n')}</div>` : '<p class="notice">no sessions in scope</p>')),
    panel('Notes', 'scratchpad · ## Notes (session-note)',
      m.panels.notes ? itemsList(m.panels.notes.groups) : notice('no ## Notes section in today’s scratchpad')),
    panel('Scaffold improvements', 'scratchpad · ## Scaffold (session-scaffold)',
      m.panels.scaffold ? itemsList(m.panels.scaffold.groups) : notice('no ## Scaffold section yet — capture with "scaffold: …"')),
    panel('Next session', 'next-session-todo memory + last diary loose ends',
      notice(m.notices.nextSession) + nextSessionBody, { badge: ' <span class="badge-new">render-only</span>' }),
  ].join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${isReport ? '' : '<meta http-equiv="refresh" content="60">'}
<title>${isReport ? `Session report ${esc(m.slug)}` : `Session hub — ${esc(m.date)}`} · obot</title>
<style>${CSS}</style>
</head>
<body>
<div class="wrap">
<header>
  <div class="eyebrow">obot session hub${isReport ? ' · session report' : ''}</div>
  <div class="masthead">
    <h1>Session ${esc(m.slug)} <span class="ws">· ${esc(m.workspace.split('/').pop())}</span></h1>
    <div class="header-meta">
      <span class="mode"><span class="${isReport ? '' : 'on'}">● Live</span><span class="${isReport ? 'on' : ''}">Report</span></span>
      <span class="stamp">${esc(stamp)}</span>
    </div>
  </div>
  ${banner}
</header>

<section class="tiles">
  <div class="tile"><span class="label">Priorities</span><span class="value">${m.tiles.priorities.open} <small>open · ${m.tiles.priorities.done} done</small></span><span class="sub">scratchpad kickoff list</span></div>
  <div class="tile"><span class="label">Agents</span><span class="value">${m.tiles.agents.total}</span><span class="sub">${esc(stateCounts) || '—'}</span></div>
  <div class="tile"><span class="label">Tokens</span><span class="value">${fmtTokens(m.tiles.tokens.total)}</span><span class="sub">across ${m.tiles.tokens.reporting} reporting sessions</span></div>
  <div class="tile"><span class="label">Roadmap movement</span><span class="value">${m.tiles.activity ?? '—'} <small>events</small></span><span class="sub">since session start</span></div>
</section>

<div class="grid">
  <div class="col">${left}</div>
  <div class="col">${right}</div>
</div>

<div class="foot">${isReport ? `frozen operational record · pairs with diary/${esc(m.slug)}.md` : 'live view · panels annotate their sources'} · boundary: ${esc(m.boundary.anchor)} (${fmtTime(m.boundary.startIso)}) · session-hub (obot.agent v0.2 · <a href="https://github.com/jwildfire/obot.roadmap/issues/24">#24</a>)</div>
</div>
${isReport ? '' : SCROLL_RESTORE}
</body>
</html>
`;
}

const SCROLL_RESTORE = `<script>
(function(){
  try {
    var k='session-hub-scroll';
    var y=sessionStorage.getItem(k);
    if(y!==null) window.scrollTo(0,Number(y));
    addEventListener('scroll',function(){sessionStorage.setItem(k,String(window.scrollY));},{passive:true});
  } catch(e){}
})();
</script>`;

const CSS = `
  :root {
    --ground:#faf8f5; --panel:#fff; --panel-2:#f3f0eb; --ink:#26221c; --ink-2:#5c564c;
    --ink-3:#8a8378; --line:#e4dfd6; --accent:#c2540a; --accent-ink:#a34406; --accent-tint:#faeadd;
    --good:#1a7f4b; --good-tint:#e2f2e8; --warn:#8a6100; --warn-tint:#f7ecd0;
    --idle:#6b7280; --idle-tint:#ecebe7; --bad:#b3261e; --bad-tint:#f9e4e2;
    --agent-orange:#d97706; --agent-green:#1a7f4b; --agent-pink:#d0459b; --agent-blue:#2563eb;
    --agent-purple:#7c3aed; --agent-none:#9a938a;
    --shadow:0 1px 2px rgba(38,34,28,.05),0 4px 14px rgba(38,34,28,.04);
    --mono:ui-monospace,"SF Mono",Menlo,Consolas,monospace;
    --sans:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --ground:#191712; --panel:#211e18; --panel-2:#2a2620; --ink:#ece7dd; --ink-2:#b3aa9b;
      --ink-3:#7d7568; --line:#363129; --accent:#f08c3e; --accent-ink:#f3a163; --accent-tint:#38281a;
      --good:#58c389; --good-tint:#1d3227; --warn:#e3b341; --warn-tint:#362d17;
      --idle:#9aa2ad; --idle-tint:#2b2925; --bad:#e5736c; --bad-tint:#3a201e;
      --agent-orange:#f59e0b; --agent-green:#58c389; --agent-pink:#ec6cb9; --agent-blue:#60a5fa;
      --agent-purple:#a78bfa; --agent-none:#857d71; --shadow:none;
    }
  }
  * { box-sizing:border-box; }
  body { background:var(--ground); color:var(--ink); font-family:var(--sans); font-size:14px;
         line-height:1.5; margin:0; padding:24px 20px 48px; }
  a { color:var(--accent-ink); text-decoration:none; }
  a:hover { text-decoration:underline; }
  code { font-family:var(--mono); font-size:.9em; background:var(--panel-2); border-radius:4px; padding:0 4px; }
  .wrap { max-width:1180px; margin:0 auto; display:flex; flex-direction:column; gap:16px; }
  header { display:flex; flex-direction:column; gap:10px; }
  .eyebrow { font-family:var(--mono); font-size:11px; letter-spacing:.14em; text-transform:uppercase; color:var(--accent-ink); }
  .masthead { display:flex; align-items:baseline; justify-content:space-between; gap:16px; flex-wrap:wrap; }
  h1 { font-size:26px; font-weight:650; margin:0; letter-spacing:-.01em; }
  h1 .ws { color:var(--ink-3); font-weight:400; }
  .header-meta { display:flex; align-items:center; gap:12px; flex-wrap:wrap; }
  .mode { display:inline-flex; border:1px solid var(--line); border-radius:999px; overflow:hidden;
          font-family:var(--mono); font-size:11.5px; }
  .mode span { padding:4px 12px; color:var(--ink-3); }
  .mode .on { background:var(--accent-tint); color:var(--accent-ink); font-weight:600; }
  .stamp { font-family:var(--mono); font-size:11.5px; color:var(--ink-3); }
  .banner { display:flex; align-items:center; gap:10px; background:var(--warn-tint); color:var(--warn);
            border:1px solid color-mix(in srgb,var(--warn) 30%,transparent); border-radius:8px;
            padding:9px 14px; font-size:13px; font-weight:500; }
  .banner.ok { background:var(--good-tint); color:var(--good); border-color:color-mix(in srgb,var(--good) 30%,transparent); }
  .banner .dot { flex:none; width:8px; height:8px; border-radius:50%; background:currentColor; }
  .tiles { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; }
  .tile { background:var(--panel); border:1px solid var(--line); border-radius:10px; box-shadow:var(--shadow);
          padding:14px 16px 12px; display:flex; flex-direction:column; gap:2px; }
  .tile .label { font-family:var(--mono); font-size:10.5px; letter-spacing:.1em; text-transform:uppercase; color:var(--ink-3); }
  .tile .value { font-size:27px; font-weight:650; font-variant-numeric:tabular-nums; }
  .tile .value small { font-size:15px; font-weight:500; color:var(--ink-3); }
  .tile .sub { font-size:12px; color:var(--ink-2); }
  .grid { display:grid; grid-template-columns:1.45fr 1fr; gap:16px; align-items:start; }
  .col { display:flex; flex-direction:column; gap:16px; min-width:0; }
  .panel { background:var(--panel); border:1px solid var(--line); border-radius:10px; box-shadow:var(--shadow); overflow:hidden; }
  .panel-head { display:flex; align-items:baseline; justify-content:space-between; gap:12px;
                padding:12px 16px 10px; border-bottom:1px solid var(--line); flex-wrap:wrap; }
  .panel-head h2 { font-size:14px; font-weight:650; margin:0; }
  .src { font-family:var(--mono); font-size:10.5px; color:var(--ink-3); }
  .panel-body { padding:12px 16px 14px; display:flex; flex-direction:column; gap:10px; }
  .badge-new { font-family:var(--mono); font-size:10px; letter-spacing:.08em; text-transform:uppercase;
               color:var(--accent-ink); background:var(--accent-tint); border-radius:4px; padding:2px 7px; }
  .group-label { font-family:var(--mono); font-size:10.5px; letter-spacing:.1em; text-transform:uppercase;
                 color:var(--ink-3); padding-top:4px; }
  ul.todo { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:8px; }
  .todo li { display:flex; gap:10px; align-items:baseline; }
  .box { flex:none; width:15px; height:15px; border-radius:4px; border:1.5px solid var(--ink-3);
         position:relative; align-self:flex-start; margin-top:3px; }
  .box.done { background:var(--good); border-color:var(--good); }
  .box.done::after { content:""; position:absolute; left:4px; top:1px; width:4px; height:8px;
                     border:solid var(--panel); border-width:0 2px 2px 0; transform:rotate(40deg); }
  .todo .num { font-family:var(--mono); font-size:12px; color:var(--ink-3); flex:none; width:18px; text-align:right; }
  .todo .txt { min-width:0; }
  .todo li.is-done .txt { color:var(--ink-3); text-decoration:line-through; }
  .todo time { font-family:var(--mono); font-size:11px; color:var(--ink-3); flex:none; }
  .refchip { font-family:var(--mono); font-size:11px; white-space:nowrap; background:var(--panel-2);
             border:1px solid var(--line); border-radius:4px; padding:1px 6px; color:var(--accent-ink); }
  .agents { display:flex; flex-direction:column; gap:10px; }
  .agent { border:1px solid var(--line); border-radius:8px; background:var(--panel);
           padding:10px 12px; display:flex; flex-direction:column; gap:7px; }
  .agent-top { display:flex; align-items:center; gap:8px; }
  .agent-dot { flex:none; width:9px; height:9px; border-radius:50%; }
  .agent-name { font-family:var(--mono); font-size:12.5px; font-weight:600; overflow:hidden;
                text-overflow:ellipsis; white-space:nowrap; min-width:0; }
  .pill { margin-left:auto; flex:none; display:inline-flex; align-items:center; gap:5px;
          font-size:11px; font-weight:600; border-radius:999px; padding:2px 9px; }
  .pill i { font-style:normal; font-size:10px; }
  .pill.working { background:var(--good-tint); color:var(--good); }
  .pill.blocked { background:var(--warn-tint); color:var(--warn); }
  .pill.failed { background:var(--bad-tint); color:var(--bad); }
  .pill.done, .pill.idle { background:var(--idle-tint); color:var(--idle); }
  .agent-detail { font-size:12px; color:var(--ink-2); }
  .agent-meta { display:flex; align-items:center; gap:10px; font-family:var(--mono); font-size:11px;
                color:var(--ink-3); font-variant-numeric:tabular-nums; flex-wrap:wrap; }
  .tokbar { flex:1 1 60px; min-width:50px; height:4px; border-radius:2px; background:var(--panel-2); overflow:hidden; }
  .tokbar b { display:block; height:100%; border-radius:2px; }
  .agent-chips { display:flex; gap:6px; flex-wrap:wrap; }
  .feed { display:flex; flex-direction:column; }
  .evt { display:flex; gap:12px; align-items:baseline; padding:7px 0; border-bottom:1px solid var(--line); }
  .evt:last-child { border-bottom:none; }
  .evt time { font-family:var(--mono); font-size:11px; color:var(--ink-3); flex:none; width:68px; }
  .evt .txt { min-width:0; }
  .repo { font-family:var(--mono); font-size:10.5px; border-radius:4px; padding:1px 6px;
          background:var(--panel-2); border:1px solid var(--line); color:var(--ink-2); white-space:nowrap; }
  .prose { font-size:13px; color:var(--ink-2); }
  .prose div { margin-bottom:4px; }
  .notice { font-family:var(--mono); font-size:11.5px; color:var(--warn); margin:0; }
  .foot { font-family:var(--mono); font-size:11px; color:var(--ink-3); text-align:center; }
  @media (max-width:940px) { .grid { grid-template-columns:1fr; } .tiles { grid-template-columns:repeat(2,1fr); } }
`;
