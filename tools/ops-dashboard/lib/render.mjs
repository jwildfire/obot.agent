// The Operations Dashboard page.
//
// Layout is @jwildfire's, 2026-08-15: a persistent header, decision artifacts open
// in a main area, and a sidebar where he answers. The queue rail on the left is his
// todo list — release candidates, decisions, config — because that is the object the
// page is about.
//
// Density is his too, the same evening: "I like the sidebar, but make it much mroe
// compact." So a queue row is one line — an id chip and the title, nothing else. The
// kind is carried by the group heading and the coloured left edge rather than by a
// word above every row, the secondary line moved into the row's tooltip, and the
// explanatory paragraphs went from three to one. He reads this on a phone, so the
// budget is vertical pixels and each row now costs about a third of what it did.
//
// One page, no build step, no dependencies: the markup below is served as-is and the
// only script is the handful of lines that select a queue item and post an answer.
export const esc = (s = '') => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const KIND = {
  rc: { label: 'release candidate', tone: 'rc' },
  config: { label: 'config', tone: 'config' },
  decision: { label: 'decision', tone: 'decision' },
};

/**
 * The tab strip — the merged site's persistent header (@jwildfire, 2026-08-15: "I
 * want the ops db and orginal ops hub to be merged. just make them 2 different tabs
 * on the same (local) site for now. new ops db should be default view", and an hour
 * later "I think i almost certainly want a navigator tab").
 *
 * A list, not markup, because the surface grew twice in one evening: a fourth tab is
 * one entry here and a route in ops-dashboard.mjs, and nothing else moves.
 *
 * `/live.html` rather than a prettier path for the session tab: the status line builds
 * that exact URL from the served marker, so it stays the session view's address.
 */
export const TABS = [
  { id: 'ops', href: '/', label: 'Operations' },
  { id: 'session', href: '/live.html', label: 'Session' },
  { id: 'navigator', href: '/navigator', label: 'Navigator' },
];

export const tabs = (active) => `<nav class="tabs" aria-label="Views">
  ${TABS.map((t) => `<a href="${t.href}"${t.id === active ? ' aria-current="page"' : ''}>${t.label}</a>`).join('\n  ')}
</nav>`;

// The chip is a handle, never the explanation: `c0001` for a config item, `D0007` for
// a decision, `#52` for a release candidate. The sentence beside it is what he reads.
const chip = (it) => {
  if (it.id) return it.id;
  if (it.kind === 'rc') return `#${String(it.key || '').split('#')[1] ?? ''}`;
  return '';
};

const item = (it) => {
  const c = chip(it);
  return `<li class="q ${KIND[it.kind]?.tone ?? ''}" data-kind="${esc(it.kind)}" data-key="${esc(it.key)}"${it.artifact ? ` data-artifact="${esc(it.artifact)}"` : ''}${it.url ? ` data-url="${esc(it.url)}"` : ''}${it.detail ? ` title="${esc(it.detail)}"` : ''}>${c ? `<span class="q-id mono">${esc(c)}</span>` : ''}<span class="q-title">${esc(it.title)}</span></li>`;
};

const group = (title, items, empty) => `<h2 class="q-h">${esc(title)} <span class="q-n">${items.length}</span></h2>
${items.length ? `<ul class="q-list">${items.map(item).join('')}</ul>` : `<p class="q-empty">${esc(empty)}</p>`}`;

