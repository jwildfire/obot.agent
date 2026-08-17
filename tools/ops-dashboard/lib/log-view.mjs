// The agents log — the full record at /session/log, written for its dense readers
// (jwildfire/obot.roadmap#218).
//
// @jwildfire: "I'd lean towards making the audit log an actual table." This is
// that page. His /session tab carries the brief; everything below is the record —
// every agent, every delivery verdict, every Navigator call — as tables, because
// the log's readers come to check one thing against another and a table is the
// shape of that question.
//
// The delivery record renders from its TYPED journal, not from the markdown: the
// markdown render collapses calls and verdicts into prose lines, drops seconds,
// and the old page lost 60 of 84 records on the way through the roster join —
// seven verdicts belonged to agents whose jobs had aged out and every call line
// was invisible. A record read from the journal cannot lose rows to a join.
import { esc } from './esc.mjs';
import { refUrl } from './roster.mjs';

const REF_RE = /\b([\w][\w.-]*#\d+)\b/g;

/** Text with its issue/PR references linked — escape first, link second. */
export function linkRefs(text = '') {
  return String(text).split(REF_RE).map((part, i) => {
    if (i % 2 === 0) return esc(part);
    const url = refUrl(part);
    return url ? `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(part)}</a>` : esc(part);
  }).join('');
}

/** The typed delivery journal → verdict rows and call rows, newest first. */
export function parseDeliveryJournal(text = '') {
  const verdicts = [];
  const calls = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let rec;
    try { rec = JSON.parse(line); } catch { continue; }
    if (rec.op === 'verdict') verdicts.push(rec);
    else if (rec.op === 'call') calls.push(rec);
  }
  const ts = (r) => Date.parse(r.at ?? '') || 0;
  verdicts.sort((a, b) => ts(b) - ts(a));
  calls.sort((a, b) => ts(b) - ts(a));
  return { verdicts, calls };
}

const when = (iso) => {
  const t = Date.parse(iso ?? '');
  if (Number.isNaN(t)) return '';
  const d = new Date(t);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

export function deliveryTablesHtml({ verdicts, calls }) {
  if (!verdicts.length && !calls.length) {
    return '<h2 class="nav-h">Delivery record</h2><p class="ag-empty">No delivery record yet — the Navigator writes one the first time it judges a worker or takes a decision in his place.</p>';
  }
  // Day two: verdicts recorded, no calls yet. The both-empty case was handled and
  // neither one-sided case was, so a heading sat over a full <thead> and a literally
  // empty <tbody> — the blank panel the requirement forbids
  // (jwildfire/obot.roadmap#223).
  const empty = (cols, sentence) => `<tr><td class="lg-empty" colspan="${cols}">${sentence}</td></tr>`;
  const vRows = verdicts.map((v) => `<tr>
  <td class="lg-t">${esc(when(v.at))}</td>
  <td class="lg-a">${esc(v.worker ?? '')}</td>
  <td class="lg-p">${linkRefs(v.produced ?? '')}${v.note ? `<div class="lg-note">${linkRefs(v.note)}</div>` : ''}</td>
  <td class="lg-r">${linkRefs(v.requirement ?? '')}</td>
  <td class="lg-v lg-v-${esc(v.verdict ?? 'none')}">${esc(v.verdict ?? '')}</td>
</tr>`).join('\n');
  const cRows = calls.map((c) => `<tr>
  <td class="lg-t">${esc(when(c.at))}</td>
  <td class="lg-a">${esc(c.id ?? '')}</td>
  <td class="lg-k">${esc(c.kind ?? '')}</td>
  <td class="lg-p">${linkRefs(c.summary ?? '')}</td>
</tr>`).join('\n');
  return `<h2 class="nav-h">Delivery record — the Navigator's verdicts, from the typed journal</h2>
<div class="mwrap"><table class="lg">
<thead><tr><th>when</th><th>agent</th><th>produced</th><th>requirement</th><th>verdict</th></tr></thead>
<tbody>
${vRows || empty(5, 'No closeout has been judged yet — a verdict appears here the first time the Navigator weighs what a worker produced.')}
</tbody></table></div>
<h2 class="nav-h">Calls made for him — decisions the Navigator took in his place</h2>
<div class="mwrap"><table class="lg">
<thead><tr><th>when</th><th>call</th><th>kind</th><th>what was decided</th></tr></thead>
<tbody>
${cRows || empty(4, 'No Navigator call recorded yet — one appears here the first time it decides something in his place.')}
</tbody></table></div>`;
}

export const LOG_CSS = `
  table.lg td.lg-empty { color:var(--muted); font-style:normal; padding:0.4rem 0.45rem; }
  table.lg { border-collapse:collapse; width:100%; font-size:0.72rem; }
  table.lg th { font-size:0.62rem; letter-spacing:0.08em; text-transform:uppercase; color:var(--faint);
                font-weight:500; text-align:left; padding:0.2rem 0.45rem; }
  table.lg td { padding:0.24rem 0.45rem; border-top:1px solid var(--line); vertical-align:top;
                overflow-wrap:anywhere; }
  table.lg .lg-t { font-family:var(--mono); font-size:0.66rem; color:var(--faint); white-space:nowrap; }
  table.lg .lg-a { font-family:var(--mono); font-size:0.7rem; white-space:nowrap; }
  table.lg .lg-k { color:var(--muted); white-space:nowrap; }
  table.lg .lg-p { color:var(--muted); min-width:14rem; }
  table.lg .lg-r { color:var(--muted); min-width:8rem; }
  table.lg .lg-note { color:var(--faint); font-size:0.68rem; margin-top:0.15rem; }
  table.lg .lg-v { font-size:0.64rem; letter-spacing:0.05em; text-transform:uppercase; white-space:nowrap; }
  table.lg .lg-v-confirmed { color:var(--good, #15803d); }
  table.lg .lg-v-drift { color:#c9a227; }
  table.lg .lg-v-none { color:var(--faint); }
  table.lg a { color:var(--muted); text-decoration:none; border-bottom:1px dotted var(--line); }
  table.lg a:hover { color:var(--ink); }
`;
