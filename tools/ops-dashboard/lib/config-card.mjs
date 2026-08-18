// A config item as one short page he can decide from.
//
// @jwildfire, 2026-08-18: "The config format isn't working for me. Let's make
// local-only (relatively short) html artifacts for each item. start with an exec
// summary, then background and then step by step."
//
// That is the third format in three days, and the reason is worth writing down
// rather than fixing a fourth time. On the 16th he called the list "pretty
// useless" because it said what to run and never what he should see; the
// installation qualification fixed exactly that and gave him a five-field form.
// Both times the named defect was fixed and nobody asked what he does with one of
// these. He reads on a phone to decide whether it is worth going to a keyboard,
// then works at the keyboard with the item open. Those are two documents and we
// kept shipping one.
//
// So the three sections he asked for are built as that split, not as a running
// order:
//
//   Summary      the phone document. Complete on its own — what this is, whether
//                it is worth doing now, how long it takes, what it buys. No
//                forward reference to a step, because the steps may be off-screen.
//   Background   why the item exists. Not the history of how it was found.
//   Steps        the keyboard document, each step carrying what he should see.
//
// ## What survives the field names
//
// `Do/Expect/Verify/Unblocks/Source` go. Two properties of them do not, because
// they are the reason the form was worth having at all:
//
//   - what he should see when it worked, so an item is checkable and therefore
//     finishable — here it is the `See:` line on every step;
//   - a check he can run afterwards that answers pass or fail — here it is the
//     closing block, taken from the entry's own verify command so the page and
//     the list can never disagree about what proof means.
//
// A card that drops either of those to look cleaner has re-made the mistake of
// the 16th in the opposite direction.
//
// ## Two sources, and why not one
//
// The spine — id, title, dates, criticality, what it blocks, the verify command —
// is read live from `.claude/blockers.md` on every render and never copied. The
// prose is a per-item file in the local store. A card therefore cannot drift from
// the list about anything measurable, and the writing lives where writing can be
// edited without touching the operational record. An item with no prose still gets
// a card: it renders the raw entry and says so, which is honest and keeps every
// open item reachable at the same address.
//
// ## Containment
//
// Config item text has never reached a public surface — that is why the list lives
// outside git, and it predates this format. Here it is structural rather than
// remembered: `writeCard` is the only writer, it computes its destination from the
// id instead of taking a path, it refuses a destination outside the store, it
// refuses a store with a `.git` anywhere above it, and it refuses content that is
// not sentinel-stamped. Four refusals, four tests. A generator that cannot write to
// a published path cannot leak.
import fs from 'node:fs';
import path from 'node:path';

import { opsDir, SENTINEL } from './store.mjs';

/** Where cards live. Inside the ops store, which is local-only by construction. */
export const cardsDir = (workspace) => path.join(opsDir(workspace), 'config-cards');

/** The id shape. Anything else is not an id and is never turned into a filename. */
export const CARD_ID_RE = /^c\d{4}$/;

const EXTS = new Set(['html', 'md']);

/**
 * A card's path, computed from the id.
 *
 * The id is validated and then joined, rather than sanitised and hoped about: a
 * request path is not a filename until something says it is, and the only thing
 * saying so here is a four-digit match. The resolved result is checked against the
 * store as well, so a future change to the id shape cannot quietly open a way out.
 */
export function cardPath(workspace, id, ext = 'html') {
  const key = String(id ?? '').toLowerCase();
  if (!CARD_ID_RE.test(key)) throw new Error(`not a config id: ${JSON.stringify(id)}`);
  if (!EXTS.has(ext)) throw new Error(`not a card extension: ${JSON.stringify(ext)}`);
  const dir = path.resolve(cardsDir(workspace));
  const file = path.resolve(dir, `${key}.${ext}`);
  if (file !== path.join(dir, `${key}.${ext}`)) throw new Error(`resolved outside the card store: ${file}`);
  return file;
}

/**
 * Refuse to write anywhere a repository could pick it up.
 *
 * Two rules, and the second is the one that matters in a year. The first pins the
 * destination inside the store. The second walks up from the store to the
 * filesystem root and refuses if any ancestor holds a `.git` — because a store that
 * has been moved, symlinked or nested inside a checkout is a store one `git add`
 * from publication, and nothing else in this program would notice. Today
 * `~/Documents/obot2/.claude` has no `.git` above it at all, which is not an
 * accident: it is the same reasoning that put the config list there.
 */
