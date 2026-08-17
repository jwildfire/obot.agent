// The decision lane: what happens between his click and the artifact (#120).
//
// The evening of 2026-08-15 is the specification. @jwildfire answered a decision
// in the dashboard at 22:22, then asked twice whether it had landed. It had not.
// Three files existed for that one decision, 19 seconds apart, each carrying
// `decisionId: null` and `status: "staged"` — a state with no consumer. He
// noticed the failure before any part of the system did.
//
// Three things were wrong and this module owns all three:
//
//   1. **Every click appended a file.** An identical re-click is now the same
//      answer (`clicks` counts them); a *different* answer writes a new record
//      that names what it supersedes, and the superseded record is stamped, not
//      deleted — a changed mind is a fact worth keeping, and which answer is his
//      *now* has to be readable from the data rather than inferred from mtimes.
//   2. **The ids were never joined.** The store knows the artifact slug; the
//      hub's `reports/decisions/registry.json` maps that slug to `D0003` and
//      carries the sub-ids (`D0003.1`, code `S1`, and the question text). The
//      join happens here, at capture time, and a lookup that fails is recorded
//      as a failure instead of a silent null.
//   3. **Nothing watched `staged`.** The vocabulary is now three states that say
//      who has it: `captured` (on disk, nobody has seen it), `delivered` (the
//      Navigator sweep announced it — see tools/navigator/sweep.mjs), `applied`
//      (an agent updated the artifact and left evidence). Plus `superseded` for
//      an answer he replaced. "Did it land?" is answerable from the store alone.
//
// The content of an answer — his verdict, his words, his per-question calls — is
// written once and never edited. Only status, history and supersede pointers
// move, which is what keeps the ledger trustworthy when an agent applies badly.
//
// Everything here is local-only, like the rest of `.claude/ops/`: never
// committed, never published.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { ensureStore, opsDir, SENTINEL } from './store.mjs';

export const CAPTURED = 'captured';
export const DELIVERED = 'delivered';
export const APPLIED = 'applied';
export const SUPERSEDED = 'superseded';

/**
 * How long an unapplied answer may sit before the deliverer escalates it.
 *
 * An hour, not five minutes: the sweep hands off within five, but the agent that
 * updates the artifact is a session, and sessions are not always running. An
 * answer older than this is no longer "in flight" — it is evidence that nothing
 * picked it up, and it says so in the Navigator's state file and on the page.
 */
export const OVERDUE_MIN = 60;

const answersDir = (workspace) => path.join(opsDir(workspace), 'answers');

/** The registry entry for an artifact: its `D####` id and its sub-questions. */
export function resolveDecision(hub, slug) {
  const file = path.join(hub ?? '', 'reports', 'decisions', 'registry.json');
  let reg;
  try {
    reg = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return { id: null, questions: [], error: `no readable decision registry at ${file} (${e.code ?? e.message})` };
  }
  const a = (reg.artifacts ?? []).find((x) => x?.slug === slug);
  if (!a) return { id: null, questions: [], error: `"${slug}" is not in the hub decision registry` };
  return { id: a.id ?? null, questions: a.questions ?? [], title: a.title ?? null };
}

/**
 * Per-question answers, keyed by sub-id and carrying the code he reads.
 *
 * The 22:21:57 record had `verdict: "per-question"` and `questions: {}` — the
 * whole point of that verdict is which question got which answer, so an empty
 * one is silent data loss. A key the decision does not have is kept *and*
 * flagged: dropping it would repeat the same loss more quietly.
 */
function normalizeQuestions(input, registryQuestions) {
  const byId = new Map((registryQuestions ?? []).map((q) => [q.id, q]));
  const questions = {};
  const unknown = [];
  for (const [id, value] of Object.entries(input ?? {})) {
    const verdict = typeof value === 'string' ? value : value?.verdict ?? null;
    if (!verdict) continue;
    const q = byId.get(id);
    if (!q && byId.size) unknown.push(id);
    questions[id] = { verdict, code: q?.code ?? null };
  }
  return { questions, unknown };
}

