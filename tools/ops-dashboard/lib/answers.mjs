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
  const all = readAnswers(workspace);
  // Refuse rather than write a record that cannot supersede its predecessors: with an
  // unreadable store every answer looks like the first one, which is #120 all over
  // again by a different route (jwildfire/obot.agent#215).
  if (all[UNREADABLE]) throw new Error(`${all[UNREADABLE]}, so this answer will not be recorded — it could not be told what it replaces`);
  const existing = all.filter((a) => a.artifact === artifact && a.status !== SUPERSEDED);
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

// And the third state, since jwildfire/obot.agent#215: a store that exists and could
// not be listed. It also arrives as an empty array, so the panel keeps working — but
// `recordAnswer` has to refuse, because writing against an empty read is how the #120
// supersede logic silently stops working and every click writes a fresh record.
export const UNREADABLE = Symbol.for('obot.answers.unreadable');
const unreadable = (why) => Object.defineProperty([], UNREADABLE, { value: why });

/** Every answer ever recorded, newest first. Nothing is ever removed. */
export function readAnswers(workspace, { hub = null } = {}) {
  let names = [];
  try { names = fs.readdirSync(answersDir(workspace)).filter((n) => n.endsWith('.json')); } catch (e) {
    return e?.code === 'ENOENT' ? storeless() : unreadable(`the answer store could not be read (${e?.code ?? e?.message})`);
  }
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

/**
 * The record one identifier names — including the id `pending` actually printed.
 *
 * `pending` leads every row with `D0014`; `apply` matched on the record key alone
 * (`2026-08-16T21-39-17-310Z-2026-08-15-scheduled-sessions-readiness`), which appears
 * nowhere in that output and is reachable only through `--json`. So the documented
 * next step answered the displayed id with `no answer D0014`, which reads as "he never
 * decided that" rather than "you typed the wrong one of my two names for it". His
 * D0014 answer sat OVERDUE for 26 hours behind that error, with the work already done
 * (obot.agent#180).
 *
 * An OVERDUE flag that cannot be cleared by the documented next step is worse than no
 * flag: it is seen, attempted, failed, and then ignored — and the next real one is
 * ignored with it.
 *
 * Three names resolve, because all three are printed somewhere: the record id, the
 * decision id, and the artifact slug. Unapplied answers are preferred over applied
 * ones — clearing a pending flag is what the command is for — and where more than one
 * survives that, the candidates are returned rather than the answer being denied.
 */
export function resolveAnswerRef(workspace, ref, { hub = null } = {}) {
  const key = String(ref ?? '').trim();
  if (!key) return { record: null, candidates: [], reason: 'no identifier given' };

  // A record id names one file and resolves against every record ever written,
  // including one a later answer shadowed — that is what `--json` and `show` hand
  // out, and an id this tool printed must always resolve to the thing it printed.
  const all = readAnswers(workspace, { hub });
  const exact = all.find((a) => a.id === key);
  if (exact) return { record: exact, candidates: [] };

  const same = (v) => String(v ?? '').toLowerCase() === key.toLowerCase();
  // A NAME resolves against exactly the list `pending` prints from, and for the
  // reason this whole function exists: anything that list displays has to be
  // appliable. Matching against every record instead re-creates the defect one
  // layer down — the six pre-#120 records include two for the same artifact that
  // nothing ever marked superseded, so `apply D0008` would answer "that names 2
  // answers" about an id `pending` shows exactly once.
  const current = currentAnswers(workspace, { hub });
  const named = current.filter((a) => same(a.decisionId) || same(a.artifact));
  if (!named.length) {
    const shadowed = all.filter((a) => same(a.decisionId) || same(a.artifact));
    return {
      record: null,
      candidates: shadowed,
      reason: shadowed.length
        ? `every answer under "${key}" has been superseded — he answered again, and the current answer is the one to apply`
        : `nothing recorded under "${key}" — it is not a record id, a decision id, or an artifact slug in this store`,
    };
  }

  const open = named.filter((a) => a.status !== APPLIED);
  const pick = open.length ? open : named;
  if (pick.length === 1) return { record: pick[0], candidates: [], alreadyApplied: !open.length };
  return {
    record: null,
    candidates: pick,
    reason: `"${key}" names ${pick.length} answers, so it does not say which one to apply — name one by its record id`,
  };
}

export function transition(workspace, ref, status, meta = {}, now = new Date(), patch = null) {
  // Resolved by any name it is printed under, then re-read raw: the resolver reads
  // with the hub, which backfills a missing decision id onto its copy, and writing
  // that copy back would smuggle a repair into every apply. `markDelivered` still
  // carries repairs explicitly, through `patch`.
  const { hub = null, ...event } = meta;
  const found = resolveAnswerRef(workspace, ref, { hub });
  if (!found.record) {
    const list = found.candidates.map((a) => `  ${a.id}  ${a.decisionId ?? a.artifact ?? ''}  [${a.status}]`).join('\n');
    throw new Error(`${found.reason}${list ? `\ncandidates:\n${list}` : ''}`);
  }
  const record = readAnswers(workspace).find((a) => a.id === found.record.id);
  if (!record) throw new Error(`no answer ${found.record.id}`);
  const at = now.toISOString();
  // `patch` carries repairs (a backfilled decision id), never content: the
  // verdict, the words and the per-question calls are written once.
  if (patch?.decisionId) Object.assign(record, { ...patch, decisionIdSource: 'registry (backfilled)' });
  record.status = status;
  // `hub` is how the record was found, not something that happened to it, so it
  // stays out of the history line.
  record.history = [...record.history, { at, status, ...event }];
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
 * The two ways an answer of his goes unapplied, told apart — jwildfire/obot.roadmap#241.
 *
 * THE 16 AUGUST FAILURE WAS NOT A DETECTION FAILURE. He answered three decisions at
 * 21:34, 21:37 and 21:39Z; the sweep announced all three inside six minutes and then
 * re-computed `3 answers pending` 105 consecutive times over nine hours. Every one of
 * those readings was correct and none of them reached anybody who could act, because
 * the only thing carrying them was a file. This is that same finding, in the shape the
 * one channel that reaches an actor already accepts.
 *
 * TWO CONDITIONS, BECAUSE THEY HAVE DIFFERENT REMEDIES. The overdue clock used to
 * measure from his click alone, which cannot separate "nobody ever picked this up"
 * from "somebody picked it up and dropped it":
 *
 *   captured  past the bar from his click        the DELIVERER is the suspect —
 *                                                the sweep never announced it at all
 *   delivered past the bar from the ANNOUNCEMENT an AGENT is the suspect — it was
 *                                                told, and the artifact never changed
 *
 * The 16 August incident is the second, three times over, and the first clock reads
 * them identically. Measuring `dropped` from `deliveredAt` also stops an answer that
 * was announced thirty seconds ago from being called dropped merely because he clicked
 * a long time before anything was listening.
 *
 * NEVER HIS WORDS. Same rule as `deliverAnswers`, for a sharper reason here: these
 * lines are appended to the wake log and read out in a session, and what a session
 * reads can end up in a scratchpad and then in a published wrapup. The decision id,
 * the verdict and the clock are everything an agent needs; his prose belongs in the
 * artifact he is deciding.
 */
export function unappliedDetections(pending = [], { now = new Date() } = {}) {
  const out = [];
  for (const a of pending) {
    if (a.status === APPLIED || a.status === SUPERSEDED) continue;
    const name = a.decisionId ?? a.artifact ?? a.id;
    const dropped = a.status === DELIVERED && a.deliveredAt;
    // The clock each condition is actually about. For `dropped` that is the moment
    // the fleet was told, not the moment he clicked.
    const since = dropped ? a.deliveredAt : a.at;
    const min = ageMin(since, now);
    if (min <= OVERDUE_MIN) continue;
    const clicked = ago(ageMin(a.at, now));
    out.push({
      kind: 'unapplied',
      key: `unapplied:${name}`,
      condition: dropped ? 'dropped' : 'unclaimed',
      // The record id, so a surface rendering one row per answer can match a
      // detection to its row without re-deriving which of the three printed names
      // this one is going by (obot.agent#180).
      id: a.id,
      name,
      // No worker owns this, so the decision names itself. `job <id>` is what the
      // scratchpad would otherwise print, which is the least actionable thing a
      // wake can say.
      worker: name,
      artifact: a.artifact ?? null,
      at: since,
      minutes: min,
      line: dropped
        ? `${name} ${a.verdict} — he answered it ${clicked} ago and the artifact has not changed. `
          + `It was announced to the fleet ${ago(min)} ago, so an agent was told and dropped it — `
          + `apply it, then obot.agent/tools/ops-answers apply ${name} --evidence <url> --by <your id>`
        : `${name} ${a.verdict} — he answered it ${clicked} ago and nothing has picked it up. `
          + `The sweep never announced it, so the deliverer is the suspect rather than an agent — `
          + `read it with obot.agent/tools/ops-answers pending`,
      // The queue row's version of the same fact, in the second person, because that
      // one is rendered on his own page rather than read out to the Navigator.
      claim: {
        label: 'answered, not applied',
        detail: dropped
          ? `you decided this ${clicked} ago and the artifact still has not changed`
          : `you decided this ${clicked} ago and nothing has picked it up yet`,
      },
    });
  }
  return out.sort((x, y) => y.minutes - x.minutes);
}

/**
 * The critical-pin claim on a queue row — `rank.mjs` route 2, filled for the first time.
 *
 * That seam has existed since the tag was built and its own header names this exact
 * case ("the answer pipeline's OVERDUE … a clock decides it, so it cannot be talked
 * up"). Nothing has ever written to it, which is why the one page he reads stayed
 * silent about his own unapplied answer for nine hours.
 *
 * Attached here rather than in `collectDecisions` so the hub collector keeps knowing
 * nothing about the local answer store, and so this stays a pure function over two
 * lists that a test can seed both halves of.
 */
export function attachUnapplied(items = [], pending = [], { now = new Date() } = {}) {
  const claims = new Map();
  for (const d of unappliedDetections(pending, { now })) {
    if (d.artifact) claims.set(d.artifact, d.claim);
  }
  if (!claims.size) return items;
  return items.map((i) => {
    const c = i?.artifact ? claims.get(i.artifact) : null;
    return c ? { ...i, computed: c } : i;
  });
}

/**
 * The Navigator's answers section. Rendered into `navigator-state.md`, which
 * means it also appears on the dashboard's Navigator tab for free (that tab
 * renders every `##` section, including ones it has never heard of).
 *
 * THE VERDICT LINE IS NOT DECORATION. Until #241 this section was a heading and a
 * list of bullets, each overdue row led with `**OVERDUE**`, and neither could ever
 * render as an alarm on that tab — for two independent reasons, both of which had to
 * be fixed and only one of which is obvious:
 *
 *   1. `OVERDUE` is not in `ALARM_RE`'s vocabulary (GAP FINDING BREACHED FAILED DOWN
 *      BROKEN), so the headline was ordinary text by the sweep's own rules;
 *   2. and it would not have mattered if it were, because `parseNavigatorState`
 *      alarm-tests preamble notes and unindented plain lines and NOTHING ELSE. A
 *      `- ` bullet goes down a branch that never assigns `alarm` at all, and
 *      `parseItem` strips `*`, so `**OVERDUE**` arrived on the page as the grey word
 *      OVERDUE in the middle of a grey row.
 *
 * So the verdict is an unindented line under the heading — the same shape as the
 * config, worker and landing ledger lines it sits beside: a headline that is the
 * whole answer, then the rows under it. The clean case gets one too, because a
 * section that says nothing when it is happy and nothing when it is broken is a
 * section nobody can read.
 */
export function answersSection(pending, { now = new Date() } = {}) {
  const lines = ['## Decision answers — recorded by @jwildfire, awaiting an agent', ''];
  if (!pending.length) {
    lines.push(pending[STORELESS]
      ? 'answers: no store on this machine yet — nothing has been recorded, so nothing can be pending. It appears the first time you answer a decision on the dashboard.'
      : 'answers: none pending — every answer he has recorded has been applied');
    return `${lines.join('\n')}\n`;
  }

  const late = unappliedDetections(pending, { now });
  if (late.length) {
    const dropped = late.filter((d) => d.condition === 'dropped').length;
    const unclaimed = late.length - dropped;
    const parts = [];
    if (dropped) parts.push(`${dropped} announced to the fleet and dropped`);
    if (unclaimed) parts.push(`${unclaimed} never picked up`);
    // `ANSWER DELIVERY GAP` is in ALARM_RE's vocabulary on purpose and the tests
    // assert it against the imported regex, never a copy of it (obot.agent#223).
    lines.push(`answers: **ANSWER DELIVERY GAP** — ${late.length} answer(s) of his recorded and unapplied `
      + `past the ${OVERDUE_MIN}m bar, oldest ${ago(late[0].minutes)} (${parts.join(', ')}). `
      + 'An answer he clicked that nothing applies is a decision he has to make twice.');
    for (const d of late) lines.push(`  ${d.line}`);
  } else {
    lines.push(`answers: ${pending.length} in flight, none past the ${OVERDUE_MIN}m bar — recorded and on their way, not dropped`);
  }
  lines.push('');

  for (const a of pending) {
    const min = ageMin(a.at, now);
    const overdue = min > OVERDUE_MIN ? '**OVERDUE** ' : '';
    lines.push(`- ${overdue}**${a.decisionId ?? a.artifact}** ${a.verdict} · ${a.status} · recorded ${(a.at || '').slice(0, 16).replace('T', ' ')} (${ago(min)} ago) · \`${a.artifact ?? ''}\``);
  }
  lines.push('', 'Read them: `obot.agent/tools/ops-answers pending` · apply, then `ops-answers apply <id> --evidence <url>`.');
  return `${lines.join('\n')}\n`;
}

export { ageMin, ago };