// Palette, header and tab strip — shared by both tabs so the header is genuinely
// persistent: the same markup and the same styles whichever view is on screen.
const SHELL_CSS = `
  :root {
    --paper:#F4F1EC; --card:#FDFCFA; --ink:#26211B; --muted:#6F6558; --faint:#9C917F;
    --line:#E2DACC; --accent:#B4470E; --accent-soft:#F4E2D2; --good:#2F6B4F; --good-soft:#E2EFE7;
    --warn:#8A5A00; --warn-soft:#F6ECD8;
    --sans:"Instrument Sans","Avenir Next","Segoe UI",system-ui,sans-serif;
    --mono:"IBM Plex Mono",ui-monospace,SFMono-Regular,Menlo,monospace;
    --header:40px;
  }
  @media (prefers-color-scheme: dark) { :root {
    --paper:#1A1611; --card:#232019; --ink:#EAE4D8; --muted:#A69B89; --faint:#7E7462;
    --line:#383126; --accent:#E8843C; --accent-soft:#3C2A18; --good:#7FBF9B; --good-soft:#1E2E25;
    --warn:#D9A441; --warn-soft:#33280F;
  } }
  * { box-sizing:border-box; }
  html, body { height:100%; }
  body { margin:0; background:var(--paper); color:var(--ink); font-family:var(--sans); line-height:1.5; }
  a { color:var(--accent); }
  .mono { font-family:var(--mono); font-size:0.85em; }

  /* Persistent header — the same strip on both tabs, and the thing that stays put
     across everything below it. One row at 390px: brand, tabs, counts, all short. */
  header.top {
    position:sticky; top:0; z-index:10; min-height:var(--header);
    display:flex; align-items:center; gap:0.35rem 0.7rem; flex-wrap:wrap; padding:0.25rem 0.6rem;
    background:var(--card); border-bottom:1px solid var(--line);
  }
  header.top .brand { font-weight:600; letter-spacing:-0.01em; white-space:nowrap; font-size:0.85rem; }
  header.top .counts { display:flex; gap:0.3rem; flex-wrap:wrap; }
  .pill { font-size:0.7rem; padding:0.05rem 0.45rem; border-radius:99px; border:1px solid var(--line); white-space:nowrap; }
  .pill.rc { border-color:var(--accent); color:var(--accent); }
  .pill.config { border-color:var(--warn); color:var(--warn); }
  .pill.decision { border-color:var(--good); color:var(--good); }
  header.top .spacer { flex:1; }
  header.top .where { font-size:0.68rem; color:var(--faint); font-family:var(--mono); }
  @media (max-width:520px) { header.top .where { display:none; } }

  .tabs { display:flex; gap:0.2rem; }
  .tabs a { font-size:0.75rem; padding:0.15rem 0.6rem; border-radius:99px; text-decoration:none;
            color:var(--muted); border:1px solid transparent; white-space:nowrap; }
  .tabs a:hover { border-color:var(--line); }
  .tabs a[aria-current="page"] { background:var(--accent-soft); color:var(--accent); border-color:var(--accent); }
`;

