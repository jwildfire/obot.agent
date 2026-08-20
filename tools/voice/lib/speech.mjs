// The words an episode says, and the words he can say back.
//
// This is the OUT half of jwildfire/obot.roadmap#265, written against #242's shape
// (five minutes, derived from the text, the text stays the authority) and #280's
// close ("Subject word plus choice, spoken once and repeated slowly, no identifiers
// of any kind").
//
// ## Three rules it is built to keep
//
// NO IDENTIFIERS. Not the decision id, not an issue number, not a URL, not the slug,
// not a date. He said it twice: he is driving, and he will not have any of them. A
// test asserts every one of those is absent rather than trusting the writer.
//
// ONE VOCABULARY. The handle it reads out comes from `handles.mjs`, which is the same
// module the router matches against — and the example sentence it tells him to say is
// round-tripped through the router in the tests. If the two ever diverge, that test
// fails rather than a dictated answer going missing.
//
// IT READS THE PAGE, AND SAYS WHEN IT COULD NOT. Only one decision artifact of the
// twenty-two carries `Option A/B/C` cards; the rest put the choices in prose with the
// pick in a recommendation line. So there are two shapes here, the script says which
// one it used, and an artifact it could not open produces a sentence saying so rather
// than a decision read out with no content in it.
//
// ## Plain text, because a synthesiser is the reader
//
// No markdown, no dashes it would read as words, no URLs. `save-to-spotify` takes
// audio, its Kokoro path takes plain text, and there is no SSML anywhere in it.
import { readArtifact } from './artifact.mjs';
import { normalizeSpoken, similarity } from './match.mjs';

/**
 * Kokoro at default speed (`af_heart`, speed 1.0), MEASURED — script word count against
 * the rendered duration of the episodes actually published on 2026-08-18:
 *
 *   1043 words / 351.7 s = 178 wpm      "Decision: scheduled sessions"
 *    759 words / 246.5 s = 185 wpm      "Decision: the autonomy goal"
 *   1018 words / 351.9 s = 174 wpm      "Decision: SafetyCensus, stays or goes"
 *   1543 words / 9.1 min = 170 wpm      "The project so far"
 *   1498 words / 8.4 min = 178 wpm      "The weekend, since prime went live"
 *
 * This constant read 150 until 2026-08-20, with a comment claiming it had been measured
 * on those same episodes. It had not been: 150 is the rate a script is DRAFTED against,
 * not the rate Kokoro reads it at. The gap is about 18%, and it ran the wrong way — the
 * five-minute guideline he set was being enforced at roughly four minutes of audio, so
 * writers cut material out of episodes that were already inside the bound (#280).
 */
export const SPOKEN_WPM = 176;
/** Kept as the old name so nothing that imported it breaks; it is the same number. */
export const WORDS_PER_MINUTE = SPOKEN_WPM;
/** The length he set, in the same sentence that granted the exception (#280). */
export const TARGET_MINUTES = 5;

/** How long a script of this many words will actually run, in minutes. */
export const minutesFor = (words) => Math.round((Number(words || 0) / SPOKEN_WPM) * 10) / 10;
/** How many words fit in a target length — about 880 at the five-minute guideline. */
export const wordsForTarget = (minutes = TARGET_MINUTES) => Math.round(minutes * SPOKEN_WPM);

