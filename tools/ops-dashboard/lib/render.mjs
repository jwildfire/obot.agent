// The Operations Dashboard page.
//
// Layout is @jwildfire's, 2026-08-15: a persistent header, decision artifacts open
// in a main area, and a sidebar where he answers. The queue rail on the left is his
// todo list — release candidates, blockers, decisions — because that is the object
// the page is about.
//
// One page, no build step, no dependencies: the markup below is served as-is and the
// only script is the handful of lines that select a queue item and post an answer.
export const esc = (s = '') => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const KIND = {
  rc: { label: 'release candidate', tone: 'rc' },
  blocker: { label: 'your hands', tone: 'blocker' },
  decision: { label: 'decision', tone: 'decision' },
};

const item = (it) => `<li class="q ${KIND[it.kind]?.tone ?? ''}" data-kind="${esc(it.kind)}" data-key="${esc(it.key)}"${it.artifact ? ` data-artifact="${esc(it.artifact)}"` : ''}${it.url ? ` data-url="${esc(it.url)}"` : ''}>
  <span class="q-kind">${esc(KIND[it.kind]?.label ?? it.kind)}${it.id ? ` · <span class="mono">${esc(it.id)}</span>` : ''}</span>
  <span class="q-title">${esc(it.title)}</span>
  ${it.detail ? `<span class="q-detail">${esc(it.detail)}</span>` : ''}
</li>`;

const group = (title, items, empty) => `<h2 class="q-h">${esc(title)} <span class="q-n">${items.length}</span></h2>
${items.length ? `<ul class="q-list">${items.map(item).join('')}</ul>` : `<p class="q-empty">${esc(empty)}</p>`}`;