export function assertLocalOnly(workspace, file) {
  const dir = path.resolve(cardsDir(workspace));
  const target = path.resolve(file);
  if (target !== dir && !target.startsWith(dir + path.sep)) {
    throw new Error(`refusing to write outside the local card store: ${target}`);
  }
  for (let d = dir; ; d = path.dirname(d)) {
    if (fs.existsSync(path.join(d, '.git'))) {
      throw new Error(`refusing to write: ${d} is inside a git repository — config item text never enters one`);
    }
    if (path.dirname(d) === d) break;
  }
  return target;
}

/**
 * The only writer. Sentinel-checked before it touches the disk.
 *
 * The stamp is not decoration: the hub's deploy greps the assembled site for this
 * exact string and fails the build on a hit. So a card that somehow reached a
 * published tree takes the deploy down instead of going out, and refusing to write
 * an unstamped card is what keeps that guarantee true of every file this produces.
 */
export function writeCard(workspace, id, content, ext = 'html') {
  const file = assertLocalOnly(workspace, cardPath(workspace, id, ext));
  if (!String(content ?? '').includes(SENTINEL)) {
    throw new Error('refusing to write a card without the local-only sentinel');
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return file;
}

// ------------------------------------------------------------------ the prose

/** Front-matter keys the card renders. Anything else is reported, never guessed at. */
export const FRONT_KEYS = ['time', 'now', 'unblocks', 'skip', 'deadline'];

/**
 * Section headings, and what each is called when someone writes it the way it reads
 * on the page rather than the way the parser names it.
 *
 * The aliases are not politeness. The heading in the source never appears in the
 * output — the page supplies its own — so a writer naturally types the words they
 * see, and the first card written for this format lost its entire background section
 * to a heading called "Why this exists". Silently, which is the failure mode this
 * programme keeps paying for. Now it either matches or it is reported.
 */
export const SECTIONS = {
  summary: 'summary', 'the short version': 'summary', 'short version': 'summary',
  background: 'background', why: 'background', 'why this exists': 'background',
  steps: 'steps', 'step by step': 'steps',
  check: 'check', proof: 'check', 'did it take': 'check', 'did it take?': 'check',
};

/**
 * Parse one card's prose source.
 *
 * Deliberately small: `key: value` lines before the first heading, then `##`
 * sections, then `###` steps inside `## Steps`. Four-space indentation is a literal
 * command, the same convention the config list itself uses, so the thing he pastes
 * survives being written down. A `See:` line is what he should see — the one field
 * name that stayed, because it is the property the format exists to carry.
 */
export function parseCardSource(md = '') {
  const lines = String(md).replace(/\r/g, '').split('\n');
  const front = {};
  const unknown = [];
  const sections = {};
  let i = 0;
  for (; i < lines.length; i++) {
    const l = lines[i];
    if (/^##\s/.test(l)) break;
    if (!l.trim()) continue;
    const m = /^([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.*)$/.exec(l);
    if (!m) continue;
    const key = m[1].toLowerCase();
    if (FRONT_KEYS.includes(key)) front[key] = m[2].trim();
    else unknown.push(key);
  }
  let name = null;
  const unknownSections = [];
  for (; i < lines.length; i++) {
    const h = /^##\s+(.*)$/.exec(lines[i]);
    if (h) {
      const heading = h[1].trim().toLowerCase();
      name = SECTIONS[heading] ?? null;
      if (!name) unknownSections.push(h[1].trim());
      else sections[name] = sections[name] ?? [];
      continue;
    }
    if (name) sections[name].push(lines[i]);
  }
  const text = (k) => trimBlank(sections[k] ?? []);
  return {
    front,
    unknown,
    unknownSections,
    summary: text('summary'),
    background: text('background'),
    steps: parseSteps(sections.steps ?? []),
    check: text('check'),
    empty: !text('summary') && !text('background') && !(sections.steps ?? []).length,
  };
}

/**
 * Drop blank lines from both ends and keep every other space.
 *
 * `.trim()` would be the obvious call and it is wrong here: a step that opens with
 * a command opens with four spaces, and trimming them turns the thing he pastes
 * into a paragraph. Found by a step whose only command silently became prose.
 */
export const trimBlank = (lines) => {
  const l = [...lines];
  while (l.length && !l[0].trim()) l.shift();
  while (l.length && !l[l.length - 1].trim()) l.pop();
  return l.join('\n');
};

/** `### heading` starts a step; everything under it is that step's body. */
export function parseSteps(lines) {
  const steps = [];
  let cur = null;
  for (const l of lines) {
    const h = /^###\s+(.*)$/.exec(l);
    if (h) { cur = { title: h[1].trim(), body: [] }; steps.push(cur); continue; }
    if (cur) cur.body.push(l);
  }
  return steps.map((s) => ({ title: s.title, body: trimBlank(s.body) }));
}

/** A card's prose, or `{ missing: true }` when nobody has written one yet. */
export function readCardSource(workspace, id) {
  let md;
  try { md = fs.readFileSync(cardPath(workspace, id, 'md'), 'utf8'); } catch (e) {
    // ENOENT is the only failure that reads as "nobody has written one". Anything
    // else is a fault and says so, rather than being rendered as an unwritten card
    // (jwildfire/obot.agent#206).
    if (e.code === 'ENOENT') return { missing: true, why: null };
    return { missing: true, why: `${e.code}: ${e.message}` };
  }
  return { missing: false, why: null, ...parseCardSource(md) };
}

// ----------------------------------------------------------------- the model

/**
 * Join one config item with its prose into everything the page needs.
 *
 * The measurable half always comes from the item — the list is the record, and a
 * card that could disagree with it about a date, a blocking reference or a verify
 * command would be a second source of truth nobody asked for.
 */
export function buildCard(item, source = { missing: true }, { generatedAt = new Date(), currency = null } = {}) {
  const iq = item?.iq ?? {};
  const verify = iq.verify ?? null;
  return {
    id: item?.id ?? item?.key ?? null,
    title: item?.title ?? '(untitled)',
    filed: item?.date ?? null,
    verified: item?.verified ?? null,
    claim: item?.criticalClaim ?? null,
    blocks: (item?.blocks ?? []).filter((b) => b?.verified).map((b) => b.ref),
    sourceUrl: firstUrl(iq.source?.text),
    front: source.front ?? {},
    summary: source.summary ?? '',
    background: source.background ?? '',
    steps: source.steps ?? [],
    check: source.check ?? '',
    verify: verify ? { command: verify.command, expect: verify.expect, manual: Boolean(verify.manual) } : null,
    // The raw entry, rendered only when there is no prose — so an unwritten item is
    // still reachable at its address and still says what to do, while looking
    // plainly like the thing it is.
    raw: source.missing ? rawFields(iq) : null,
    unwritten: Boolean(source.missing),
    unreadable: source.why ?? null,
    // When the claim this card is about was last established, and by what
    // (obot.agent#262, under jwildfire/obot.roadmap#264). A card used to open with the
    // day somebody filed it, which is the one date that says nothing about whether it
    // is still worth walking to a keyboard for.
    currency: currency ?? null,
    generatedAt,
  };
}

const firstUrl = (s) => String(s ?? '').match(/https?:\/\/\S+/)?.[0] ?? null;

const rawFields = (iq) => ['do', 'expect', 'verify', 'unblocks', 'source', 'blocks', 'why']
  .map((f) => (iq[f] ? { name: f, text: iq[f].text ?? '', code: iq[f].code ?? [] } : null))
  .filter(Boolean);

/**
 * The summary as plain text — the phone lane's copy.
 *
 * The dashboard is on loopback and a phone cannot reach it, so the document written
 * to be read on a phone has to be able to travel without its page. The morning
 * briefing and the push relay can carry this verbatim instead of paraphrasing a
 * card nobody on that end can open.
 */
export function summaryText(card) {
  const out = [`${card.id ?? '?'} — ${card.title}`, ''];
  const strip = FRONT_KEYS.filter((k) => k !== 'deadline' && card.front[k])
    .map((k) => `${STRIP_LABEL[k]}: ${card.front[k]}`);
  if (strip.length) out.push(...strip, '');
  // The currency line travels with the summary. The phone lane is the one place he
  // reads this without a dashboard beside it, so a card that says how old its claim is
  // only on screen has said it to the wrong reader.
  if (card.currency?.phrase) out.push(card.currency.phrase, '');
  const body = card.summary || card.raw?.find((f) => f.name === 'do')?.text || '';
  if (body) out.push(plain(body));
  return `${out.join('\n').trim()}\n`;
}

const plain = (md) => String(md)
  .replace(/^\s{4,}/gm, '    ')
  // A relative link is an address on this machine's loopback dashboard, which is the
  // one place a reader of this text is not. Its label survives; the dead path does not.
  .replace(/\[([^\]]+)\]\((?!https?:)[^)]+\)/g, '$1')
  .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '$1 ($2)')
  .replace(/`/g, '')
  .trim();

const STRIP_LABEL = {
  time: 'Takes', now: 'Do it now?', unblocks: 'Buys you', skip: 'If you skip it', deadline: 'Deadline',
};

// ---------------------------------------------------------------- the render

export const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/**
 * Inline markup: links and code, and nothing else.
 *
 * No bold. @jwildfire's standing style rule is that a bolded clause mid-paragraph
 * is never the right emphasis — important things get a block of their own — and the
 * cheapest way to keep a renderer honest about that is to give it no way to do it.
 * A stray `**` renders literally, which is a visible reminder rather than a silent
 * acceptance.
 */
export function inline(s) {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // Two href shapes and no others: an absolute http(s) link, and a root-relative
    // path, which is how one card points at another on the dashboard. Everything
    // else — `javascript:`, `data:`, a bare word — is left as the text it was
    // written as, because an allowlist of two is a thing a reader can hold in mind
    // and a blocklist of schemes is not.
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+|\/[^)\s]*)\)/g, '<a href="$2">$1</a>')
    .replace(/(^|[\s(])((?:https?:\/\/)[^\s<)]+)/g, '$1<a href="$2">$2</a>');
}

/**
 * Blocks: paragraphs, bullets, indented commands, and the `See:` line.
 *
 * The `See:` line is rendered as its own bordered block rather than as a sentence,
 * because it is the half of a step he checks against reality and it has to survive
 * being skimmed at arm's length.
 */
export function blocks(md = '') {
  const lines = String(md).replace(/\r/g, '').split('\n');
  const out = [];
  let para = [];
  let list = [];
  let code = [];
  let fence = null;
  const flushPara = () => { if (para.length) out.push(`<p>${inline(para.join(' '))}</p>`); para = []; };
  const flushList = () => { if (list.length) out.push(`<ul>${list.map((l) => `<li>${inline(l)}</li>`).join('')}</ul>`); list = []; };
  const flushCode = () => {
    if (!code.length) return;
    const pad = Math.min(...code.map((c) => c.match(/^ */)[0].length));
    const text = code.map((c) => c.slice(pad)).join('\n');
    out.push(`<div class="cmd"><pre>${esc(text)}</pre><button class="copy" type="button" data-copy="${esc(text)}">copy</button></div>`);
    code = [];
  };
  const flush = () => { flushPara(); flushList(); flushCode(); };
  for (const raw of lines) {
    // A fence is a transcript — what a command printed — and gets no copy button.
    // An indented line is a command he pastes and does. Same monospace box, and the
    // difference matters at the moment he is deciding what to type: a copy button on
    // sample output invites pasting the answer back in as a question.
    if (/^\s*```/.test(raw)) {
      if (fence === null) { flush(); fence = []; } else { out.push(`<pre class="out">${esc(fence.join('\n'))}</pre>`); fence = null; }
      continue;
    }
    if (fence !== null) { fence.push(raw.trimEnd()); continue; }
    if (/^\s{4,}\S/.test(raw)) { flushPara(); flushList(); code.push(raw.trimEnd()); continue; }
    flushCode();
    if (!raw.trim()) { flush(); continue; }
    const see = /^see\s*:\s*(.*)$/i.exec(raw.trim());
    if (see) { flush(); out.push(`<p class="see"><span class="lab">You should see</span>${inline(see[1])}</p>`); continue; }
    const bullet = /^\s*[-*]\s+(.*)$/.exec(raw);
    if (bullet) { flushPara(); list.push(bullet[1]); continue; }
    flushList();
    para.push(raw.trim());
  }
  // An unclosed fence is still content, and dropping it would lose the thing it was
  // wrapping — the reader sees the transcript, not a silent gap.
  if (fence !== null && fence.length) out.push(`<pre class="out">${esc(fence.join('\n'))}</pre>`);
  flush();
  return out.join('\n');
}