const fingerprint = (o) => crypto.createHash('sha256')
  .update(JSON.stringify({ artifact: o.artifact, verdict: o.verdict, words: o.words, questions: o.questions }))
  .digest('hex').slice(0, 16);

const writeRecord = (workspace, record) => {
  fs.writeFileSync(path.join(answersDir(workspace), `${record.id}.json`), `${JSON.stringify(record, null, 2)}\n`);
  return record;
};

/**
 * Record an answer.
 *
 * Returns `{record, duplicate, superseded}`. `duplicate` is the double-click
 * case: same artifact, same verdict, same words, same per-question calls — one
 * decision, clicked three times, not three answers.
 */
export function recordAnswer(workspace, answer, { hub = null, now = new Date() } = {}) {
  const dir = path.join(ensureStore(workspace), 'answers');
  const artifact = answer.artifact ?? null;
  const words = (answer.words ?? '').trim();

  const decision = hub ? resolveDecision(hub, artifact) : { id: null, questions: [], error: 'no hub clone given' };
  const { questions, unknown } = normalizeQuestions(answer.questions, decision.questions);
  const answered = Object.keys(questions).length;

  // A verdict he never picked must not be invented. He typed words and clicked
  // record: that is an answer in prose, and calling it "per-question" (as the
  // page did on 2026-08-15) mislabels the one record that held his reasoning.
  const verdict = answer.verdict || (answered ? 'per-question' : (words ? 'words-only' : null));

  if (!verdict && !words && !answered) throw new Error('empty answer: no verdict, no words, no questions');
  if (verdict === 'per-question' && !answered) {
    throw new Error('a per-question answer must say which question got which verdict');
  }

  const content = { artifact, verdict, words, questions };
  const fp = fingerprint(content);
  // Every live record for this artifact, not just the current one: records
  // written before #120 were never marked, and each of them has to be told
  // explicitly that it has been replaced.
  const existing = readAnswers(workspace).filter((a) => a.artifact === artifact && a.status !== SUPERSEDED);
  const twin = existing.find((a) => a.fingerprint === fp);
  if (twin) {
    // The same answer again. Count the click so the repeat is legible, and leave
    // everything else alone — including its place in the pipeline.
    twin.clicks = (twin.clicks ?? 1) + 1;
    twin.history = [...(twin.history ?? []), { at: now.toISOString(), status: twin.status, note: 'clicked again' }];
    writeRecord(workspace, twin);
    return { record: twin, duplicate: true, superseded: [] };
  }

  const at = now.toISOString();
  const base = `${at.replace(/[:.]/g, '-')}-${(artifact || 'unknown').slice(0, 40)}`;
  let id = base;
  for (let n = 2; fs.existsSync(path.join(dir, `${id}.json`)); n++) id = `${base}-${n}`;

  // Everything the artifact currently has an answer for is replaced — but an
  // answer that already reached the artifact is not rewritten. That case (he
  // changed his mind after it landed) is flagged instead, because the agent has
  // to *update* the artifact rather than write a first Decisions entry.
  const superseded = [];
  let afterApplied = false;
  for (const prev of existing) {
    if (prev.status === APPLIED) { afterApplied = true; superseded.push(prev.id); continue; }
    prev.status = SUPERSEDED;
    prev.supersededBy = id;
    prev.history = [...(prev.history ?? []), { at, status: SUPERSEDED, note: `replaced by ${id}` }];
    writeRecord(workspace, prev);
    superseded.push(prev.id);
  }

  const record = writeRecord(workspace, {
    _note: SENTINEL,
    id,
    at,
    status: CAPTURED,
    artifact,
    decisionId: decision.id ?? null,
    decisionIdSource: decision.id ? 'registry' : 'none',
    decisionIdError: decision.id ? null : (decision.error ?? 'no id found'),
    verdict,
    questions,
    unknownQuestions: unknown,
    words,
    clicks: 1,
    fingerprint: fp,
    supersedes: superseded,
    supersededBy: null,
    afterApplied,
    deliveredAt: null,
    appliedAt: null,
    appliedBy: null,
    evidence: null,
    history: [{ at, status: CAPTURED, by: answer.by ?? 'dashboard' }],
  });
  return { record, duplicate: false, superseded };
}

