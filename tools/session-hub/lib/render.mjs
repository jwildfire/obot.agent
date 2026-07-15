// Renderer (design #24 §5, layout revised per @jwildfire 2026-07-11): Priorities
// and Agents are the highlight — one line each, detail behind <details>
// drill-downs, agent↔priority cross-links as colored chips. Accomplishments
// (releases / requirements progress, closure emphasized) sit right under the
// tiles; everything else is a collapsed panel. Zero JS beyond scroll restore.

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

/** Markdown stripped to plain text — for one-line summaries. */
export function plainText(text) {
  let s = String(text ?? '');
  s = s.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '$1');
  s = s.replace(/`([^`]+)`/g, '$1');
  s = s.replace(/\*\*([^*]+)\*\*/g, '$1');
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

const agentChip = (a) =>
  `<a class="agchip" href="#agent-${esc(a.id)}" style="--c:${agentDot(a.color)}">${esc(a.short)}</a>`;

/* ---------- priorities: one line each, drill-down body ---------- */

function prioritiesList(groups) {
  if (!groups) return '';
  return groups
    .filter((g) => g.items.length)
    .map((g) => {
      const label = g.group ? `<div class="group-label">${esc(g.group)}</div>` : '';
      const rows = g.items
        .map((it) => {
          if (it.prose) return `<p class="prose-line">${inline(it.text)}</p>`;
          const box = it.checked === null ? '<span class="box none"></span>' : `<span class="box${it.checked ? ' done' : ''}"></span>`;
          const chips = (it.agents ?? []).map(agentChip).join('');
          const cls = it.checked === true ? ' is-done' : '';
          return `<details class="pri${cls}" id="p${it.num}">
  <summary><span class="tw">▸</span>${box}<span class="num">${it.num}</span><span class="crop">${esc(plainText(it.text))}</span><span class="chips">${chips}</span></summary>
  <div class="drill">${inline(it.text)}</div>
</details>`;
        })
        .join('\n');
      return label + rows;
    })
    .join('\n');
}

/* ---------- agents: one line each, drill-down body ---------- */

function agentCard(a, mode) {
  const [pillCls, icon] = STATE_PILL[a.state] ?? STATE_PILL.unknown;
  const maxTok = 400000;
  const pct = typeof a.tokens === 'number' ? Math.min(100, Math.round((a.tokens / maxTok) * 100)) : 0;
  const dot = agentDot(a.color);
  const since =
    mode === 'report' && a.createdAt
      ? `${fmtTime(a.createdAt)}–${fmtTime(a.updatedAt)} (${fmtDuration(a.createdAt, a.updatedAt)})`
      : a.createdAt ? `since ${fmtTime(a.createdAt)}` : '';
  const pchips = (a.priorities ?? [])
    .map((n) => `<a class="pchip" href="#p${n}">P${n}</a>`)
    .join('');
  const chips = (a.children ?? [])
    .map((c) => `<a class="refchip" href="${esc(c.href)}">${esc(c.kind === 'pr' ? 'PR ' : '')}${esc(shortUrl(c.href))}</a>`)
    .join(' ');
  const detail = mode === 'report' && a.result ? a.result : a.detail;
  return `<details class="agent" id="agent-${esc(a.id)}">
  <summary><span class="tw">▸</span><span class="agent-dot" style="background:${dot}"></span><span class="agent-name">${esc(a.short ?? a.name)}</span><span class="chips">${pchips}</span><span class="pill ${pillCls}"><i>${icon}</i>${esc(a.state)}${a.stale ? ' (stale)' : ''}</span></summary>
  <div class="drill">
    ${detail ? `<div class="agent-detail">${inline(detail)}</div>` : ''}
    <div class="agent-meta">
      ${since ? `<span>${esc(since)}</span>` : ''}
      ${typeof a.tokens === 'number' ? `<span class="tokbar"><b style="width:${pct}%;background:${dot}"></b></span><span>${fmtTokens(a.tokens)} tok</span>` : ''}
      ${a.model ? `<span>${esc(a.model)}</span>` : ''}
      ${a.kind === 'interactive' ? '<span>interactive</span>' : ''}
    </div>
    ${chips ? `<div class="agent-chips">${chips}</div>` : ''}
    ${a.name && a.short !== a.name ? `<div class="agent-fullname">${esc(a.name)}</div>` : ''}
    ${a.degraded ? `<div class="notice">⚠ ${esc(a.degraded)}</div>` : ''}
  </div>