const DASHBOARD_CSS = `
  /* Sticky, not fixed: the header owns its height, so wrapped pills push the
     columns down instead of sitting on top of the first queue row. */
  .cols { display:grid; grid-template-columns:minmax(220px,18rem) 1fr minmax(240px,20rem);
          height:calc(100vh - var(--header)); }
  @media (max-width:900px) { .cols { grid-template-columns:1fr; height:auto; } }

  .rail, .side { overflow-y:auto; padding:0.6rem 0.7rem; }
  .rail { border-right:1px solid var(--line); }
  .side { border-left:1px solid var(--line); background:var(--card); }
  .main { overflow:hidden; display:flex; flex-direction:column; background:var(--card); }
  .main iframe { flex:1; width:100%; border:0; min-height:70vh; }
  .main .placeholder { padding:1.2rem 1.1rem; color:var(--muted); max-width:52ch; }
  .main .placeholder h2 { font-size:1rem; margin:0 0 0.4rem; color:var(--ink); }
  .main .placeholder p { margin:0 0 0.5rem; font-size:0.85rem; }

  .q-h { font-size:0.66rem; letter-spacing:0.11em; text-transform:uppercase; color:var(--faint);
         font-weight:500; margin:0.85rem 0 0.3rem; display:flex; align-items:center; gap:0.4rem; }
  .q-h:first-child { margin-top:0; }
  .q-n { font-family:var(--mono); font-size:0.66rem; color:var(--muted); }
  .q-list { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:0.15rem; }
  /* One row, one line where the title allows it: an id chip and the sentence. */
  .q { border-left:3px solid var(--line); border-radius:0 5px 5px 0; padding:0.2rem 0.4rem;
       background:transparent; cursor:pointer; display:flex; align-items:baseline; gap:0.4rem;
       line-height:1.3; }
  .q:hover, .q:focus-visible { background:var(--card); }
  .q[aria-current="true"] { background:var(--accent-soft); }
  .q.rc { border-left-color:var(--accent); }
  .q.config { border-left-color:var(--warn); cursor:default; }
  .q.decision { border-left-color:var(--good); }
  .q-id { color:var(--faint); font-size:0.68rem; flex:none; }
  .q-title { font-size:0.82rem; }
  .q-empty { font-size:0.76rem; color:var(--muted); margin:0 0 0.2rem; }

  .side h2 { font-size:0.85rem; margin:0 0 0.15rem; }
  .side .hint { font-size:0.74rem; color:var(--muted); margin:0 0 0.6rem; }
  .adopt { width:100%; padding:0.5rem; font-size:0.88rem; font-weight:600; border-radius:8px;
           border:1.5px solid var(--good); background:var(--good-soft); color:var(--ink); cursor:pointer; }
  .adopt:hover { filter:brightness(1.04); }
  .verdicts { display:grid; grid-template-columns:1fr 1fr 1fr 1fr; gap:0.25rem; margin:0.4rem 0; }
  .verdicts button { padding:0.3rem 0.2rem; font-size:0.74rem; border-radius:7px; border:1px solid var(--line);
                     background:var(--paper); color:var(--ink); cursor:pointer; }
  .verdicts button[aria-pressed="true"] { border-color:var(--accent); background:var(--accent-soft); }
  textarea { width:100%; min-height:5.5rem; padding:0.45rem; border-radius:8px; border:1px solid var(--line);
             background:var(--paper); color:var(--ink); font:inherit; font-size:0.82rem; resize:vertical; }
  .send { width:100%; margin-top:0.35rem; padding:0.45rem; border-radius:8px; border:1px solid var(--accent);
          background:var(--accent); color:#fff; font-weight:600; cursor:pointer; }
  .send[disabled] { opacity:0.45; cursor:not-allowed; }
  .note { font-size:0.7rem; color:var(--muted); margin:0.45rem 0 0; }
  .qq { border:1px solid var(--line); border-radius:7px; padding:0.35rem 0.45rem; margin:0.35rem 0; }
  .qq p { margin:0 0 0.25rem; font-size:0.8rem; }
  .qq .code { font-family:var(--mono); font-size:0.62rem; color:var(--faint); letter-spacing:0.06em; }
  .qq .row { display:flex; gap:0.2rem; flex-wrap:wrap; }
  .qq button { flex:1 1 auto; font-size:0.68rem; padding:0.2rem 0.3rem; border-radius:6px;
               border:1px solid var(--line); background:var(--paper); color:var(--ink); cursor:pointer; }
  .qq button[aria-pressed="true"] { border-color:var(--accent); background:var(--accent-soft); }
  .staged { margin-top:0.9rem; border-top:1px solid var(--line); padding-top:0.5rem; }
  .staged li { font-size:0.72rem; color:var(--muted); margin:0.15rem 0; list-style:none; }
  .ok { color:var(--good); font-size:0.78rem; margin:0.35rem 0 0; }
`;

/**
 * The session tab: the session hub's own live view, unchanged, under the shared
 * header. It is an iframe rather than an injection because that view is generated by
 * a different tool on its own watch loop — wrapping it means the merge costs neither
 * generator a line of layout, and nothing in it (least of all the news feed) can be
 * lost in translation.
 */