export function render({ queue, staged = [], workspace, hub, generated = new Date() }) {
  const counts = {
    rc: queue.rcs.items.length,
    blocker: queue.blockers.items.length,
    decision: queue.decisions.items.length,
  };
  const total = counts.rc + counts.blocker + counts.decision;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Operations Dashboard · obot</title>
<style>
  :root {
    --paper:#F4F1EC; --card:#FDFCFA; --ink:#26211B; --muted:#6F6558; --faint:#9C917F;
    --line:#E2DACC; --accent:#B4470E; --accent-soft:#F4E2D2; --good:#2F6B4F; --good-soft:#E2EFE7;
    --warn:#8A5A00; --warn-soft:#F6ECD8;
    --sans:"Instrument Sans","Avenir Next","Segoe UI",system-ui,sans-serif;
    --mono:"IBM Plex Mono",ui-monospace,SFMono-Regular,Menlo,monospace;
    --header:52px;
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

  /* Persistent header — stays put across everything below it. */
  header.top {
    position:sticky; top:0; z-index:10; min-height:var(--header);
    display:flex; align-items:center; gap:0.6rem 1rem; flex-wrap:wrap; padding:0.5rem 1rem;
    background:var(--card); border-bottom:1px solid var(--line);
  }
  header.top .brand { font-weight:600; letter-spacing:-0.01em; white-space:nowrap; }
  header.top .counts { display:flex; gap:0.5rem; flex-wrap:wrap; }
  .pill { font-size:0.75rem; padding:0.15rem 0.55rem; border-radius:99px; border:1px solid var(--line); white-space:nowrap; }
  .pill.rc { border-color:var(--accent); color:var(--accent); }
  .pill.blocker { border-color:var(--warn); color:var(--warn); }
  .pill.decision { border-color:var(--good); color:var(--good); }
  header.top .spacer { flex:1; }
  header.top .where { font-size:0.72rem; color:var(--faint); font-family:var(--mono); }

  /* Sticky, not fixed: the header owns its height, so wrapped pills push the
     columns down instead of sitting on top of the first queue row. */
  .cols { display:grid; grid-template-columns:minmax(240px,20rem) 1fr minmax(260px,22rem);
          height:calc(100vh - var(--header)); }
  @media (max-width:900px) { .cols { grid-template-columns:1fr; height:auto; } }

  .rail, .side { overflow-y:auto; padding:1rem; }
  .rail { border-right:1px solid var(--line); }
  .side { border-left:1px solid var(--line); background:var(--card); }
  .main { overflow:hidden; display:flex; flex-direction:column; background:var(--card); }
  .main iframe { flex:1; width:100%; border:0; min-height:70vh; }
  .main .placeholder { padding:2.5rem 2rem; color:var(--muted); max-width:48ch; }

  .q-h { font-size:0.72rem; letter-spacing:0.12em; text-transform:uppercase; color:var(--faint);
         font-weight:500; margin:1.4rem 0 0.5rem; display:flex; align-items:center; gap:0.5rem; }
  .q-h:first-child { margin-top:0; }
  .q-n { font-family:var(--mono); font-size:0.7rem; color:var(--muted); }
  .q-list { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:0.4rem; }
  .q { border:1px solid var(--line); border-left-width:3px; border-radius:8px; padding:0.55rem 0.7rem;
       background:var(--card); cursor:pointer; display:flex; flex-direction:column; gap:0.15rem; }
  .q:hover, .q:focus-visible { border-color:var(--accent); }
  .q[aria-current="true"] { background:var(--accent-soft); border-color:var(--accent); }
  .q.rc { border-left-color:var(--accent); }
  .q.blocker { border-left-color:var(--warn); cursor:default; }
  .q.decision { border-left-color:var(--good); }
  .q-kind { font-size:0.65rem; letter-spacing:0.09em; text-transform:uppercase; color:var(--faint); }
  .q-title { font-size:0.9rem; }
  .q-detail { font-size:0.76rem; color:var(--muted); }
  .q-empty { font-size:0.85rem; color:var(--muted); margin:0; }

  .side h2 { font-size:0.95rem; margin:0 0 0.3rem; }
  .side .hint { font-size:0.8rem; color:var(--muted); margin:0 0 1rem; }
  .adopt { width:100%; padding:0.7rem; font-size:0.95rem; font-weight:600; border-radius:9px;
           border:1.5px solid var(--good); background:var(--good-soft); color:var(--ink); cursor:pointer; }
  .adopt:hover { filter:brightness(1.04); }
  .verdicts { display:grid; grid-template-columns:1fr 1fr; gap:0.4rem; margin:0.6rem 0; }
  .verdicts button { padding:0.45rem; font-size:0.82rem; border-radius:8px; border:1px solid var(--line);
                     background:var(--paper); color:var(--ink); cursor:pointer; }
  .verdicts button[aria-pressed="true"] { border-color:var(--accent); background:var(--accent-soft); }
  textarea { width:100%; min-height:9rem; padding:0.6rem; border-radius:8px; border:1px solid var(--line);
             background:var(--paper); color:var(--ink); font:inherit; font-size:0.88rem; resize:vertical; }
  .send { width:100%; margin-top:0.5rem; padding:0.6rem; border-radius:8px; border:1px solid var(--accent);
          background:var(--accent); color:#fff; font-weight:600; cursor:pointer; }
  .send[disabled] { opacity:0.45; cursor:not-allowed; }
  .note { font-size:0.75rem; color:var(--muted); margin:0.7rem 0 0; }
  .qq { border:1px solid var(--line); border-radius:8px; padding:0.5rem 0.6rem; margin:0.5rem 0; }
  .qq p { margin:0 0 0.35rem; font-size:0.84rem; }
  .qq .code { font-family:var(--mono); font-size:0.66rem; color:var(--faint); letter-spacing:0.06em; }
  .qq .row { display:flex; gap:0.25rem; flex-wrap:wrap; }
  .qq button { flex:1 1 auto; font-size:0.72rem; padding:0.25rem 0.4rem; border-radius:6px;
               border:1px solid var(--line); background:var(--paper); color:var(--ink); cursor:pointer; }
  .qq button[aria-pressed="true"] { border-color:var(--accent); background:var(--accent-soft); }
  .staged { margin-top:1.4rem; border-top:1px solid var(--line); padding-top:0.9rem; }
  .staged li { font-size:0.78rem; color:var(--muted); margin:0.35rem 0; list-style:none; }
  .ok { color:var(--good); font-size:0.82rem; margin:0.5rem 0 0; }
</style>
</head>
<body>

<header class="top">
  <span class="brand">🍊😺 Operations Dashboard</span>
  <span class="counts">
    <span class="pill rc">${counts.rc} release candidate${counts.rc === 1 ? '' : 's'}</span>
    <span class="pill blocker">${counts.blocker} your hands</span>
    <span class="pill decision">${counts.decision} decision${counts.decision === 1 ? '' : 's'}</span>
  </span>
  <span class="spacer"></span>
  <span class="where">local only · ${esc(generated.toTimeString().slice(0, 5))}</span>
</header>

<div class="cols">

  <nav class="rail" aria-label="Your queue">
    ${total === 0 ? '<p class="q-empty">Nothing is waiting on you.</p>' : ''}
    ${group('Release candidates', queue.rcs.items, queue.rcs.refreshing ? 'Sweeping GitHub — reload in a moment.' : 'None waiting.')}
    ${group('Only your hands', queue.blockers.items, 'Nothing blocked on you.')}
    ${group('Decisions', queue.decisions.items, 'Everything is answered.')}
    ${queue.decisions.error ? `<p class="q-empty">Decisions unavailable: ${esc(queue.decisions.error)}</p>` : ''}
  </nav>

  <main class="main" id="main">
    <div class="placeholder" id="placeholder">
      <h2>Your todo list, and where you answer it.</h2>
      <p>Pick anything on the left. A <strong>decision</strong> opens here in full and you answer it in the sidebar — no leaving the page, no typing it somewhere else afterwards.</p>
      <p>A <strong>release candidate</strong> opens on GitHub in a new tab. A <strong>blocker</strong> is a note to yourself: something only your hands can do, kept on this machine and nowhere else.</p>
      <p class="note">Answers are written to this machine's ops folder and applied to the artifact, the decision log and the index by an agent — the page never holds a credential that can write to the hub on your behalf.</p>
    </div>
  </main>

  <aside class="side" id="side">
    <h2 id="side-title">Nothing selected</h2>
    <p class="hint" id="side-hint">Choose a decision on the left to answer it.</p>
    <div id="answer" hidden>
      <button class="adopt" id="adopt">Adopt all recommendations</button>
      <div id="questions"></div>
      <div class="verdicts">
        <button data-v="approve" aria-pressed="false">Approve</button>
        <button data-v="reject" aria-pressed="false">Reject</button>
        <button data-v="defer" aria-pressed="false">Defer</button>
        <button data-v="more" aria-pressed="false">Ask for more</button>
      </div>
      <textarea id="words" placeholder="In your words — this is what gets quoted in the artifact's Decisions section, verbatim."></textarea>
      <button class="send" id="send" disabled>Record this decision</button>
      <p class="note">Recorded here, then applied to the artifact, the log and the index. Nothing is pushed until an agent runs the apply step.</p>
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
        : 'Only your hands can clear this one. It is not published anywhere.';
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