</details>`;
}

/* ---------- accomplishments: releases + requirements, closure first ---------- */

function accomplishmentsPanel(acc, noticeMsg) {
  const body = [];
  if (noticeMsg) body.push(notice(noticeMsg));
  if (acc) {
    for (const r of acc.releases) {
      body.push(`<div class="acc-row release">🚀 <a href="${esc(r.url)}"><strong>${esc(r.repo)} ${esc(r.tag)}</strong></a> released <time>${fmtTime(r.publishedAt)}</time></div>`);
    }
    for (const q of acc.requirements) {
      const badge = q.event === 'closed' ? '<span class="closed-badge">✓ closed</span>' : `<span class="ev">${esc(q.event)}</span>`;
      body.push(`<div class="acc-row">📋 <a href="${esc(q.url)}">hub#${q.number}</a> <span class="crop-inline">${esc(q.title)}</span> ${badge}</div>`);
    }
    const closures = [...acc.mergedPrs, ...acc.closedIssues];
    if (closures.length) {
      const rows = closures
        .map((i) => `<div class="acc-row"><a href="${esc(i.url)}">${esc(i.repo)}#${i.number}</a> <span class="crop-inline">${esc(i.title)}</span> <span class="closed-badge">✓ ${esc(i.event)}</span></div>`)
        .join('\n');
      body.push(`<details class="acc-more"><summary><span class="tw">▸</span>✅ <strong>${acc.mergedPrs.length} PRs merged · ${acc.closedIssues.length} issues closed</strong></summary><div class="drill">${rows}</div></details>`);
    }
    if (!acc.releases.length && !acc.requirements.length && !closures.length) {
      body.push('<p class="notice">no releases, requirement moves, or closures yet this session</p>');
    }
  }
  return `<section class="panel accomplish">
  <div class="panel-head"><h2>Accomplishments</h2><span class="src">derived: releases + requirement issues + closures since session start</span></div>
  <div class="panel-body">${body.join('\n')}</div>
</section>`;
}

/* ---------- collapsed secondary panels ---------- */

function collapsedPanel(title, src, summaryExtra, body) {
  return `<details class="panel fold">
  <summary class="panel-head"><h2><span class="tw">▸</span>${title}</h2><span class="src">${summaryExtra ? esc(summaryExtra) + ' · ' : ''}${esc(src)}</span></summary>
  <div class="panel-body">${body}</div>
</details>`;
}

function itemsList(groups) {
  if (!groups) return '';
  return groups
    .filter((g) => g.items.length)
    .map((g) => {
      const label = g.group ? `<div class="group-label">${esc(g.group)}</div>` : '';
      const lis = g.items
        .map((it) => {
          const box = it.checked === null ? '' : `<span class="box${it.checked ? ' done' : ''}"></span>`;
          const time = it.time ? `<time>${esc(it.time)}</time>` : '';
          const cls = it.checked === true ? ' class="is-done"' : '';
          return `<li${cls}>${box}${time}<span class="txt">${inline(it.text)}</span></li>`;
        })
        .join('\n');
      return `${label}<ul class="todo">${lis}</ul>`;
    })
    .join('\n');
}

function activityFeed(items) {
  if (!items?.length) return '<p class="notice">no roadmap activity since session start</p>';
  return `<div class="feed">${items
    .map(
      (i) => `<div class="evt"><time>${fmtTime(i.updatedAt)}</time><span class="repo">${esc(i.repo)}</span><span class="txt"><a href="${esc(i.url)}">${esc(i.isPullRequest ? 'PR ' : '')}#${i.number}</a> ${esc(i.title)} — <strong>${esc(i.event)}</strong></span></div>`,
    )
    .join('\n')}</div>`;
}

function countItems(sectionData) {
  let n = 0;
  for (const g of sectionData?.groups ?? []) n += g.items.length;
  return n;
}

export function render(model) {
  const m = model;
  const isReport = m.mode === 'report';
  const stamp = `generated ${fmtTime(m.generatedAtIso)}${isReport ? '' : ' · auto-refresh 60s'}`;
  const stateCounts = Object.entries(m.tiles.agents.byState)
    .map(([k, v]) => `${v} ${k}`)
    .join(' · ');

  const banner = isReport
    ? `<div class="banner ok"><span class="dot"></span>Session report — frozen at wrapup. ${m.tiles.agents.total} agents, ${fmtTokens(m.tiles.tokens.total)} tokens, ${m.tiles.closure ?? 0} closures/releases.</div>`
    : m.alerts.length
      ? `<div class="banner"><span class="dot"></span>${m.alerts.map((a) => `${esc(a.short ?? a.name)} — ${esc(a.state)}${a.detail ? `: ${esc(a.detail)}` : ''}`).join(' · ')}</div>`
      : '';

  const acc = m.accomplishments;
  const closureSub = acc
    ? `${acc.mergedPrs.length} merged · ${acc.closedIssues.length} closed · ${acc.releases.length} released`
    : '—';

  const nextSessionBody = m.panels.nextSession
    ? [
        m.panels.nextSession.memory ? `<div class="prose">${inline(m.panels.nextSession.memory)}</div>` : '',
        m.panels.nextSession.diary
          ? `<div class="group-label">last diary (${esc(m.panels.nextSession.diary.file)})</div><div class="prose">${m.panels.nextSession.diary.body.split('\n').filter((l) => l.trim()).slice(0, 12).map((l) => `<div>${inline(l)}</div>`).join('')}</div>`
          : '',
      ].join('\n')
    : '';

  const left = [
    `<section class="panel">
  <div class="panel-head"><h2>Priorities</h2><span class="src">scratchpad · ## Overview — click a row for detail</span></div>
  <div class="panel-body">${notice(m.notices.scratchpad)}${m.panels.overview ? prioritiesList(m.panels.overview.groups) : ''}</div>