/** Records written before #120 called this state `staged`, and nothing watched it. */
const normalize = (r) => ({
  clicks: 1, supersedes: [], supersededBy: null, history: [], questions: {}, unknownQuestions: [],
  ...r,
  status: r.status === 'staged' || !r.status ? CAPTURED : r.status,
});

/**
 * The id an answer should carry, for records written before the join existed.
 *
 * The slug was always on the record and the registry has always mapped it, so a
 * `decisionId: null` on an old record is a missing lookup rather than missing
 * information. Reading with a hub clone fills it in; nothing is written here,
 * because a read that edits its own source is not a read.
 */
const backfill = (r, hub) => {
  if (!hub || r.decisionId || !r.artifact) return r;
  const d = resolveDecision(hub, r.artifact);
  if (!d.id) return { ...r, decisionIdError: r.decisionIdError ?? d.error };
  return { ...r, decisionId: d.id, decisionIdSource: 'registry (backfilled on read)', decisionIdError: null };
};

// An answer list from a store that does not exist. Marked on the array itself so
// every existing caller keeps treating it as the empty list it is, while the one
// caller that renders a verdict about it can tell the difference
// (jwildfire/obot.roadmap#223).
export const STORELESS = Symbol.for('obot.answers.storeless');
const storeless = () => Object.defineProperty([], STORELESS, { value: true });

/** Every answer ever recorded, newest first. Nothing is ever removed. */
export function readAnswers(workspace, { hub = null } = {}) {
  let names = [];
  try { names = fs.readdirSync(answersDir(workspace)).filter((n) => n.endsWith('.json')); } catch { return storeless(); }
  return names
    .map((n) => { try { return backfill(normalize(JSON.parse(fs.readFileSync(path.join(answersDir(workspace), n), 'utf8'))), hub); } catch { return null; } })
    .filter(Boolean)
    .sort((a, b) => (b.at || '').localeCompare(a.at || ''));
}

/**
 * His answer as it stands: one per artifact, newest, superseded ones dropped.
 *
 * The supersede marks written at capture time are the authority. The grouping
 * below only catches records written before #120 existed, where nothing marked
 * anything — for those, newest-wins is the best available reading and the
 * returned objects carry a `supersededBy` so a reader still sees which is which.
 */
export function currentAnswers(workspace, { hub = null } = {}) {
  const all = readAnswers(workspace, { hub });
  const live = all.filter((a) => a.status !== SUPERSEDED);
  const byArtifact = new Map();
  for (const a of live) {
    const key = a.artifact ?? a.id;
    if (!byArtifact.has(key)) byArtifact.set(key, a);
    else {
      const current = byArtifact.get(key);
      if (!a.supersedes.includes(current.id)) a.supersededBy = current.id; // legacy: newest already won
    }
  }
  const out = [...byArtifact.values()];
  // `filter` and the Map rebuild both drop the marker, and this is the list the
  // dashboard's answers panel counts — an absent store rendered as "Your answers 0"
  // (jwildfire/obot.roadmap#223).
  return all[STORELESS] ? Object.defineProperty(out, STORELESS, { value: true }) : out;
}

/** Has this machine ever had an answer store? Absent is not the same as empty. */
export const answersStoreExists = (workspace) => fs.existsSync(answersDir(workspace));

/** What he has decided that no agent has applied. The bounded read. */
export function pendingAnswers(workspace, { hub = null } = {}) {
  const out = currentAnswers(workspace, { hub }).filter((a) => a.status !== APPLIED);
  return answersStoreExists(workspace) ? out : Object.defineProperty(out, STORELESS, { value: true });
}

