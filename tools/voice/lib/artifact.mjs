// Reading a decision page for the things an episode has to say out loud.
//
// Two facts about these pages decided the shape of this module, both measured across
// all 22 artifacts rather than assumed from the newest one:
//
//   the generated question block is universal — `<aside class="decision-ids">`, and
//   the same content is in the registry, so questions never need scraping;
//
//   OPTION CARDS ARE NOT. Exactly one artifact of 22 carries `<section id="options">`
//   with `Option A/B/C` cards. On the other 21 the choices live as prose inside the
//   question blocks, with the pick in a `.rec` line.
//
// So an option extractor that assumes the newest page's markup would produce a
// confident empty list on almost every decision, and an episode built on it would
// read out a decision with no choices in it. This one reports what it found AND
// whether it could read the page at all, and the script generator degrades to the
// recommendations when there are no cards. Absent options are a fact about the page;
// an unreadable page is a different fact and says so.
import fs from 'node:fs';
import path from 'node:path';

const strip = (html) => String(html ?? '')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&#8217;|&rsquo;/g, "'").replace(/&nbsp;/g, ' ').replace(/&mdash;/g, '—')
  .replace(/\s+/g, ' ')
  .trim();

export const artifactPath = (hub, slug) => path.join(hub ?? '', 'reports', 'decisions', slug ?? '', 'index.html');

/**
 * What the page offers him. `{options, recommendations, read, why}`.
 *
 * `options` are the labelled cards — `{label: 'Option A', qualifier: 'recommended',
 * headline: '...'}` — and are frequently empty because most pages do not have any.
 * `recommendations` are the per-question `.rec` lines, which most pages DO have, and
 * are what the episode reads instead.
 */
export function readArtifact(hub, slug) {
  const file = artifactPath(hub, slug);
  let html;
  try { html = fs.readFileSync(file, 'utf8'); } catch (e) {
    return { options: [], recommendations: [], read: false, why: `${file} could not be read (${e.code ?? e.message})` };
  }

  const options = [];
  const optionsBlock = /<section id="options">([\s\S]*?)<\/section>/i.exec(html);
  if (optionsBlock) {
    const cards = optionsBlock[1].split(/<div class="card/i).slice(1);
    for (const card of cards) {
      const tag = /<div class="tag">([\s\S]*?)<\/div>/i.exec(card);
      const h3 = /<h3>([\s\S]*?)<\/h3>/i.exec(card);
      if (!tag) continue;
      const label = strip(tag[1]);
      const letter = /option\s+([A-Z])\b/i.exec(label)?.[1]?.toUpperCase() ?? null;
      const qualifier = label.split(/[—-]/).slice(1).join(' ').trim().toLowerCase() || null;
      options.push({ label, letter, qualifier, headline: h3 ? strip(h3[1]) : null });
    }
  }

  const recommendations = [];
  for (const q of html.split(/<div class="q"/i).slice(1)) {
    const code = /<div class="qid">([\s\S]*?)<\/div>/i.exec(q);
    const head = /<h3>([\s\S]*?)<\/h3>/i.exec(q);
    const rec = /<div class="rec">([\s\S]*?)<\/div>/i.exec(q);
    if (!code && !rec) continue;
    recommendations.push({
      code: code ? strip(code[1]) : null,
      question: head ? strip(head[1]) : null,
      recommendation: rec ? strip(rec[1]) : null,
    });
  }

  return { options, recommendations, read: true, why: '' };
}

/**
 * The verdict his words name, or null.
 *
 * Null is the normal answer and it is not a failure: `recordAnswer` records a
 * words-only answer, his sentence is kept whole, and an agent reads it. What is NOT
 * allowed is naming an option the page does not have, or choosing between two his
 * words fit equally — #265 is explicit that nothing paraphrases his answer into a
 * cleaner decision, and a verdict invented here is exactly that.
 */
export function verdictFrom(rest, options = []) {
  if (!options.length) return null;
  const said = String(rest ?? '').toLowerCase();
  if (!said.trim()) return null;
  const hits = new Set();

  const letter = /\boption\s+([a-z])\b/.exec(said)?.[1]
    ?? /^\s*([a-z])\b/.exec(said)?.[1]
    ?? null;
  // The short name, not the card's full label: "Option A" is what the page's own
  // question and recommendation call it, and what an agent applying this will look for.
  const name = (o) => (o.letter ? `Option ${o.letter}` : o.label);
  for (const o of options) {
    if (letter && o.letter && o.letter.toLowerCase() === letter) hits.add(name(o));
    // "the recommended one", "the minimal one" — the qualifier is how the episode
    // names each card out loud, so it is how he will name one back.
    if (o.qualifier && new RegExp(`\\b${o.qualifier.replace(/[^a-z]/g, '')}`, 'i').test(said.replace(/[^a-z ]/g, ''))) {
      hits.add(name(o));
    }
  }
  return hits.size === 1 ? [...hits][0] : null;
}