</section>`,
    collapsedPanel('Roadmap activity', 'gh sweep, all events', `${m.tiles.activity ?? 0} events`,
      notice(m.notices.ghSweep) + (m.panels.activity ? activityFeed(m.panels.activity) : '')),
  ].join('\n');

  const right = [
    `<section class="panel">
  <div class="panel-head"><h2>Agents</h2><span class="src">state.json + claude agents — P# links to the priority</span></div>
  <div class="panel-body">${notice(m.notices.jobs)}${notice(m.notices.agentsCli)}${
    m.agents.length ? `<div class="agents">${m.agents.map((a) => agentCard(a, m.mode)).join('\n')}</div>` : '<p class="notice">no sessions in scope</p>'
  }</div>
</section>`,
    m.panels.todo && countItems(m.panels.todo) ? collapsedPanel('Todo', 'scratchpad · ## Todo', `${countItems(m.panels.todo)}`, itemsList(m.panels.todo.groups)) : '',
    collapsedPanel('Notes', 'scratchpad · ## Notes', `${countItems(m.panels.notes)}`,
      m.panels.notes ? itemsList(m.panels.notes.groups) : notice('no ## Notes section in today’s scratchpad')),
    collapsedPanel('Scaffold', 'scratchpad · ## Scaffold', `${countItems(m.panels.scaffold)}`,
      m.panels.scaffold ? itemsList(m.panels.scaffold.groups) : notice('no ## Scaffold section yet — capture with "scaffold: …"')),
    collapsedPanel('Next session', 'memory + last diary', '',
      notice(m.notices.nextSession) + nextSessionBody),
  ].filter(Boolean).join('\n');

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
  <div class="tile"><span class="label">Closure</span><span class="value">${m.tiles.closure ?? '—'}</span><span class="sub">${esc(closureSub)}</span></div>
</section>

${accomplishmentsPanel(acc, acc ? null : m.notices.ghSweep)}

<div class="grid">
  <div class="col">${left}</div>
  <div class="col">${right}</div>
</div>

<div class="foot">${isReport ? `frozen operational record · pairs with diary/${esc(m.slug)}.md` : 'live view · click rows to drill down'} · boundary: ${esc(m.boundary.anchor)} (${fmtTime(m.boundary.startIso)}) · session-hub (obot.agent v0.2 · <a href="https://github.com/jwildfire/obot.roadmap/issues/24">#24</a>)</div>
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
    var o='session-hub-open';
    var open=new Set(JSON.parse(sessionStorage.getItem(o)||'[]'));
    document.querySelectorAll('details[id]').forEach(function(d){
      if(open.has(d.id)) d.open=true;
      d.addEventListener('toggle',function(){
        if(d.open) open.add(d.id); else open.delete(d.id);
        sessionStorage.setItem(o, JSON.stringify(Array.from(open)));
      });
    });
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
  .grid { display:grid; grid-template-columns:1.15fr 1fr; gap:16px; align-items:start; }
  .col { display:flex; flex-direction:column; gap:16px; min-width:0; }
  .panel { background:var(--panel); border:1px solid var(--line); border-radius:10px; box-shadow:var(--shadow); overflow:hidden; }
  .panel-head { display:flex; align-items:baseline; justify-content:space-between; gap:12px;
                padding:12px 16px 10px; border-bottom:1px solid var(--line); flex-wrap:wrap; }
  .panel-head h2 { font-size:14px; font-weight:650; margin:0; display:inline-flex; align-items:center; gap:6px; }
  .src { font-family:var(--mono); font-size:10.5px; color:var(--ink-3); }
  .panel-body { padding:12px 16px 14px; display:flex; flex-direction:column; gap:8px; }
  .group-label { font-family:var(--mono); font-size:10.5px; letter-spacing:.1em; text-transform:uppercase;
                 color:var(--ink-3); padding:6px 0 2px; }

  /* drill-downs */
  summary { cursor:pointer; }
  summary::-webkit-details-marker { display:none; }
  summary { list-style:none; }
  .tw { flex:none; display:inline-block; font-size:10px; color:var(--ink-3); transition:transform .12s ease; width:10px; }
  details[open] > summary .tw { transform:rotate(90deg); }
  .drill { padding:8px 4px 6px 26px; font-size:12.5px; color:var(--ink-2); display:flex; flex-direction:column; gap:7px; }

  /* priorities */
  details.pri > summary { display:flex; align-items:center; gap:8px; padding:4px 0; min-width:0; }
  details.pri.is-done .crop { color:var(--ink-3); text-decoration:line-through; }
  .box { flex:none; width:14px; height:14px; border-radius:4px; border:1.5px solid var(--ink-3); position:relative; }
  .box.none { border-style:dotted; }
  .box.done { background:var(--good); border-color:var(--good); }
  .box.done::after { content:""; position:absolute; left:4px; top:1px; width:3px; height:7px;
                     border:solid var(--panel); border-width:0 2px 2px 0; transform:rotate(40deg); }
  .num { font-family:var(--mono); font-size:11.5px; color:var(--ink-3); flex:none; min-width:14px; text-align:right; }
  .crop { flex:1 1 auto; min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; font-size:13px; }
  .chips { flex:none; display:inline-flex; gap:4px; max-width:45%; overflow:hidden; }
  .prose-line { margin:0; font-size:12px; color:var(--ink-3); }

  /* agent↔priority chips */
  .agchip { font-family:var(--mono); font-size:10px; border-radius:999px; padding:1px 7px; white-space:nowrap;
            color:var(--c); border:1px solid color-mix(in srgb, var(--c) 55%, transparent);
            background:color-mix(in srgb, var(--c) 10%, transparent);
            max-width:110px; overflow:hidden; text-overflow:ellipsis; }
  .pchip { font-family:var(--mono); font-size:10px; border-radius:999px; padding:1px 7px; white-space:nowrap;
           color:var(--accent-ink); border:1px solid var(--line); background:var(--accent-tint); }

  /* agents */
  .agents { display:flex; flex-direction:column; gap:6px; }
  details.agent { border:1px solid var(--line); border-radius:8px; background:var(--panel); }
  details.agent > summary { display:flex; align-items:center; gap:8px; padding:8px 10px; min-width:0; }
  details.agent > .drill { padding:2px 12px 10px 28px; }
  .agent-dot { flex:none; width:9px; height:9px; border-radius:50%; }
  .agent-name { font-family:var(--mono); font-size:12.5px; font-weight:600; overflow:hidden;
                text-overflow:ellipsis; white-space:nowrap; flex:1 1 auto; min-width:0; }
  .agent-fullname { font-family:var(--mono); font-size:10.5px; color:var(--ink-3); }
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
  .tokbar { flex:1 1 60px; min-width:50px; max-width:120px; height:4px; border-radius:2px; background:var(--panel-2); overflow:hidden; }
  .tokbar b { display:block; height:100%; border-radius:2px; }
  .agent-chips { display:flex; gap:6px; flex-wrap:wrap; }
  .refchip { font-family:var(--mono); font-size:11px; white-space:nowrap; background:var(--panel-2);
             border:1px solid var(--line); border-radius:4px; padding:1px 6px; color:var(--accent-ink); }

  /* accomplishments */
  .accomplish { border-color:color-mix(in srgb, var(--good) 35%, var(--line)); }
  .acc-row { display:flex; align-items:baseline; gap:8px; font-size:13px; min-width:0; }
  .acc-row time { font-family:var(--mono); font-size:11px; color:var(--ink-3); }
  .crop-inline { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .closed-badge { flex:none; font-size:11px; font-weight:600; color:var(--good); background:var(--good-tint);
                  border-radius:999px; padding:1px 8px; }
  .ev { flex:none; font-family:var(--mono); font-size:11px; color:var(--ink-3); }
  details.acc-more > summary { display:flex; align-items:center; gap:8px; font-size:13px; padding:2px 0; }

  /* collapsed secondary panels */
  details.fold > summary.panel-head { border-bottom:none; }
  details.fold[open] > summary.panel-head { border-bottom:1px solid var(--line); }

  ul.todo { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:8px; }
  .todo li { display:flex; gap:10px; align-items:baseline; font-size:13px; }
  .todo li .box { align-self:flex-start; margin-top:3px; }
  .todo .txt { min-width:0; }
  .todo li.is-done .txt { color:var(--ink-3); text-decoration:line-through; }
  .todo time { font-family:var(--mono); font-size:11px; color:var(--ink-3); flex:none; }
  .feed { display:flex; flex-direction:column; }
  .evt { display:flex; gap:12px; align-items:baseline; padding:7px 0; border-bottom:1px solid var(--line); font-size:13px; }
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