const ageMin = (at, now = new Date()) => Math.max(0, Math.round((now.getTime() - Date.parse(at)) / 60000));
const ago = (min) => (min < 60 ? `${min}m` : `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`);

export function transition(workspace, id, status, meta = {}, now = new Date(), patch = null) {
  const record = readAnswers(workspace).find((a) => a.id === id);
  if (!record) throw new Error(`no answer ${id}`);
  const at = now.toISOString();
  // `patch` carries repairs (a backfilled decision id), never content: the
  // verdict, the words and the per-question calls are written once.
  if (patch?.decisionId) Object.assign(record, { ...patch, decisionIdSource: 'registry (backfilled)' });
  record.status = status;
  record.history = [...record.history, { at, status, ...meta }];
  if (status === DELIVERED) record.deliveredAt = at;
  if (status === APPLIED) {
    record.appliedAt = at;
    record.appliedBy = meta.by ?? null;
    record.evidence = meta.evidence ?? null;
  }
  return writeRecord(workspace, record);
}

export const markDelivered = (workspace, id, meta = {}, now = new Date(), patch = null) =>
  transition(workspace, id, DELIVERED, { by: 'navigator', ...meta }, now, patch);
export const markApplied = (workspace, id, meta = {}) => transition(workspace, id, APPLIED, meta);

/**
 * The hand-off. Called by the Navigator sweep — launchd, every five minutes,
 * session-independent — so an answer stops depending on someone happening to
 * look. Captured answers become `delivered` and each one yields an event line
 * the sweep writes into `navigator-state.md` and the session scratchpad.
 *
 * The line names the decision and the verdict, never his prose: these lines flow
 * into surfaces (the scratchpad, a wrapup) that can end up published, and the
 * verbatim words belong in the artifact he is deciding, not in a log entry.
 */
export function deliverAnswers(workspace, { hub = null, now = new Date() } = {}) {
  const fresh = pendingAnswers(workspace, { hub }).filter((a) => a.status === CAPTURED);
  const delivered = [];
  const events = [];
  for (const a of fresh) {
    // The deliverer writes anyway, so it is where a backfilled id is made
    // permanent — the next reader should not have to repeat the lookup.
    delivered.push(markDelivered(workspace, a.id, { note: 'announced in navigator-state' }, now, {
      decisionId: a.decisionId, decisionIdSource: a.decisionIdSource, decisionIdError: a.decisionIdError,
    }));
    events.push({
      type: 'answer-new',
      line: `ANSWER ${a.decisionId ?? a.artifact ?? a.id} ${a.verdict} — recorded ${(a.at || '').slice(11, 16)}, awaiting an agent`,
    });
  }
  return { delivered, events };
}

/**
 * The Navigator's answers section. Rendered into `navigator-state.md`, which
 * means it also appears on the dashboard's Navigator tab for free (that tab
 * renders every `##` section, including ones it has never heard of).
 */
export function answersSection(pending, { now = new Date() } = {}) {
  const lines = ['## Decision answers — recorded by @jwildfire, awaiting an agent', ''];
  if (!pending.length) {
    lines.push(pending[STORELESS]
      ? '- no answer store on this machine yet — nothing has been recorded, so nothing can be pending. It appears the first time you answer a decision on the dashboard.'
      : '- none — every answer he has recorded has been applied');
    return `${lines.join('\n')}\n`;
  }
  for (const a of pending) {
    const min = ageMin(a.at, now);
    const overdue = min > OVERDUE_MIN ? '**OVERDUE** ' : '';
    lines.push(`- ${overdue}**${a.decisionId ?? a.artifact}** ${a.verdict} · ${a.status} · recorded ${(a.at || '').slice(0, 16).replace('T', ' ')} (${ago(min)} ago) · \`${a.artifact ?? ''}\``);
  }
  lines.push('', 'Read them: `node obot.agent/tools/ops-answers pending` · apply, then `ops-answers apply <id> --evidence <url>`.');
  return `${lines.join('\n')}\n`;
}

export { ageMin, ago };