export function sessionShell({ frame = '/session/frame', missing = null } = {}) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Session · obot</title>
<style>${SHELL_CSS}
  body { display:flex; flex-direction:column; }
  iframe.frame { flex:1; width:100%; border:0; }
  .missing { padding:1.2rem; color:var(--muted); font-size:0.85rem; }
  .missing code { font-family:var(--mono); font-size:0.78rem; }
</style>
</head>
<body>
<header class="top">
  <span class="brand">🍊😺 obot</span>
  ${tabs('session')}
  <span class="spacer"></span>
  <span class="where">local only</span>
</header>
${missing
    ? `<p class="missing">No session view yet — start the watch loop:<br><code>${esc(missing)}</code></p>`
    : `<iframe class="frame" title="Session hub" src="${esc(frame)}"></iframe>`}
</body>
</html>`;
}

const NAV_CSS = `
  .nav-wrap { padding:0.7rem 0.8rem; max-width:60rem; }
  .dead { border:1px solid var(--accent); background:var(--accent-soft); color:var(--ink);
          border-radius:8px; padding:0.5rem 0.6rem; margin:0 0 0.7rem; font-size:0.82rem; }
  .dead code { font-family:var(--mono); font-size:0.74rem; }
  .swept { font-size:0.72rem; color:var(--faint); font-family:var(--mono); margin:0 0 0.7rem; }
  .nav-h { font-size:0.66rem; letter-spacing:0.11em; text-transform:uppercase; color:var(--faint);
           font-weight:500; margin:0.9rem 0 0.3rem; }
  .nav-list { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:0.15rem; }
  .nav-list li { border-left:3px solid var(--line); padding:0.2rem 0.4rem; font-size:0.82rem; line-height:1.3; }
  .nav-list li a { text-decoration:none; }
  .nav-list .at { color:var(--faint); font-family:var(--mono); font-size:0.68rem; }
  .nav-empty { font-size:0.76rem; color:var(--muted); margin:0; }
`;

/**
 * The Navigator tab: what the 🧭🤖 sweep has seen, rendered from the file it writes.
 *
 * Every section in that file renders, including ones this code has never heard of —
 * the seam for the per-agent ledger, which needs a data source that does not exist
 * yet (GitHub attributes every agent's work to one bot identity).
 *
 * A dead observer leads with a banner and the restart command. Presenting a stale
 * sweep as current is the one failure mode that matters here: it is the surface he
 * would trust to tell him a review had landed.
 */
export function navigatorShell({ state = null, missing = null } = {}) {
  const body = missing || !state
    ? `<p class="nav-empty">No sweep file yet — <code>${esc(missing ?? 'navigator-state.md')}</code>. The Navigator writes it every five minutes: <code>launchctl kickstart -k gui/$UID/com.obot.navigator-sweep</code>.</p>`
    : `${state.stale
      ? `<p class="dead"><strong>The observer is dead</strong> — last swept ${esc(state.sweptAt ?? 'never')}${state.ageMin === null ? '' : ` (${state.ageMin} min ago, cadence ${state.cadenceMin}m)`}. What follows is <strong>not current</strong>. Restart: <code>launchctl kickstart -k gui/$UID/com.obot.navigator-sweep</code></p>`
      : `<p class="swept">swept ${esc(state.sweptAt)}${state.summary ? ` · ${esc(state.summary)}` : ''}</p>`}
${state.sections.map((s) => `<h2 class="nav-h">${esc(s.title)}</h2>
${s.items.length
    ? `<ul class="nav-list">${s.items.map((it) => `<li>${it.url
      ? `<a href="${esc(it.url)}" target="_blank" rel="noopener">${esc(it.text)}</a>`
      : esc(it.text)}${it.verified ? ` <span class="at">${esc(it.verified)}</span>` : ''}</li>`).join('')}</ul>`
    : '<p class="nav-empty">Nothing.</p>'}`).join('\n')}`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Navigator · obot</title>
<style>${SHELL_CSS}${NAV_CSS}
</style>
</head>
<body>
<header class="top">
  <span class="brand">🍊😺 obot</span>
  ${tabs('navigator')}
  <span class="spacer"></span>
  <span class="where">local only</span>
</header>
<div class="nav-wrap">
${body}
</div>
</body>
</html>`;
}