/** The one page. Self-contained by contract — it opens from the disk with no server. */
export function renderCard(card) {
  const strip = FRONT_KEYS.filter((k) => k !== 'deadline' && card.front[k]).map((k) => `
      <div class="fact"><span class="lab">${esc(STRIP_LABEL[k])}</span><span class="val">${inline(card.front[k])}</span></div>`).join('');

  const meta = [card.id, card.filed ? `filed ${card.filed}` : null, card.verified ? `verified ${card.verified}` : null]
    .filter(Boolean).join(' · ');
  // The currency line goes directly under the title, above everything he would read to
  // decide. It is the first question a card has to answer — is this still true — and
  // the three states get three treatments so an unrunnable check can never be mistaken
  // for one that came back outstanding.
  const currency = card.currency
    ? `<p class="cur ${esc(card.currency.state)}">${esc(card.currency.phrase)}</p>` : '';

  const steps = card.steps.map((s, i) => `
    <li class="step">
      <h3><span class="n">${i + 1}</span>${esc(s.title)}</h3>
      ${blocks(s.body)}
    </li>`).join('');

  const rawBody = card.raw ? `
    <div class="note">No card has been written for ${esc(card.id ?? 'this item')} yet, so this is the list entry as it stands. It is the same text the dashboard panel shows.</div>
    ${card.raw.map((f) => `<div class="rawf"><span class="lab">${esc(f.name)}</span><div>${blocks([f.text, ...f.code.map((c) => `    ${c}`)].join('\n'))}</div></div>`).join('')}` : '';

  return `<!doctype html>
<!-- ${SENTINEL}. A config item, rendered for @jwildfire on his own machine.
     Requirement: jwildfire/obot.roadmap#263. This file is served from
     <workspace>/.claude/ops/config-cards/ and never enters a repository. -->
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(card.id ?? 'config')} · ${esc(card.title)}</title>
<style>${CARD_CSS}</style>
</head>
<body>
<article>
  <header>
    <p class="kicker">Config item${card.claim ? ` · <span class="crit">critical — ${esc(card.claim)}</span>` : ''}</p>
    <h1>${esc(card.title)}</h1>
    <p class="meta">${esc(meta)}</p>
    ${currency}
  </header>

  ${card.unreadable ? `<p class="alarm">This item's card could not be read: ${esc(card.unreadable)}. What follows is the list entry, not the card.</p>` : ''}

  <section class="sum">
    <h2>The short version</h2>
    ${card.front.deadline ? `<p class="clock" data-deadline="${esc(card.front.deadline)}">Deadline ${esc(card.front.deadline)} daily.</p>` : ''}
    ${strip ? `<div class="facts">${strip}\n    </div>` : ''}
    ${card.summary ? blocks(card.summary) : ''}
  </section>

  ${card.background ? `<section>
    <h2>Why this exists</h2>
    ${blocks(card.background)}
  </section>` : ''}

  ${steps ? `<section>
    <h2>Step by step</h2>
    <ol class="steps">${steps}
    </ol>
  </section>` : ''}

  ${rawBody ? `<section>${rawBody}</section>` : ''}

  <section class="proof">
    <h2>Did it take?</h2>
    ${card.check ? blocks(card.check) : ''}
    ${proofBlock(card)}
  </section>

  <footer>
    <p>${card.sourceUrl ? `Filed from <a href="${esc(card.sourceUrl)}">${esc(card.sourceUrl)}</a>. ` : ''}${card.blocks.length ? `Open work waiting on it: ${card.blocks.map((b) => esc(b)).join(', ')}. ` : ''}Local only — this page is on your machine and goes nowhere else.</p>
    <p class="gen">Rendered ${esc(card.generatedAt.toISOString().replace('T', ' ').slice(0, 16))}Z from <code>.claude/blockers.md</code>, which is unchanged by this page.</p>
  </footer>
</article>
<script>${CARD_JS}</script>
</body>
</html>
`;
}

/** The closing pass/fail. Taken from the entry, so the page cannot invent a proof. */
function proofBlock(card) {
  if (!card.verify) return '<p class="see">This entry carries no check. Until it does, done is a judgement rather than a result.</p>';
  if (card.verify.manual || !card.verify.command) {
    return `<p class="see"><span class="lab">Manual</span>${inline(card.verify.expect || 'nothing here can be scripted — you are the check')}</p>`;
  }
  return `<div class="cmd"><pre>${esc(card.verify.command)}</pre><button class="copy" type="button" data-copy="${esc(card.verify.command)}">copy</button></div>
    <p class="see"><span class="lab">Pass</span>${inline(card.verify.expect || 'it exits 0. Anything else is a fail.')}</p>${
      card.currency ? `\n    <p class="see"><span class="lab">Last run</span>${esc(card.currency.phrase)}</p>` : ''}`;
}

const CARD_CSS = `
  :root {
    --paper:#F4F1EC; --card:#FDFCFA; --ink:#26211B; --muted:#6F6558; --faint:#9C917F;
    --line:#E2DACC; --accent:#B4470E; --accent-soft:#F4E2D2; --good:#2F6B4F;
    --warn:#8A5A00; --warn-soft:#F6ECD8; --crit:#A8201A;
    --sans:"Instrument Sans","Avenir Next","Segoe UI",system-ui,sans-serif;
    --mono:"IBM Plex Mono",ui-monospace,SFMono-Regular,Menlo,monospace;
  }
  @media (prefers-color-scheme: dark) { :root {
    --paper:#1A1611; --card:#232019; --ink:#EAE4D8; --muted:#A69B89; --faint:#7E7462;
    --line:#383126; --accent:#E8843C; --accent-soft:#3C2A18; --good:#7FBF9B;
    --warn:#D9A441; --warn-soft:#33280F; --crit:#F0736B;
  } }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--paper); color:var(--ink); font-family:var(--sans); line-height:1.55;
         font-size:16px; -webkit-text-size-adjust:100%; }
  article { max-width:44rem; margin:0 auto; padding:1rem 0.9rem 3rem; }
  header { border-bottom:1px solid var(--line); padding-bottom:0.7rem; margin-bottom:1rem; }
  .kicker { margin:0 0 0.2rem; font-size:0.68rem; letter-spacing:0.11em; text-transform:uppercase; color:var(--faint); }
  .kicker .crit { color:var(--crit); text-transform:none; letter-spacing:0; font-size:0.8rem; }
  h1 { font-size:1.32rem; line-height:1.25; margin:0 0 0.3rem; letter-spacing:-0.015em; }
  .meta { margin:0; font-family:var(--mono); font-size:0.7rem; color:var(--faint); }
  /* Three states, three treatments. Two of them sharing a colour is the collapse this
     line exists to prevent. */
  .cur { margin:0.35rem 0 0; font-size:0.78rem; color:var(--muted); }
  .cur.holds { color:var(--good); }
  .cur.unknown { color:var(--warn); }
  .cur.fails { color:var(--ink); }
  h2 { font-size:0.7rem; letter-spacing:0.12em; text-transform:uppercase; color:var(--muted);
       margin:1.6rem 0 0.5rem; }
  section.sum { background:var(--card); border:1px solid var(--line); border-radius:10px;
                padding:0.2rem 0.85rem 0.85rem; }
  section.sum h2 { margin-top:0.85rem; }
  p { margin:0 0 0.7rem; }
  ul { margin:0 0 0.7rem; padding-left:1.1rem; }
  li { margin:0 0 0.25rem; }
  a { color:var(--accent); overflow-wrap:anywhere; }
  code { font-family:var(--mono); font-size:0.85em; background:var(--accent-soft); padding:0.05rem 0.25rem;
         border-radius:4px; overflow-wrap:anywhere; }

  /* The decision strip. Four facts, one per row on a phone and two-up when there is
     room — he reads this to decide whether to stand up, so it must not need a
     sideways scroll at 390px. minmax(0,…) because a long value in a grid track
     whose minimum is auto pushes the whole page wider than the viewport. */
  .facts { display:grid; grid-template-columns:1fr; gap:0.4rem 1rem; margin:0 0 0.8rem; }
  @media (min-width:34rem) { .facts { grid-template-columns:repeat(2, minmax(0,1fr)); } }
  .fact { display:flex; flex-direction:column; gap:0.05rem; min-width:0; }
  .fact .lab { font-size:0.6rem; letter-spacing:0.1em; text-transform:uppercase; color:var(--faint); }
  .fact .val { font-size:0.9rem; overflow-wrap:anywhere; }
  .clock { font-family:var(--mono); font-size:0.76rem; color:var(--accent); margin:0.6rem 0 0.5rem; }

  .steps { list-style:none; margin:0; padding:0; counter-reset:step; }
  .step { border-top:1px solid var(--line); padding:0.8rem 0 0.2rem; }
  .step:first-child { border-top:none; padding-top:0.2rem; }
  .step h3 { font-size:1rem; margin:0 0 0.45rem; display:flex; gap:0.5rem; align-items:baseline; line-height:1.3; }
  .step h3 .n { font-family:var(--mono); font-size:0.78rem; color:var(--accent); flex:none; }

  /* A command and its copy button. overflow-x on the pre alone, never on the page:
     one long command must scroll inside its own box. */
  .cmd { position:relative; margin:0 0 0.7rem; }
  .cmd pre { margin:0; padding:0.5rem 0.6rem; background:var(--card); border:1px solid var(--line);
             border-radius:8px; overflow-x:auto; font-family:var(--mono); font-size:0.76rem; line-height:1.5; }
  .cmd .copy { position:absolute; top:0.3rem; right:0.3rem; font-size:0.62rem; padding:0.1rem 0.4rem;
               border:1px solid var(--line); border-radius:5px; background:var(--paper); color:var(--muted);
               cursor:pointer; font-family:var(--sans); }
  .cmd .copy:hover { border-color:var(--accent); color:var(--accent); }
  pre.out { margin:0 0 0.7rem; padding:0.5rem 0.6rem; background:var(--paper); border:1px dashed var(--line);
            border-radius:8px; overflow-x:auto; font-family:var(--mono); font-size:0.74rem; line-height:1.5;
            color:var(--muted); }

  .see { border-left:2px solid var(--good); padding:0.1rem 0 0.1rem 0.6rem; font-size:0.88rem; color:var(--ink); }
  .see .lab { display:block; font-size:0.6rem; letter-spacing:0.1em; text-transform:uppercase; color:var(--muted); }
  .proof { border:1px solid var(--line); border-radius:10px; padding:0.2rem 0.85rem 0.85rem; margin-top:1.6rem;
           background:var(--card); }
  .proof h2 { margin-top:0.85rem; }
  .note { font-size:0.82rem; color:var(--warn); background:var(--warn-soft); border:1px solid var(--line);
          border-radius:8px; padding:0.5rem 0.6rem; margin:0 0 0.8rem; }
  .alarm { font-size:0.85rem; color:var(--ink); background:var(--accent-soft); border:1px solid var(--accent);
           border-radius:8px; padding:0.5rem 0.6rem; overflow-wrap:anywhere; }
  .rawf { margin:0 0 0.7rem; }
  .rawf > .lab { font-size:0.6rem; letter-spacing:0.1em; text-transform:uppercase; color:var(--faint); }
  footer { margin-top:2rem; border-top:1px solid var(--line); padding-top:0.7rem; font-size:0.75rem; color:var(--muted); }
  footer .gen { font-family:var(--mono); font-size:0.68rem; color:var(--faint); }