/** Plain speech: no markdown, no links, no identifiers, nothing to read as a symbol. */
export function sanitize(s) {
  return String(s ?? '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, '')
    .replace(/\bD\d{4}(\.\d+)?\b/g, '')
    .replace(/#\d+/g, '')
    .replace(/[*_`#]/g, '')
    .replace(/[—–]/g, ' - ')
    .replace(/[ \t]+/g, ' ')
    .replace(/ +([.,;:!?])/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const countWords = (s) => (String(s ?? '').trim() ? String(s).trim().split(/\s+/).length : 0);
const sentence = (s) => {
  const t = sanitize(s);
  if (!t) return '';
  return /[.!?]$/.test(t) ? t : `${t}.`;
};

/**
 * One decision, said out loud.
 *
 * Returns `{text, shape, optionsRead, exampleChoice, read, why}`. `shape` is
 * `options` when the page carries cards, `recommendations` when it carries per-question
 * recommendations instead, and `bare` when it carries neither and only the registry's
 * questions are available.
 */
export function decisionScript(decision, { hub, position = null, total = null } = {}) {
  const art = readArtifact(hub, decision.slug);
  const lines = [];
  const where = position && total ? `Number ${position} of ${total}.` : '';
  const head = `${where} ${decision.handle}.`.trim();
  lines.push(head);

  if (!art.read) {
    lines.push(sentence(`Its page could not be read from this machine, so there is nothing here to tell you about it`
      + ` beyond its name. Nothing has been left out on purpose`));
    const text = sanitize(lines.join(' '));
    return { text, shape: 'unreadable', optionsRead: 0, exampleChoice: 'and your answer', read: false, why: art.why, words: countWords(text) };
  }

  // The title's opening clause is usually the handle again ("branch protections" /
  // "Branch protections: what gets locked down"). Saying both makes the episode stutter
  // on every item, so it is said only when it adds something.
  const lead = String(decision.title ?? '').split(/[:—]/)[0];
  if (lead && similarity(normalizeSpoken(lead).tokens, decision.words ?? []) < 0.85) lines.push(sentence(lead));

  let shape = 'bare';
  let exampleChoice = 'and your answer';

  if (art.options.length) {
    shape = 'options';
    lines.push(`There ${art.options.length === 1 ? 'is one choice' : `are ${art.options.length} choices`}.`);
    for (const o of art.options) {
      const name = o.letter ? `Option ${o.letter}` : o.label;
      const qual = o.qualifier ? `, the ${o.qualifier} one` : '';
      lines.push(`${sentence(`${name}${qual}`)} ${sentence(o.headline ?? '')}`.trim());
    }
    const rec = art.options.find((o) => /recommend/i.test(o.qualifier ?? ''));
    const pick = rec ?? art.options[0];
    if (rec) lines.push(sentence(`The recommendation is option ${rec.letter ?? rec.label}`));
    exampleChoice = pick.letter ? `option ${pick.letter}` : 'the recommended one';
  } else if (art.recommendations.length) {
    shape = 'recommendations';
    lines.push(`This one has no numbered options. It has ${art.recommendations.length === 1
      ? 'one question' : `${art.recommendations.length} questions`}, each with a recommendation.`);
    for (const r of art.recommendations) {
      if (r.question) lines.push(sentence(r.question));
      if (r.recommendation) lines.push(sentence(r.recommendation.replace(/^Recommend(ed|ation)\s*:?\s*/i, 'The recommendation is ')));
    }
    exampleChoice = 'go with the recommendation';
  } else if ((decision.questions ?? []).length) {
    lines.push(`It asks ${decision.questions.length === 1 ? 'one question' : `${decision.questions.length} questions`}.`);
    for (const q of decision.questions) lines.push(sentence(q.question));
    exampleChoice = 'and your answer';
  } else {
    lines.push('Its page carries no options and no questions this can read out, so it needs a look at a screen.');
  }

  const text = sanitize(lines.join(' '));
  return { text, shape, optionsRead: art.options.length, exampleChoice, read: true, why: '', words: countWords(text) };
}

/**
 * ONE decision as its own episode, ending with exactly what to say (#280).
 *
 * `queueScript` reads the whole queue out in one sitting, which is a queue read-out; an
 * episode is per artifact, which is what #280 asks for and what the three published on
 * 2026-08-18 were. The two share this module deliberately, because #265's vocabulary rule
 * is that whatever the scripts tell him to say IS the vocabulary — a second generator with
 * its own idea of the words is the two-sources-of-truth defect that cost ten decisions
 * their state.
 *
 * TAKE THE WHOLE QUEUE, RENDER ONE OF IT. The handle, the ordinal and the collision
 * warning are only meaningful against the full open set, and the caller must not persist a
 * snapshot that says the queue is one item long — an ordinal spoken in an earlier episode
 * would then resolve against a list that never existed.
 *
 * `selector` matches a decision id, its slug, its handle, or its position.
 */
export function soloScript(queue, selector, { hub } = {}) {
  if (!queue?.read) {
    const text = sanitize('The list of open decisions could not be read on the machine that made this, '
      + 'so this episode cannot tell you what is waiting. That is a failure to read, not an empty queue.');
    return { text, close: '', item: null, words: countWords(text), minutes: 0, overRuns: false, read: false, why: queue?.why ?? '' };
  }
  const want = String(selector ?? '').trim().toLowerCase();
  const d = (queue.decisions ?? []).find((x) => [String(x.id).toLowerCase(), String(x.slug).toLowerCase(),
    String(x.handle).toLowerCase(), String(x.ordinal)].includes(want));
  if (!d) {
    return {
      text: '', close: '', item: null, words: 0, minutes: 0, overRuns: false, read: true,
      why: `no open decision answers to "${selector}" — the open ones are: `
        + `${(queue.decisions ?? []).map((x) => `${x.ordinal}. ${x.handle} (${x.id})`).join(', ') || 'none'}`,
    };
  }

  const s = decisionScript(d, { hub });
  const closeLines = ['To answer, say the name and then your choice.'];
  const example = `${d.handle}, ${s.exampleChoice}`;
  closeLines.push(`For example: ${example}.`);
  if ((d.collidesWith ?? []).length) {
    closeLines.push(`Another decision waiting on you sounds like this one, so say number ${d.ordinal} `
      + 'instead of the name.');
  }
  closeLines.push('Once more, slowly.');
  closeLines.push(`${sentence(d.handle)} Then your choice.`);
  closeLines.push('Say it once. If nothing here matched what you said, it is kept exactly as you said it '
    + 'and it stays on the list, so you will see it did not land.');
  const close = sanitize(closeLines.join(' '));

  const text = sanitize([s.text, close].join('\n\n'));
  const words = countWords(text);
  const minutes = minutesFor(words);
  return {
    text,
    close,
    item: { id: d.id, handle: d.handle, ordinal: d.ordinal, shape: s.shape, example, collidesWith: d.collidesWith ?? [] },
    words,
    minutes,
    overRuns: minutes > TARGET_MINUTES,
    read: s.read,
    why: s.why,
  };
}

/**
 * The whole open queue as one narration, ending with exactly what to say.
 *
 * The close is the part that matters most and is the last thing he hears, because it
 * is the only instruction he has to hold in his head between the car speaker and the
 * microphone.
 */
export function queueScript(queue, { hub } = {}) {
  const decisions = queue?.decisions ?? [];
  const parts = [];
  const items = [];

  if (!queue?.read) {
    const text = sanitize('The list of open decisions could not be read on the machine that made this, '
      + 'so this episode cannot tell you what is waiting. That is a failure to read, not an empty queue.');
    return { text, items: [], close: '', words: countWords(text), minutes: 0, overRuns: false, read: false };
  }

  if (!decisions.length) {
    const text = sanitize('There are no open decisions. Nothing is waiting on you.');
    return { text, items: [], close: '', words: countWords(text), minutes: minutesFor(countWords(text)), overRuns: false, read: true };
  }

  parts.push(sanitize(`${decisions.length === 1 ? 'One decision is' : `${decisions.length} decisions are`} `
    + 'waiting on you. Here they are, then how to answer without a screen.'));

  for (const d of decisions) {
    const s = decisionScript(d, { hub, position: d.ordinal, total: decisions.length });
    parts.push(s.text);
    items.push({
      id: d.id,
      handle: d.handle,
      ordinal: d.ordinal,
      shape: s.shape,
      exampleChoice: s.exampleChoice,
      example: `${d.handle}, ${s.exampleChoice}`,
      collidesWith: d.collidesWith ?? [],
    });
  }

  const colliding = items.filter((i) => i.collidesWith.length);
  const closeLines = [];
  closeLines.push('To answer, say the name and then your choice.');
  closeLines.push(`For example: ${items[0].example}.`);
  if (items.length > 1) {
    closeLines.push(`The names are: ${items.map((i) => i.handle).join('; ')}.`);
    closeLines.push('You can say a position instead of a name - '
      + `for example, number ${items[0].ordinal}, ${items[0].exampleChoice}.`);
  }
  if (colliding.length) {
    closeLines.push(`Two of these names sound alike, so for ${colliding.map((i) => i.handle).join(' and ')} `
      + 'say the number instead of the name.');
  }
  closeLines.push('Say it once, slowly. If nothing here matched what you said, it is kept exactly as you said it '
    + 'and it stays on the list, so you will see it did not land.');
  const close = sanitize(closeLines.join(' '));
  parts.push(close);

  const text = sanitize(parts.join('\n\n'));
  const words = countWords(text);
  const minutes = minutesFor(words);
  return { text, items, close, words, minutes, overRuns: minutes > TARGET_MINUTES, read: true };
}