export function render({ queue, staged = [], workspace, hub, generated = new Date() }) {
  const counts = {
    rc: queue.rcs.items.length,
    config: queue.config.items.length,
    decision: queue.decisions.items.length,
  };
  const total = counts.rc + counts.config + counts.decision;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Operations Dashboard · obot</title>
<style>${SHELL_CSS}${DASHBOARD_CSS}
</style>
</head>
<body>

<header class="top">
  <span class="brand">🍊😺 Operations</span>
  ${tabs('ops')}
  <span class="counts">
    <span class="pill rc">${counts.rc} release candidate${counts.rc === 1 ? '' : 's'}</span>
    <span class="pill decision">${counts.decision} decision${counts.decision === 1 ? '' : 's'}</span>
    <span class="pill config">${counts.config} config</span>
  </span>
  <span class="spacer"></span>
  <span class="where">local only · ${esc(generated.toTimeString().slice(0, 5))}</span>
</header>

<div class="cols">

  <nav class="rail" aria-label="Your queue">
    ${total === 0 ? '<p class="q-empty">Nothing is waiting on you.</p>' : ''}
    ${group('Release candidates', queue.rcs.items, queue.rcs.refreshing ? 'Sweeping GitHub…' : 'None waiting.')}
    ${group('Decisions', queue.decisions.items, 'All answered.')}
    ${group('Config', queue.config.items, 'Nothing needs your keyboard.')}
    ${queue.decisions.error ? `<p class="q-empty">Decisions unavailable: ${esc(queue.decisions.error)}</p>` : ''}
  </nav>

  <main class="main" id="main">
    <div class="placeholder" id="placeholder">
      <h2>Your todo list, and where you answer it.</h2>
      <p>Pick anything on the left: a <strong>decision</strong> opens here and you answer it in the sidebar, a <strong>release candidate</strong> opens on GitHub, a <strong>config</strong> item is a line only your keyboard can type — local, never published.</p>
    </div>
  </main>

  <aside class="side" id="side">
    <h2 id="side-title">Nothing selected</h2>
    <p class="hint" id="side-hint">Pick a decision to answer it.</p>
    <div id="answer" hidden>
      <button class="adopt" id="adopt">Adopt all recommendations</button>
      <div id="questions"></div>
      <div class="verdicts">
        <button data-v="approve" aria-pressed="false">Approve</button>
        <button data-v="reject" aria-pressed="false">Reject</button>
        <button data-v="defer" aria-pressed="false">Defer</button>
        <button data-v="more" aria-pressed="false">Ask for more</button>
      </div>
      <textarea id="words" placeholder="In your words — quoted verbatim in the artifact's Decisions section."></textarea>
      <button class="send" id="send" disabled>Record this decision</button>
      <p class="note">Staged locally; an agent applies it to the artifact, the log and the index.</p>
      <p class="ok" id="ok" hidden></p>
    </div>
    <div class="staged">
      <h2>Staged answers <span class="q-n">${staged.length}</span></h2>
      <ul id="staged-list">${staged.length
    ? staged.slice(0, 8).map((a) => `<li>${esc((a.at || '').slice(0, 16).replace('T', ' '))} — ${esc(a.verdict ?? 'answered')} · ${esc(a.artifact ?? '')}</li>`).join('')
    : '<li>None waiting to be applied.</li>'}</ul>
    </div>
  </aside>

</div>

<script id="questions-data" type="application/json">${
  JSON.stringify(Object.fromEntries(queue.decisions.items.map((d) => [d.artifact, d.questions ?? []])))
    .replace(/</g, '\\u003c')
}</script>
<script>
  const QUESTIONS = JSON.parse(document.getElementById('questions-data').textContent);
  const state = { item: null, verdict: null, perQuestion: {} };
  const $ = (id) => document.getElementById(id);

  function select(li) {
    document.querySelectorAll('.q').forEach((n) => n.setAttribute('aria-current', String(n === li)));
    const kind = li.dataset.kind;
    state.item = { kind, key: li.dataset.key, artifact: li.dataset.artifact || null };
    state.verdict = null;
    state.perQuestion = {};
    document.querySelectorAll('.verdicts button').forEach((b) => b.setAttribute('aria-pressed', 'false'));
    renderQuestions(li.dataset.artifact);
    $('ok').hidden = true;
    $('side-title').textContent = li.querySelector('.q-title').textContent;

    if (kind === 'decision') {
      $('placeholder').hidden = true;
      let f = document.querySelector('#main iframe');
      if (!f) { f = document.createElement('iframe'); f.title = 'Decision artifact'; $('main').appendChild(f); }
      f.src = '/artifact/' + encodeURIComponent(li.dataset.artifact) + '/';
      $('answer').hidden = false;
      $('side-hint').textContent = 'Adopt all is one click. Otherwise pick a verdict and say why.';
    } else {
      $('answer').hidden = true;
      if (kind === 'rc' && li.dataset.url) window.open(li.dataset.url, '_blank', 'noopener');
      $('side-hint').textContent = kind === 'rc'
        ? 'Opened on GitHub — release candidates are reviewed there.'
        : 'Only your keyboard can apply this one. It is not published anywhere.';
    }
  }

  // The question text is the explanation; the id is only a handle. A row that
  // reads as a bare code has failed, so the sentence comes first and the code is
  // small print under it.
  function renderQuestions(artifact) {
    const box = document.getElementById('questions');
    const qs = (artifact && QUESTIONS[artifact]) || [];
    box.innerHTML = qs.map((q) => (
      '<div class="qq" data-q="' + q.id + '">' +
      '<p>' + q.question + '</p><span class="code">' + q.id + (q.code ? ' &middot; ' + q.code : '') + '</span>' +
      '<div class="row">' + ['approve', 'reject', 'defer', 'more']
        .map((v) => '<button data-v="' + v + '" aria-pressed="false">' + (v === 'more' ? 'more' : v) + '</button>').join('') +
      '</div></div>'
    )).join('');
    box.querySelectorAll('.qq').forEach((row) => row.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
      state.perQuestion[row.dataset.q] = b.dataset.v;
      row.querySelectorAll('button').forEach((o) => o.setAttribute('aria-pressed', String(o === b)));
      document.getElementById('send').disabled = false;
    })));
  }

  document.querySelectorAll('.q').forEach((li) => li.addEventListener('click', () => select(li)));

  document.querySelectorAll('.verdicts button').forEach((b) => b.addEventListener('click', () => {
    state.verdict = b.dataset.v;
    document.querySelectorAll('.verdicts button').forEach((o) => o.setAttribute('aria-pressed', String(o === b)));
    $('send').disabled = false;
  }));

  $('words').addEventListener('input', () => { $('send').disabled = !(state.verdict || $('words').value.trim()); });

  async function post(body) {
    const r = await fetch('/answer', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    $('ok').hidden = false;
    $('ok').textContent = r.ok ? 'Recorded — staged for the apply step.' : ('Could not record: ' + (j.error || r.status));
    if (r.ok) {
      const li = document.createElement('li');
      li.textContent = new Date().toISOString().slice(0, 16).replace('T', ' ') + ' — ' + body.verdict + ' · ' + (body.artifact || '');
      $('staged-list').prepend(li);
    }
  }

  $('adopt').addEventListener('click', () => {
    if (!state.item) return;
    post({ artifact: state.item.artifact, verdict: 'adopt-all', words: $('words').value, questions: {} });
  });
  $('send').addEventListener('click', () => {
    if (!state.item) return;
    post({ artifact: state.item.artifact, verdict: state.verdict || 'per-question', words: $('words').value, questions: state.perQuestion });
  });
</script>
</body>
</html>`;
}