`;

// Two behaviours, both of which fail into something still readable if the script
// never runs: a copy button that becomes a decoration beside text he can select,
// and a deadline line that stays the sentence it was rendered as.
const CARD_JS = `
  document.querySelectorAll('.copy').forEach(function (b) {
    b.addEventListener('click', function () {
      navigator.clipboard.writeText(b.dataset.copy).then(function () {
        b.textContent = 'copied'; setTimeout(function () { b.textContent = 'copy'; }, 1200);
      });
    });
  });
  // A card generated at 06:00 must not still claim "in an hour" at 09:00, so the
  // countdown is computed in the browser from the reader's own clock rather than
  // baked in at render time.
  var c = document.querySelector('.clock');
  if (c && /^\\d{1,2}:\\d{2}$/.test(c.dataset.deadline || '')) {
    var p = c.dataset.deadline.split(':');
    var tick = function () {
      var now = new Date();
      var next = new Date(now); next.setHours(+p[0], +p[1], 0, 0);
      if (next <= now) next.setDate(next.getDate() + 1);
      var m = Math.round((next - now) / 60000);
      var when = m < 60 ? m + ' min' : Math.floor(m / 60) + 'h ' + (m % 60) + 'm';
      var today = next.getDate() === now.getDate();
      c.textContent = 'Next ' + c.dataset.deadline + ' is in ' + when + (today ? ' — today' : ' — tomorrow, today\\u2019s has passed');
    };
    tick(); setInterval(tick, 30000);
  }
`;
