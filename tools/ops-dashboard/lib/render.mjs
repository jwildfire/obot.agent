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
import { wakeText, DISMISS_MEANS } from './triage.mjs';
import { CRITICAL_BUDGET } from './rank.mjs';
import { parseNavigatorState } from './navigator.mjs';
import { metricsHtml, feedHtml, METRICS_CSS } from './metrics-view.mjs';
import { wireHtml, WIRE_CSS } from './wire-view.mjs';
import { phrase } from './last-seen.mjs';
import { esc } from './esc.mjs';
import { RANK_REL } from '../../navigator/rank.mjs';
import { rosterHtml, ROSTER_CSS, emptyRoster } from './roster-view.mjs';
import { agentsTableHtml, TABLE_CSS } from './roster-table.mjs';
import { UNMEASURED, nothingYet } from './absent.mjs';
import { STORELESS, unappliedDetections } from './answers.mjs';
import { deliveryTablesHtml, LOG_CSS } from './log-view.mjs';
import { OBOT_CSS } from '../../../assets/obot-css.mjs';

/**
 * The long form of the header's last-look phrase, for the tooltip.
 *
 * Degradation is the point of this line, so each state says what it knows and
 * stops: "first look" is not "nothing changed", and "unknown" gives the reason
 * rather than a plausible-looking window (jwildfire/obot.roadmap#205).
 */
export { deliveredPanel };

export function lastLookTitle(v) {
  if (!v || v.state === 'unknown') {
    return `When you last opened this page is unknown${v?.why ? ` — ${v.why}` : ''}. Nothing is being guessed in its place.`;
  }
  if (v.state === 'first') {
    return v.storeMissing
      ? 'Nothing on this machine records you opening this page before — the visit record is local and does not travel between machines. The record starts with this visit.'
      : 'No record of you opening this page before. This is the first look.';
  }
  return `You last opened this page at ${new Date(v.at).toLocaleString()}. Recorded locally, never published.`;
}

export { esc };

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
//
// THE SHARED SPINE (jwildfire/obot.roadmap#203). The first four are the same four
// entities, in the same order, as the public hub's roadmap sub-nav — Queue, Wire,
// Agents, Catalog — so a reader who knows one surface can navigate the other
// without being told. They answer the three questions every surface built for his
// absence has to answer, and then point at the record:
//
//   Queue    what needs you        this page       hub: roadmap.html
//   Wire     what changed          /wire.html      hub: wire.html
//   Agents   what is running       /live.html      hub: the NOW strip, counts only
//   Catalog  the record            the hub itself  hub: catalog.html
//
// The depth differs by surface and that is the design, not a gap. Where a surface
// renders an entity as a summary or a pointer rather than a page, it still carries
// the entry — a bucket that silently vanished from one surface would leave a reader
// comparing them unable to tell "none" from "not shown", which are opposite facts.
// Catalog is that case here: this dashboard does not duplicate the record, it
// points at the one on the hub, and says so.
//
// `spine: true` marks them, and everything after the divider is this surface's own.
// A local-only tab must never come between two spine entries, or the order stops
// carrying meaning across the two surfaces.
export const TABS = [
  { id: 'ops', href: '/', label: 'Queue', spine: true },
  { id: 'wire', href: '/wire.html', label: 'Wire', spine: true },
  { id: 'session', href: '/live.html', label: 'Agents', spine: true },
  { id: 'catalog', href: 'https://jwildfire.github.io/obot.roadmap/catalog.html', label: 'Catalog', spine: true, away: true },
  { id: 'navigator', href: '/navigator', label: 'Navigator' },
];

/** The spine, in order — asserted against the hub's own list, which must match. */
export const SPINE = TABS.filter((t) => t.spine).map((t) => t.label);

export const tabs = (active) => `<nav class="tabs" aria-label="Views">
  ${TABS.map((t, i) => {
    const away = t.away ? ' target="_blank" rel="noopener" class="away" title="On the public hub — this surface does not duplicate the record"' : '';
    const link = `<a href="${t.href}"${t.id === active ? ' aria-current="page"' : ''}${away}>${t.label}${t.away ? '<span class="away-mark" aria-hidden="true">↗</span>' : ''}</a>`;
    // The divider marks where the shared spine ends and this surface's own tabs
    // begin — the same mark the hub's sub-nav carries, for the same reason.
    return t.spine && !TABS[i + 1]?.spine ? `${link}\n  <span class="tab-div" aria-hidden="true">·</span>` : link;
  }).join('\n  ')}
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
  // The critical claim rides with the row rather than in a legend: he judges
  // "is this really critical" by reading what it says is stuck behind it.
  const claim = it.critical && it.criticalClaim
    ? `<span class="q-claim">critical &middot; ${esc(it.criticalClaim)}</span>` : '';
  // An RC title carries no summary any more (@jwildfire, 2026-08-15), so the
  // sentence sits under it - the same second-line shape as a critical claim.
  const sub = it.sub ? `<span class="q-sub">${esc(it.sub)}</span>` : '';
  // When the claim was last checked, on the row itself (obot.agent#262). A config item
  // used to carry a filing date and nothing else, so the row said when somebody wrote
  // it down rather than when anybody last established that it was still true.
  const cur = it.currency
    ? `<span class="q-cur ${esc(it.currency.state)}">${esc(it.currency.phrase)}</span>` : '';
  return `<li class="q ${KIND[it.kind]?.tone ?? ''}${it.critical ? ' crit' : ''}" data-kind="${esc(it.kind)}" data-key="${esc(it.key)}"${it.fingerprint ? ` data-fp="${esc(it.fingerprint)}"` : ''}${it.artifact ? ` data-artifact="${esc(it.artifact)}"` : ''}${it.url ? ` data-url="${esc(it.url)}"` : ''}${it.detail ? ` title="${esc(it.detail)}"` : ''}><span class="q-line">${c ? `<span class="q-id mono">${esc(c)}</span>` : ''}<span class="q-title">${esc(it.title)}</span></span>${sub}${claim}${cur}</li>`;
};

// `read: false` means the source behind this group could not be opened, so the
// badge shows a dash rather than a count. A `0` beside "Sweeping GitHub…" is the
// page asserting a number in the same breath as admitting it has none.
// A bucket nobody could read is not a bucket that is empty, and on a phone there is
// no hover to reveal the difference — so it is the one thing here that gets its own
// colour rather than the muted grey of "nothing waiting" (jwildfire/obot.agent#206).
const group = (title, items, empty, moved = 0, read = true) => `<h2 class="q-h">${esc(title)} <span class="q-n">${read ? items.length : UNMEASURED}</span>${
  moved ? `<span class="q-moved">${moved} pinned above</span>` : ''}</h2>
${items.length ? `<ul class="q-list">${items.map(item).join('')}</ul>` : `<p class="${read ? 'q-empty' : 'q-unread'}">${esc(empty)}</p>`}`;

/**
 * The config items their own check took off the list (obot.agent#262).
 *
 * Named rather than simply gone. An item that disappears because a machine decided it
 * was done is indistinguishable from an item that was dropped, and this whole
 * capability exists because things left the list for reasons nobody could see. Ids and
 * a time — never the item's text, which does not leave the machine.
 */
const clearedLine = (cleared = []) => (cleared.length
  ? `<p class="q-cleared">${cleared.length} cleared by ${cleared.length === 1 ? 'its' : 'their'} own check &mdash; ${esc(cleared.map((c) => c.id).join(', '))}${
      cleared[0]?.ago ? ` (${esc(cleared[0].ago)})` : ''}. Done, and off your list without you touching it; the list still records ${cleared.length === 1 ? 'it' : 'them'}.</p>`
  : '');

/** "The GitHub sweep, the hub clone and the config list" — for the one-line why. */
const unreadNames = (read) => {
  const names = [
    read.rc ? null : 'the GitHub sweep',
    read.decision ? null : 'the hub clone',
    read.config ? null : 'the config list',
  ].filter(Boolean);
  if (names.length <= 1) return names[0] ?? 'nothing';
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
};

/** How long ago, for a moment rather than for an age. `ageWords` says how old a thing is. */
const agoWords = (min) => {
  if (min === null || min === undefined || !Number.isFinite(min)) return null;
  if (min < 1) return 'just now';
  if (min < 60) return `${Math.round(min)}m ago`;
  const h = min / 60;
  return h < 48 ? `${Math.round(h)}h ago` : `${Math.round(h / 24)}d ago`;
};

const ageWords = (min) => {
  if (min === null || min === undefined || !Number.isFinite(min)) return null;
  if (min < 60) return `${Math.max(0, Math.round(min))}m old`;
  const h = min / 60;
  return h < 48 ? `${Math.round(h)}h old` : `${Math.round(h / 24)}d old`;
};

/**
 * What this page is made of: the commit it is running, and the commit its decisions
 * came from — printed whether or not either is stale.
 *
 * Printed on the healthy path deliberately. Twice on 2026-08-16 the running dashboard
 * was many merges behind `main` — eleven, the second time — with nothing on the page
 * saying so, and the hub clone it read decisions from was four commits behind
 * `origin/main`, which is why a decision @jwildfire made that morning was still listed
 * as awaiting him. A threshold would have caught neither: both were inside any sane
 * one, and what was missing was a sentence naming the snapshot next to the numbers.
 * Same reasoning as the audit-freshness line in tools/navigator/checks.mjs.
 *
 * The code half can only be reported from inside the process — it cannot reload its
 * own modules — but since jwildfire/obot.roadmap#243 something outside it listens: the
 * five-minute sweep fast-forwards the checkout and restarts this server when it moves.
 * So there is a third half, and it is the one that fails invisibly. A page serving old
 * code looks exactly like a page serving new code, and an updater that stopped looks
 * exactly like one with nothing to do; the update half says which it is, and names the
 * refusal when the checkout could not be moved. The manual restart command is printed
 * only when nothing is going to do it automatically — telling him to run `pkill` for a
 * restart that is already ninety seconds away is how a true line becomes noise.
 *
 * The data half is already fixed by the time this renders: the freshest committed hub
 * state was read, and this says which one that was.
 */
export const provenanceLine = ({ code = null, hub = null, update = null } = {}) => {
  const bits = [];
  let tone = 'ok';
  if (code?.unknown) { bits.push('code: which commit is running could not be read'); tone = 'warn'; }
  else if (code?.short) {
    const age = ageWords(code.ageMin);
    // When this process started, next to how old its code is. Two different questions
    // that a single sha cannot answer — "is this build recent" and "did this page
    // actually restart" — and #243 asks the page for both.
    const up = agoWords(code.upMin);
    const stamp = `code: <code>${esc(code.short)}</code>${age ? `, ${esc(age)}` : ''}${up ? `, started ${esc(up)}` : ''}`;
    bits.push(code.behind
      ? `${stamp} — ${code.behind} commit${code.behind === 1 ? '' : 's'} behind this checkout, restart to pick ${code.behind === 1 ? 'it' : 'them'} up`
      : `${stamp}, current with this checkout`);
    if (code.behind) tone = 'warn';
  }
  if (hub?.warn) { bits.push(`decisions: ${esc(hub.warn)}`); tone = 'warn'; }
  else if (hub?.head) {
    bits.push(hub.source === 'clone'
      ? `decisions: <code>${esc(hub.head)}</code> from your hub clone${hub.dirty ? ', with uncommitted edits' : ''}`
      : `decisions: <code>${esc(hub.head)}</code> from <code>${esc(hub.source)}</code> — your clone is ${hub.behind} commit${hub.behind === 1 ? '' : 's'} behind it, so this page is ahead of it`);
  }
  // The update half. `absent` is the honest answer on a machine where the sweep is not
  // installed, and it is only a warning when it costs something — a page that is
  // current has nothing to be warned about.
  let armed = false;
  if (update?.state === 'ok') {
    armed = true;
    const when = update.ageMin < 1 ? 'just now' : `${update.ageMin}m ago`;
    bits.push(update.restartedAt
      ? `updates: checked ${when}; this page was restarted onto <code>${esc(update.head ?? '')}</code> automatically`
      : update.deferred
        // The count, not just the fact. This line used to promise a restart "waiting
        // for the page to be idle", which was an unbounded wait dressed as an
        // imminent one: whoever was reading it was the reason it was waiting
        // (jwildfire/obot.agent#258). Now it says which deferral this is and that
        // there is a last one.
        ? `updates: checked ${when}; a restart onto <code>${esc(update.head ?? '')}</code> is waiting for the page to settle${
            update.deferrals && update.deferralLimit
              ? ` (deferral ${update.deferrals} of ${update.deferralLimit} — after that it restarts regardless)`
              : ''}`
        : `updates: checked ${when}; the checkout is current with its remote`);
  } else if (update?.state === 'absent') {
    bits.push(`updates: ${esc(update.why)}`);
    if (code?.behind) tone = 'warn';
  } else if (update) {
    bits.push(`updates: ${esc(update.why)}`);
    tone = 'warn';
  }

  if (!bits.length) return '';
  // Kill then relaunch, in that order and never overlapping: a second instance takes
  // the port after this one and steals the serve marker the status line reads,
  // deleting it when it exits (obot.agent#142). Which is also why this is a command he
  // runs rather than one this page offers to run for itself — and why it is withheld
  // when the sweep is armed, since two restarters racing for port 7326 is that same
  // bug with an extra process.
  return `<p class="prov ${tone}">${bits.join(' &middot; ')}${
    code?.behind && !armed ? ` <span class="prov-fix"><code>${esc(RESTART_CMD)}</code>, then <code>/session-dashboard</code></span>` : ''}${
    code?.behind && armed ? ' <span class="prov-fix">no action needed — the sweep restarts this page within five minutes of it going quiet, and within fifteen whether it does or not</span>' : ''}</p>`;
};

export const RESTART_CMD = "pkill -f 'ops-dashboard.mjs --serve'";

/**
 * The open pull requests that are ready but are *not* his — standard-lane work,
 * excluded from the release-candidate panel by the lane classifier.
 *
 * One line, naming them, because the alternative is a silent drop. Until 2026-08-16
 * these were listed as release candidates and one of the three on the page was an
 * ordinary feature PR into `dev`; removing them is the fix, and saying where they went
 * is what stops the fix from looking like a queue that lost something.
 */
export const foldedLane = (folded = []) => (folded.length
  ? `<p class="q-aside">${folded.length === 1 ? 'One decision was' : `${folded.length} decisions were`} folded into a later one and answered there: ${
    folded.map((f) => `${esc(f.id ?? f.key)} &rarr; ${esc(f.into ?? 'its successor')}`).join(', ')}.</p>`
  : '');

export const standardLane = (standard = []) => (standard.length
  ? `<p class="q-aside">${standard.length === 1 ? 'One other open PR is' : `${standard.length} other open PRs are`} on the standard lane, not yours to review: ${
    standard.map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(String(s.key).replace(/^jwildfire\//, ''))}</a> &rarr; <code>${esc(s.base ?? '')}</code>`).join(', ')}.</p>`
  : '');

/**
 * Snoozed and cleared rows: on the page, collapsed.
 *
 * Nothing he acts on may vanish. A snooze he cannot see is a silent delete, and
 * a dismissal he cannot undo is the deletion the workspace rules forbid. Both
 * live in a `<details>`, so a long list costs one line of vertical space on a
 * phone until he opens it.
 */
const collapsed = (title, rows, describe) => (rows.length ? `<details class="q-fold">
<summary>${esc(title)} <span class="q-n">${rows.length}</span></summary>
<ul class="q-list">${rows.map((it) => `<li class="q ${KIND[it.kind]?.tone ?? ''} q-off" data-kind="${esc(it.kind)}" data-key="${esc(it.key)}"><span class="q-line"><span class="q-title">${esc(it.title)}</span></span><span class="q-claim">${esc(describe(it))} &middot; <button class="q-restore" data-key="${esc(it.key)}" data-kind="${esc(it.kind)}">restore</button></span></li>`).join('')}</ul>
</details>` : '');

// Palette, header and tab strip — shared by both tabs so the header is genuinely
// persistent: the same markup and the same styles whichever view is on screen.
/**
 * The ranked head — what comes next, below his three buckets (jwildfire/obot.roadmap#278).
 *
 * @jwildfire, 2026-08-18: "Next 10 requirements show up at the bottom of the queue
 * maybe. you're responsible for strategy, so you get the decision and then i can steer
 * when i want to."
 *
 * IT IS A PREVIEW, NEVER A FOURTH BUCKET. His queue holds three things that need him —
 * release candidates, decisions, config — and that rule is jwildfire/obot.roadmap#220.
 * This sits under all of them, it is read-only, it has no control of any kind, and its
 * every link leaves for GitHub. The moment it asks him for something it is a fourth
 * obligation and the three-bucket rule dies quietly, so a test asserts the absence of
 * an ask rather than trusting anyone to remember.
 *
 * RANK IS DECLARED, EVERYTHING ELSE IS DERIVED. The only two things here that come out
 * of a file are the position and the one-line why — the reason is what makes the rank
 * interrogable, and a rank he cannot interrogate is one he cannot steer. Title, state,
 * milestone, blocked-ness and sub-issue progress all come from GitHub at read time,
 * keyed off the `top10` label he asked for.
 *
 * IT AGES IN TWO PLACES BECAUSE IT HAS TWO SOURCES. "Ranked <date>, 3d old" is about
 * the order; "state refreshed 4m ago" is about everything beside it. A list untouched
 * for three days says so, and a reading that could not refresh says that in its own
 * sentence with the age of what is actually on screen — never a silent substitution of
 * old for current.
 */
/**
 * What reached him — the delivered half of his page (jwildfire/obot.roadmap#257).
 *
 * @jwildfire, 2026-08-20, after five requirements closed inside twenty-five minutes
 * and nothing told him: "I like the summary of the closed items in the top 10, but
 * make them a plain language executive summary instead of a bunch of issue numbers.
 * Make sure that those are passed to you properly (and passed to me) whenever they
 * are created."
 *
 * THE SENTENCE IS THE DELIVERABLE AND THE NUMBER IS A CITATION. That ordering is the
 * requirement, not a rendering preference: "#251, #256 and #264 closed" is the exact
 * failure being named, and "When the system says it stopped a runaway agent, it now
 * has to prove the process died" is what it should have said. So the summary is the
 * row and the reference is small print under it, never the other way round.
 *
 * IT IS NOT A FOURTH BUCKET. Like the ranked head it sits under, this is read-only,
 * it has no control of any kind, and it asks him for nothing — his queue holds three
 * things that need him and that rule is jwildfire/obot.roadmap#220. What it adds is
 * the one thing the three buckets never carried: what he GOT.
 *
 * TWO HALVES, BECAUSE A PROMISE AND A FINISH FAIL DIFFERENTLY. Above, what completed
 * and the sentence for each. Below, only what he asked for that has NOT been found
 * where he was told to look, with its age — a list of promises everything is fine
 * with is a list nobody reads, and the org chart went missing for a day precisely
 * because nothing measured the distance between "being drafted" and "on his screen".
 */
const deliveredPanel = (d, now = new Date()) => {
  if (!d) return '';
  const head = (n) => `<h2 class="q-h">Delivered <span class="q-n">${n}</span></h2>`;
  const wrap = (body, n) => `<section class="dlv" aria-label="What reached you, read only">
${head(n)}
${body}
</section>`;

  if (!d.read) {
    return wrap(`<p class="q-unread">${esc(nothingYet('What reached you could not be read',
      `${d.why || 'the landing record did not answer'}; this is not an empty day, it is an unread one`))}</p>`, UNMEASURED);
  }
  if (!d.armed) {
    return wrap(`<p class="q-empty">${esc(nothingYet('Nothing has been written on this machine yet',
      'a completion is recorded the moment a requirement closes, with one sentence saying what you can now do that you could not before; nothing has recorded one here'))}</p>`, UNMEASURED);
  }

  const shipped = (d.closures ?? []).filter((c) => String(c.summary ?? '').trim());
  const owed = (d.promises ?? []).filter((p) => p.state !== 'landed');
  const rows = shipped.length
    ? `<ul class="dlv-list">${shipped.map(deliveredRow).join('')}</ul>`
    : '<p class="q-empty">Nothing has completed yet today.</p>';
  const asks = owed.length
    ? `<p class="q-aside">Asked for and not yet found where it was meant to land</p>
<ul class="dlv-list">${owed.map((p) => promiseRow(p, now)).join('')}</ul>`
    : '';
  return wrap(`${rows}
${asks}
<p class="q-aside">Read-only. Every line was written by whoever finished the work, at the moment it closed.</p>`, shipped.length);
};

/** One completion. The sentence, then the citation — in that order, always. */
const deliveredRow = (c) => `<li class="dlv-row"><span class="dlv-line">${esc(c.summary)}</span>`
  + `<span class="dlv-cite">${esc(c.issue ?? '')}${c.worker ? ` &middot; ${esc(c.worker)}` : ''}</span></li>`;

/**
 * One outstanding ask, in his words, with what the fetch actually found.
 *
 * `unchecked` gets its own sentence and its own colour. A landing nobody could look
 * at is not a landing that failed, and rendering the two the same way is the collapse
 * this workspace has already paid for twice (obot.agent#215).
 */
const promiseRow = (p, now) => {
  const age = ageWords(Math.round((p.ageHours ?? 0) * 60));
  const found = p.state === 'unchecked'
    ? `has not been checked &mdash; ${esc(p.detail || 'nothing has looked')}`
    : `not there &mdash; ${esc(p.detail || 'the fetch found nothing')}`;
  return `<li class="dlv-row dlv-owed"><span class="dlv-ask">${esc(p.asked ?? '')}</span>`
    + `<span class="dlv-why ${p.state === 'unchecked' ? 'unknown' : 'gone'}">${found}</span>`
    + `<span class="dlv-cite">${esc(p.landing ?? '')}${age ? ` &middot; asked ${esc(age)} ago` : ''}</span></li>`;
};

const rankHeadPanel = (m) => {
  if (!m) return '';
  const head = `<h2 class="q-h">Next ten <span class="q-n">${m.declaredRead ? m.items.length : UNMEASURED}</span></h2>`;
  if (!m.declaredRead) {
    return `<section class="rank" aria-label="Ranked head, read only">
${head}
<p class="q-unread">${esc(nothingYet('The ranked head could not be read', `${m.declaredWhy}; the order lives in obot.agent/${RANK_REL} and is read from the checkout beside this workspace`))}</p>
</section>`;
  }
  return `<section class="rank" aria-label="Ranked head, read only">
${head}
<p class="rank-clocks">${rankClocks(m)}</p>
${rankState(m)}
<ol class="rank-list">${m.items.map(rankRow).join('')}</ol>
${m.boundary ? `<p class="q-aside">${esc(m.boundary)}</p>` : ''}
${m.findings.map((f) => `<p class="rank-note">${rankFinding(f, m)}</p>`).join('')}
<p class="q-aside">Read-only. Rank is 🎩🤖 obot-prime's; steering it overrides the order without discussion.</p>
</section>`;
};

/** The order's own clock. Never a zero for an age nobody could measure. */
const rankClocks = (m) => (m.touched?.read
  ? `Ranked ${esc(m.touched.iso.slice(0, 10))}, ${esc(ageWords(m.touched.ageMin) ?? 'age unknown')}${
    m.touched.dirty ? ', edited since and not committed' : ''}`
  : `Rank age not known &mdash; ${esc(m.touched?.why ?? `${RANK_REL} could not be dated`)}`);

/** The derived half's clock, and the one place stale is allowed to be shown at all. */
const rankState = (m) => {
  if (!m.read) {
    return `<p class="rank-stale">${esc(m.error || 'No GitHub reading has completed on this machine yet')}. The order above is declared locally and is current; the state beside each row is not derived.</p>`;
  }
  if (m.error) {
    return `<p class="rank-stale">Showing a reading ${esc(ageWords(m.ageMin) ?? 'of unknown age')}; the refresh since failed &mdash; ${esc(m.error)}. Nothing beside a row is current.</p>`;
  }
  const when = agoWords(m.ageMin);
  return `<p class="rank-clocks">State refreshed ${esc(when ?? 'at an unknown time')}${
    m.refreshing ? ', refreshing now' : ''} from <code>${esc(m.label ?? 'the membership label')}</code> on ${esc(m.repo ?? 'the hub')}</p>`;
};

/** One ranked requirement. Position and reason declared; the rest derived, or withheld. */
const rankRow = (it) => {
  const label = it.title ? it.title.replace(/^Requirement:\s*/, '') : `#${it.issue}`;
  const name = it.url
    ? `<a class="rank-title" href="${esc(it.url)}" target="_blank" rel="noopener">${esc(label)}</a>`
    : `<span class="rank-title">${esc(label)}</span>`;
  return `<li class="rank-row"><span class="rank-line"><span class="rank-n">${it.rank}</span>${name}</span>`
    + `<span class="rank-why">${esc(it.why ?? 'no reason recorded')}</span>`
    + (it.present
      ? `<span class="rank-state">${esc(rankFacts(it))}</span>`
      : `<span class="rank-state rank-unknown">not returned by GitHub in the last reading</span>`)
    + (it.review ? `<span class="rank-note">under review: ${esc(it.review)}</span>` : '')
    + '</li>';
};

/** Everything on a row that GitHub knows and the store must never claim. */
const rankFacts = (it) => [
  it.state ?? 'state unknown',
  it.milestone,
  it.blocked ? 'blocked' : null,
  it.sub ? `${it.sub.completed}/${it.sub.total} sub-issues` : null,
].filter(Boolean).join(' · ');

/**
 * A computed condition, stated and left alone.
 *
 * The slot line is the one this panel exists for and the one that must stop where it
 * does: it says a slot is open and whose call the replacement is, and the bench appears
 * as a COUNT so no reading of it can be mistaken for a recommendation.
 */
const rankFinding = (f, m) => {
  const bench = m.bench?.read
    ? `the <code>${esc(m.bench.label ?? 'on-deck')}</code> bench holds ${m.bench.open} open issue${m.bench.open === 1 ? '' : 's'}`
    : 'the bench could not be counted in the last reading';
  switch (f.kind) {
    case 'slot-open':
      return `Rank ${f.rank} is a slot: <a href="${esc(issueHref(m, f.issue))}" target="_blank" rel="noopener">#${f.issue}</a> is closed. Choosing what fills it is 🎩🤖 obot-prime's, and nothing here picks one &mdash; ${bench}.`;
    case 'unlabelled-rank':
      return `#${f.issue} is ranked ${f.rank} in the order and no longer carries <code>${esc(m.label ?? 'top10')}</code> on GitHub. The label carries membership and the file carries order; while they disagree, the one API call returns a different ten than this list shows.`;
    case 'unranked-member':
      return `#${f.issue} carries <code>${esc(m.label ?? 'top10')}</code> and has no rank. It is in the ten and the order does not say where.`;
    case 'missing':
      return `#${f.issue} is ranked ${f.rank} and GitHub did not return it. Its row is held open rather than dropped.`;
    case 'count':
      return `The order holds ${f.n}, not ten.`;
    default:
      return esc(`unrecognised finding: ${f.kind}`);
  }
};

const issueHref = (m, n) => (m.repo ? `https://github.com/${m.repo}/issues/${n}` : `https://github.com/jwildfire/obot.roadmap/issues/${n}`);

const SHELL_CSS = `
  /* The palette, the type and the components are the shared sheet's now
     (assets/obot.css, jwildfire/obot.agent#15) — @jwildfire, 2026-08-20: "match the css
     of the decision docs". What is left here is this page's own names pointed at that
     sheet's tokens, and the layout, which the sheet deliberately does not carry.

     The aliases are a bridge, not a second palette: every one of them resolves to a
     token defined once, so the dashboard follows the theme — including the dark half
     the decision artifacts never had. Roles, not shades, decide the mapping: the
     accent is the link/primary blue, config is bronze, critical is the flag red, and
     a settled thing is green. Renaming the ~200 call sites is a later, larger diff
     with nothing to show for it. */
  :root {
    --card:var(--panel);
    --muted:var(--ink2);
    --faint:var(--mute);
    --line:var(--rule);
    --accent:var(--blue);
    --accent-soft:var(--blue-soft);
    --good:var(--go);
    --good-soft:var(--go-soft);
    --warn:var(--bronze);
    --warn-soft:var(--bronze-soft);
    --crit:var(--flag);
    --sans:var(--body);
    --header:40px;
  }
  html, body { height:100%; }
  /* Denser than a document: this is a list he triages, not a page he reads. */
  body { line-height:1.5; }
  /* App chrome, so no reading-measure and no link underline — both belong to prose. */
  .main p, .side p, .rail p, header.top p { max-width:none; }
  a { border-bottom:0; }
  a:hover { border-bottom:0; text-decoration:underline; }
  .mono { font-size:0.85em; }

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
  /* The narrow header drops "local only · HH:MM" but never the last-look phrase:
     a signal about whether to look that is invisible in his usual window is the
     same as no signal at all (jwildfire/obot.agent#143). */
  @media (max-width:520px) { header.top .where .wide { display:none; } }

  .tabs { display:flex; gap:0.2rem; }
  .tabs a { font-size:0.75rem; padding:0.15rem 0.6rem; border-radius:99px; text-decoration:none;
            color:var(--muted); border:1px solid transparent; white-space:nowrap; }
  .tabs a:hover { border-color:var(--line); }
  .tabs a[aria-current="page"] { background:var(--accent-soft); color:var(--accent); border-color:var(--accent); }

  /* The page-level fault banner, in the shared sheet because both surfaces raise one
     and the loudest thing this page can say must not depend on which tab it is
     (jwildfire/obot.agent#215 shipped it into the dashboard, where the rule was not
     defined, so the banner rendered as plain grey text). overflow-wrap: an alarm carries the
     path or command that produced it, and a filesystem path is one unbreakable token.
     Without this the alarm box pushes the whole page sideways at 390px — measured in
     an iframe probe, 452px of scroll in a 386px viewport — and he reads this on a
     phone. */
  .dead { border:1px solid var(--crit); background:var(--warn-soft); color:var(--ink);
          border-radius:8px; padding:0.5rem 0.6rem; margin:0 0 0.7rem; font-size:0.82rem;
          overflow-wrap:anywhere; }
  .dead code { font-family:var(--mono); font-size:0.74rem; overflow-wrap:anywhere; }
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
  .main > iframe { flex:1; width:100%; border:0; min-height:70vh; }

  /* The release-candidate panel — his review order top to bottom: what it is, the ask,
     the notes, what it closes, then the demo running live. */
  .rc-panel { flex:1; overflow-y:auto; padding:1rem 1.1rem 1.4rem; }
  .rc-head { display:flex; align-items:baseline; gap:0.5rem; flex-wrap:wrap; margin-bottom:0.35rem; }
  .rc-head h2 { font-size:1rem; margin:0; font-family:var(--mono); }
  .rc-checks { font-size:0.68rem; padding:0.05rem 0.4rem; border-radius:99px;
               background:var(--good-soft); color:var(--good); }
  .rc-checks.failing { background:var(--accent-soft); color:var(--accent); }
  .rc-checks.pending, .rc-checks.none { background:var(--warn-soft); color:var(--warn); }
  .rc-size { font-size:0.68rem; color:var(--faint); font-family:var(--mono); }
  .rc-summary { font-size:0.9rem; margin:0 0 0.5rem; max-width:64ch; }
  .rc-ask { font-size:0.82rem; margin:0 0 0.5rem; padding:0.3rem 0.5rem;
            background:var(--accent-soft); border-radius:5px; max-width:64ch; }
  .rc-links { font-size:0.8rem; margin:0 0 0.9rem; }
  .rc-panel h3 { font-size:0.78rem; text-transform:uppercase; letter-spacing:0.04em;
                 color:var(--muted); margin:0.9rem 0 0.35rem; }
  .rc-reqs { margin:0; padding-left:1.1rem; font-size:0.83rem; }
  .rc-reqs li { margin-bottom:0.15rem; }
  .rc-none { font-size:0.8rem; color:var(--muted); margin:0; }
  .rc-demo { width:100%; height:60vh; border:1px solid var(--line); border-radius:6px; background:var(--paper); }
  .main .placeholder { padding:1.2rem 1.1rem; color:var(--muted); max-width:52ch; }
  .main .placeholder h2 { font-size:1rem; margin:0 0 0.4rem; color:var(--ink); }
  .main .placeholder p { margin:0 0 0.5rem; font-size:0.85rem; }

  /* The ranked head — below the three buckets, read-only, and the only panel on this
     page that shows something nobody has to act on. Everything here is sized to the
     390px phone he reads the queue on: no fixed widths, nothing that refuses to wrap,
     and every class that can carry a requirement title or a URL breaking inside a
     word — the rail sets no min-width:0, so one unbreakable token widens the column. */
  .rank { display:block; margin-top:1rem; padding-top:0.5rem; border-top:1px solid var(--line); }
  .rank-list { list-style:none; margin:0.2rem 0 0; padding:0; display:flex; flex-direction:column; gap:0.3rem; }
  .rank-row { display:flex; flex-direction:column; gap:0.05rem; border-left:3px solid var(--line); border-radius:0 5px 5px 0; padding:0.1rem 0.4rem; }
  .rank-line { display:flex; align-items:baseline; gap:0.4rem; min-width:0; }
  .rank-n { font-family:var(--mono); font-size:0.7rem; color:var(--faint); flex:none; min-width:1.1em; text-align:right; }
  /* Two lines, hard — the same budget the queue rows take, and for the same reason: a
     requirement title is a sentence, and ten unbounded ones would own his phone. The
     reason under it is NOT clamped; it is the thing he steers from. */
  .rank-title { font-size:0.8rem; color:var(--ink); text-decoration:none; overflow-wrap:anywhere; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
  .rank-title:hover { text-decoration:underline; }
  .rank-why { font-size:0.7rem; color:var(--muted); line-height:1.35; overflow-wrap:anywhere; padding-left:1.5em; }
  .rank-state { font-size:0.64rem; font-family:var(--mono); color:var(--faint); padding-left:1.5em; overflow-wrap:anywhere; }
  .rank-unknown { color:var(--warn); }
  .rank-clocks { font-size:0.66rem; color:var(--faint); margin:0.1rem 0 0.3rem; line-height:1.35; overflow-wrap:anywhere; }
  .rank-stale { font-size:0.68rem; color:var(--warn); margin:0.1rem 0 0.35rem; line-height:1.35; overflow-wrap:anywhere; }
  .rank-note { font-size:0.66rem; color:var(--muted); margin:0.25rem 0 0; line-height:1.35; overflow-wrap:anywhere; }
  .rank-row .rank-note { padding-left:1.5em; }
  .rank code { font-family:var(--mono); font-size:0.94em; overflow-wrap:anywhere; }
  .rank a { color:var(--muted); }
  /* The sweep's age, printed only when a newer attempt has failed behind it. */
  .q-stale { font-size:0.7rem; color:var(--warn); margin:0.15rem 0 0.4rem; }
  /* The first morning on a new machine: what is absent, and what fills it. */
  .firstday { border:1px solid var(--line); border-radius:8px; padding:0.7rem 0.8rem; margin:0 0 1rem;
    background:var(--paper); }
  .firstday h2 { font-size:0.95rem; margin:0 0 0.35rem; color:var(--ink); }
  .firstday p { margin:0 0 0.5rem; font-size:0.85rem; }
  .firstday ul { margin:0; padding-left:1.1rem; font-size:0.83rem; }
  .firstday li { margin-bottom:0.25rem; }
  .firstday code { font-family:var(--mono); font-size:0.78rem; overflow-wrap:anywhere; }
  .firstday li { overflow-wrap:anywhere; }
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
  /* Two lines, hard. The titles say what he gets rather than naming a setting,
     which makes them longer — worth it in the panel, not worth an unbounded row
     in a list he scrolls on a phone. The full title is the panel's heading. */
  .q-title { font-size:0.82rem; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical;
             overflow:hidden; }
  /* An RC title carries no summary any more (@jwildfire, 2026-08-15), so the row runs to
     a second line under it. The .q row is already a column and .q-line already carries
     min-width:0, so this only has to be the line itself: one line, ellipsized, because
     he reads this list on a 390px phone. */
  .q-sub { font-size:0.72rem; color:var(--muted); line-height:1.25; min-width:0;
           overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .q-empty { font-size:0.76rem; color:var(--muted); margin:0 0 0.2rem; overflow-wrap:anywhere; }
  .q-unread { font-size:0.76rem; color:var(--ink); background:var(--warn-soft); border-left:3px solid var(--warn);
    padding:0.35rem 0.5rem; margin:0 0 0.3rem; overflow-wrap:anywhere; }
  /* Wraps rather than ellipsizes: it is one short line naming one or two PRs, and
     the point of it is that the refs stay readable at 390px. */
  .q-aside { font-size:0.7rem; color:var(--faint); margin:0.1rem 0 0.4rem; line-height:1.35; }
  /* What the page is made of. Above the queue, never hidden at any width: a
     staleness notice that disappears on a phone is the failure it warns about. */
  .prov { font-size:0.66rem; line-height:1.4; margin:0 0 0.6rem; color:var(--faint); overflow-wrap:anywhere;
          border-left:2px solid var(--line); padding:0.15rem 0 0.15rem 0.45rem; }
  .prov.warn { color:var(--muted); border-left-color:var(--crit); }
  .prov code { font-family:var(--mono); font-size:0.95em; }
  .prov-fix { display:block; margin-top:0.15rem; }
  .q-aside a { color:var(--muted); }
  .q-aside code { font-family:var(--mono); font-size:0.92em; }
  .q-line { display:flex; align-items:baseline; gap:0.4rem; min-width:0; }
  .q-moved { font-size:0.62rem; color:var(--faint); text-transform:none; letter-spacing:0; }

  /* Critical: a red edge and the claim under the title. Only ever three rows,
     so the second line costs at most three lines of the phone's budget. */
  .q { flex-direction:column; align-items:stretch; gap:0; }
  .q.crit { border-left-color:var(--crit); }
  .q-claim { font-size:0.66rem; color:var(--muted); font-family:var(--mono); }
  .q.crit .q-claim { color:var(--crit); }
  /* How current the row's claim is. Three states get three colours, because two of
     them being the same colour is exactly the collapse this exists to prevent: a
     check that could not run must not look like a check that came back outstanding. */
  .q-cur { display:block; font-size:0.64rem; font-family:var(--mono); color:var(--muted); }
  .q-cur.holds { color:var(--good); }
  .q-cur.unknown { color:var(--warn); }
  .q-cleared { font-size:0.68rem; color:var(--good); margin:0.2rem 0 0.6rem; }
  .q-fold { margin-top:0.9rem; border-top:1px solid var(--line); padding-top:0.4rem; }
  .q-fold summary { font-size:0.66rem; letter-spacing:0.11em; text-transform:uppercase;
                    color:var(--faint); cursor:pointer; }
  .q-off { cursor:default; }
  .q-off .q-title { color:var(--muted); }
  .q-restore { font-size:0.66rem; padding:0 0.25rem; border:1px solid var(--line); border-radius:5px;
               background:var(--paper); color:var(--accent); cursor:pointer; font-family:var(--mono); }
  .overbudget { font-size:0.7rem; color:var(--warn); border:1px solid var(--warn); border-radius:6px;
                padding:0.2rem 0.4rem; margin:0 0 0.5rem; }

  /* What reached him (jwildfire/obot.roadmap#257). Every rule here wraps: the rail
     has no min-width:0, so one unbreakable token in an agent-written sentence widens
     the whole 220px track and pushes the page sideways at 390px. white-space:nowrap
     is banned in this block for the same reason and a test asserts its absence. */
  .dlv { margin-top:0.9rem; border-top:1px solid var(--line); padding-top:0.5rem; }
  .dlv-list { list-style:none; margin:0 0 0.4rem; padding:0; }
  .dlv-row { display:flex; flex-direction:column; gap:0.05rem; min-width:0;
             padding:0.3rem 0 0.35rem 0.45rem; border-left:3px solid var(--good); margin-bottom:0.3rem; }
  .dlv-row.dlv-owed { border-left-color:var(--warn); }
  /* The sentence. It is the deliverable, so it gets the row's weight and it is never
     clamped: a summary cut at two lines is a summary that stops before the point. */
  .dlv-line { font-size:0.8rem; line-height:1.35; color:var(--ink); overflow-wrap:anywhere; }
  .dlv-ask { font-size:0.8rem; line-height:1.35; color:var(--ink); overflow-wrap:anywhere; }
  /* The citation, and it is small print under the sentence by design — "#251, #256
     and #264 closed" is the failure this panel was built against. */
  .dlv-cite { font-size:0.64rem; font-family:var(--mono); color:var(--faint); overflow-wrap:anywhere; }
  /* Two states, two colours, because a landing nobody could check must not look like
     a landing that failed (obot.agent#215). */
  .dlv-why { font-size:0.66rem; color:var(--muted); overflow-wrap:anywhere; }
  .dlv-why.gone { color:var(--crit); }
  .dlv-why.unknown { color:var(--warn); }

  /* The proof, in the sidebar. It is the one thing on a config item that a static
     card cannot do, so it is the one thing that did not move into the card. */
  .config-check { border-top:1px solid var(--line); margin-top:0.7rem; padding-top:0.6rem; }
  .config-check .lab { font-size:0.62rem; letter-spacing:0.11em; text-transform:uppercase;
                       color:var(--faint); display:block; margin-bottom:0.25rem; }
  .config-check .cc-what { margin:0 0 0.35rem; font-size:0.8rem; color:var(--muted); }
  .iq-check { display:flex; gap:0.4rem; align-items:center; flex-wrap:wrap; margin-top:0.35rem; }
  .iq-check button { font-size:0.76rem; padding:0.25rem 0.6rem; border-radius:7px; border:1px solid var(--accent);
                     background:var(--accent-soft); color:var(--accent); cursor:pointer; }
  .iq-check button[disabled] { opacity:0.5; cursor:not-allowed; border-color:var(--line); color:var(--muted);
                               background:var(--paper); }
  .iq-res { font-size:0.76rem; font-family:var(--mono); }
  .iq-res.pass, .iq-res.holds { color:var(--good); }
  .iq-res.fail, .iq-res.fails { color:var(--crit); }
  .iq-res.refused, .iq-res.unknown { color:var(--warn); }

  /* Triage: one bar, in the sidebar, for whatever is selected. */
  .triage { border-top:1px solid var(--line); margin-top:0.7rem; padding-top:0.5rem; }
  .triage .row { display:flex; gap:0.25rem; flex-wrap:wrap; }
  .triage button { flex:1 1 auto; font-size:0.72rem; padding:0.25rem 0.3rem; border-radius:7px;
                   border:1px solid var(--line); background:var(--paper); color:var(--ink); cursor:pointer; }
  .triage button[disabled] { opacity:0.4; cursor:not-allowed; }
  .triage .means { font-size:0.68rem; color:var(--muted); margin:0.3rem 0 0; }
  .snooze-menu { display:flex; gap:0.25rem; flex-wrap:wrap; margin-top:0.25rem; }
  .snooze-menu button { font-size:0.68rem; }

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
  .answers { margin-top:0.9rem; border-top:1px solid var(--line); padding-top:0.5rem; }
  .answers li { font-size:0.72rem; color:var(--muted); margin:0.15rem 0; list-style:none; }
  .ok { color:var(--good); font-size:0.78rem; margin:0.35rem 0 0; }

  /* Where his answers are. One row per decision — three clicks on the same one
     is one answer with a history, not three rows — and each row says which of
     the three states it is in, because "did it land?" is the question the page
     failed to answer on 2026-08-15. */
  .ans-list { list-style:none; margin:0; padding:0; }
  .ans { font-size:0.74rem; margin:0.3rem 0; padding-left:0.45rem; border-left:3px solid var(--line); }
  .ans[data-status="captured"] { border-left-color:var(--warn); }
  .ans[data-status="delivered"] { border-left-color:var(--accent); }
  .ans[data-status="applied"] { border-left-color:var(--good); }
  .ans .ans-head { display:flex; gap:0.35rem; align-items:baseline; flex-wrap:wrap; }
  .ans .ans-id { font-family:var(--mono); font-size:0.68rem; color:var(--faint); }
  .ans .ans-v { font-weight:600; }
  .ans .ans-st { display:block; color:var(--muted); }
  .ans .ans-hist { display:block; color:var(--faint); font-size:0.68rem; }
  .alarm { border:1px solid var(--accent); background:var(--accent-soft); border-radius:7px;
           padding:0.35rem 0.45rem; margin:0.4rem 0; font-size:0.72rem; }
  .alarm code { font-family:var(--mono); font-size:0.66rem; }
`;

/**
 * The Agents tab's page frame: the persistent header, and a wrapper whose width is
 * the view's own choice — the table wants the whole window, the record reads better
 * in a column.
 *
 * The live view on /session/log stays an iframe because that view is generated by a
 * different tool on its own watch loop — wrapping it means the merge costs neither
 * generator a line of layout, and nothing in it can be lost in translation.
 */
const agentsPage = (body, { lastLook = null, wrap = 'ag-wrap' } = {}) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Agents · obot</title>
<style>${OBOT_CSS}${SHELL_CSS}${NAV_CSS}${ROSTER_CSS}${TABLE_CSS}${METRICS_CSS}${LOG_CSS}
</style>
</head>
<body>
<header class="top">
  <span class="brand">🍊😺 obot</span>
  ${tabs('session')}
  <span class="spacer"></span>
  <span class="where" title="${esc(lastLookTitle(lastLook))}"><span class="wide">local only · </span>${esc(phrase(lastLook))}</span>
</header>
<div class="${esc(wrap)}">
${body}
</div>
</body>
</html>`;

/**
 * The Agents tab — a table with a filter sidebar, one row per agent
 * (@jwildfire, 2026-08-17; jwildfire/obot.roadmap#227, jwildfire/obot.agent#154).
 *
 * Literally that and nothing beside it. The brief that shipped the night before —
 * headline tiles, the what-changed feed, the running and ended-badly groups — was
 * the third build of this view to interpret the ask instead of meeting it, so its
 * pieces move to /session/log rather than sitting above the table he asked for. The
 * sidebar carries the counts the tiles carried, and it carries them live: "12 of 36
 * · $80.22" answers the same question as a tile and answers it about the rows he is
 * actually looking at.
 *
 * `roster` is the MODEL; a roster that could not be assembled arrives as a string
 * and says so in place of the page rather than rendering an empty one that reads
 * as "no agents". The record link is the page's frame and survives every state.
 */
export function sessionShell({ roster = null, feed = [], lastLook = null, now = new Date(), pins = undefined } = {}) {
  // A roster that could not be assembled arrives as a string and says so; an
  // assembled-but-empty one goes through `emptyRoster`, which reads the model's
  // own source flags and separates "the ledger is here and empty" from "there is
  // no ledger to read". Both used to print the first sentence, and on a machine
  // with no history that is a claim about a file nobody opened (hub#223).
  const ok = roster && typeof roster === 'object' && Array.isArray(roster.rows) && roster.rows.length;
  const body = ok
    ? agentsTableHtml(roster, { now, ...(pins ? { pins } : {}) })
    : `<p class="ag-empty">${esc(String(typeof roster === 'string' ? roster : emptyRoster(roster)))}</p>
<p class="ag-more"><a href="/session/log">The full record →</a></p>`;
  return agentsPage(body, { lastLook, wrap: 'at-wrap' });
}

/**
 * The full record — /session/log, written for the readers who come to check one
 * thing against another: what changed as a feed, every agent grouped by outcome,
 * every delivery verdict and every Navigator call from the typed journal, the
 * pre-ledger fold, and the old session-level live view.
 *
 * The feed and the outcome groups live here rather than on the tab because the tab
 * is a table now. Nothing that shipped is discarded; it is one click away, and the
 * table links it.
 */
export function sessionLogShell({ roster = null, delivery = { verdicts: [], calls: [] }, feed = [], frame = '/session/frame', missing = null, lastLook = null } = {}) {
  const rosterBody = roster && typeof roster === 'object' && Array.isArray(roster.rows)
    ? rosterHtml(roster)
    : `<p class="ag-empty">${esc(String(roster ?? 'The roster could not be assembled.'))}</p>`;
  const live = missing
    ? `<p class="why">No session view yet — start the watch loop: <code>${esc(missing)}</code></p>`
    : `<p class="why">The session-level view, kept for its history. Its AGENTS card counts sessions reporting into the session hub, which is a different population from the agents above — expect the two numbers to differ.</p>
    <iframe title="Session hub" src="${esc(frame)}" loading="lazy"></iframe>`;
  const body = `<p class="reclink"><a href="/session">← The agents table</a></p>
${feedHtml(feed)}
${rosterBody}
${deliveryTablesHtml(delivery)}
<details class="livewrap">
  <summary>Live session view</summary>
  ${live}
</details>`;
  return agentsPage(body, { lastLook });
}

const NAV_CSS = `
  .nav-wrap { padding:0.7rem 0.8rem; max-width:60rem; }
  .swept { font-size:0.72rem; color:var(--faint); font-family:var(--mono); margin:0 0 0.7rem; }
  .nav-h { font-size:0.66rem; letter-spacing:0.11em; text-transform:uppercase; color:var(--faint);
           font-weight:500; margin:0.9rem 0 0.3rem; }
  .nav-list { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:0.15rem; }
  .nav-list li { border-left:3px solid var(--line); padding:0.2rem 0.4rem; font-size:0.82rem; line-height:1.3; }
  .nav-list li a { text-decoration:none; }
  .nav-list .at { color:var(--faint); font-family:var(--mono); font-size:0.68rem; }
  .nav-empty { font-size:0.76rem; color:var(--muted); margin:0; overflow-wrap:anywhere; }
  .nav-empty code { font-family:var(--mono); font-size:0.74rem; overflow-wrap:anywhere; }

  /* A row that carries its own evidence. Closed it costs one line, which is the
     budget on a 390px screen; open it lists what the claim rests on. */
  .nav-list li details > summary { cursor:pointer; }
  .nav-list li details[open] > summary { color:var(--ink); }
  .nav-sub { list-style:none; margin:0.2rem 0 0.35rem; padding:0; display:flex; flex-direction:column; gap:0.1rem; }
  .nav-sub li { border-left:2px solid var(--line); padding:0.05rem 0.45rem; font-size:0.72rem;
                color:var(--muted); line-height:1.35; }
  /* A reference, a URL or a long agent name must wrap rather than push the page
     sideways — 390px is a gate here, not a nicety. */
  .nav-list li, .nav-sub li, .nav-list summary { overflow-wrap:anywhere; }

  .reclink { font-size:0.74rem; margin:0 0 0.5rem; }
  .reclink a { text-decoration:none; }
  .reclink-why { color:var(--faint); font-size:0.68rem; }

  /* The ledger verdicts: quiet when clean, unmissable when not. */
  .lstat { font-size:0.68rem; color:var(--faint); font-family:var(--mono); margin:0 0 0.35rem; overflow-wrap:anywhere; }
  .lstat-d { display:block; color:var(--faint); opacity:0.8; padding-left:0.8rem; }
  .nav-list li.nav-h3 { border-left:0; padding:0.5rem 0 0.1rem; font-size:0.64rem; letter-spacing:0.1em;
                        text-transform:uppercase; color:var(--muted); font-weight:600; }
  .nav-list li.nav-note { border-left-color:transparent; color:var(--muted); font-size:0.74rem; }
  .nav-list li.nav-alarm { border-left-color:var(--accent); background:var(--accent-soft); }
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
/** One bullet: its link, its text, and the verification stamp as small print. */
const navItem = (it) => `${it.url
  ? `<a href="${esc(it.url)}" target="_blank" rel="noopener">${esc(it.text)}</a>`
  : esc(it.text)}${it.verified ? ` <span class="at">${esc(it.verified)}</span>` : ''}`;

/**
 * A section, as both tabs render it. A row carrying details becomes a disclosure —
 * the summary is the claim, the list inside it is the evidence — so a roster row can
 * say "1 requirement moved, 3 closed or merged" on one line and still hand over
 * every issue number behind it.
 */
export const sectionsHtml = (sections = []) => sections.map((s) => `<h2 class="nav-h">${esc(s.title)}</h2>
${s.items.length
    ? `<ul class="nav-list">${s.items.map((it) => {
      if (it.heading) return `<li class="nav-h3">${esc(it.text)}</li>`;
      const cls = [it.alarm ? 'nav-alarm' : '', it.note && !it.alarm ? 'nav-note' : ''].filter(Boolean).join(' ');
      const attr = cls ? ` class="${cls}"` : '';
      return (it.details ?? []).length
        ? `<li${attr}><details><summary>${navItem(it)}</summary><ul class="nav-sub">${
          it.details.map((d) => `<li>${navItem(d)}</li>`).join('')}</ul></details></li>`
        : `<li${attr}>${navItem(it)}</li>`;
    }).join('')}</ul>`
    : '<p class="nav-empty">Nothing.</p>'}`).join('\n');

/**
 * The sweep's preamble notes — the config-ledger and worker-ledger verdicts.
 * Wired since 2026-08-16 morning, renderable since 2026-08-16 night: the old
 * parser dropped everything above the first heading, so a ledger gap could fire
 * every five minutes and never reach a page. An alarm gets the banner; a clean
 * verdict gets one line of small print, because a detector that only ever speaks
 * on failure is indistinguishable from a dead one (the sweep's own rule).
 */
export const ledgerNotes = (state, { full = false } = {}) => (state?.notes ?? []).map((n) => (n.alarm
  ? `<p class="dead">${esc(n.text)}${n.details.length ? ` — ${esc(n.details.map((d) => d.text).join(' · '))}` : ''}</p>`
  : `<p class="lstat">${esc(n.text)}${full && n.details.length
    ? n.details.map((d) => `<span class="lstat-d">${esc(d.text)}</span>`).join('')
    : ''}</p>`)).join('\n');

/** The sweep's proof-of-life header, shared by both Navigator views: the dead-observer
 * banner when stale, the one-line swept stamp when alive. The stale rule is the one
 * thing neither view may lose — this is the surface he would trust to say a review
 * landed, and presenting a dead observer's content as current is the failure mode. */
const sweepHead = (state, missing, unreadable = null) => {
  // Before absence: the file may be right there and unopenable. That is a fault in
  // the reader, and it gets the loud banner rather than the tidy first-morning
  // sentence — the sweep's whole job is to be believed about what is current, and
  // presenting an unread observer as an un-run one is the same lie as a dead one
  // presented as alive (jwildfire/obot.agent#206).
  if (unreadable) {
    return `<p class="dead"><strong>The sweep file could not be read</strong> — ${esc(unreadable.why)}. The sweep may well be running and current; this page cannot see it, so nothing below is a statement about the Navigator.</p>`;
  }
  if (missing || !state) {
    // The remedy has to work on the machine that is reading it. On a new one the
    // LaunchAgent has never been installed, so `launchctl kickstart` answers
    // `Could not find service "com.obot.navigator-sweep"` — the absence was stated
    // honestly and the half that says how to fill it was wrong, which is the half
    // this requirement cares about most (jwildfire/obot.roadmap#223).
    return `<p class="nav-empty">No sweep file yet — <code>${esc(missing ?? 'navigator-state.md')}</code>. The Navigator writes it every five minutes once installed: <code>obot.agent/tools/navigator/install-launchd</code>, then <code>launchctl kickstart -k gui/$UID/com.obot.navigator-sweep</code> to nudge it.</p>`;
  }
  if (state.stale) {
    return `<p class="dead"><strong>The observer is dead</strong> — last swept ${esc(state.sweptAt ?? 'never')}${state.ageMin === null ? '' : ` (${state.ageMin} min ago, cadence ${state.cadenceMin}m)`}. What follows is <strong>not current</strong>. Restart: <code>launchctl kickstart -k gui/$UID/com.obot.navigator-sweep</code></p>`;
  }
  // A sweep can fail and still be recent: the writer puts FAILED in the head line
  // and keeps serving the last good queue. Age alone misses that, and small grey
  // print is where the one sentence that matters goes to die.
  if (/FAILED/.test(state.summary ?? '')) {
    return `<p class="dead"><strong>The sweep is failing</strong> — ${esc(state.summary)}. Last attempt ${esc(state.sweptAt ?? 'unknown')}.</p>`;
  }
  return `<p class="swept">swept ${esc(state.sweptAt)}${state.summary ? ` · ${esc(state.summary)}` : ''}</p>`;
};

/**
 * The Wire tab (#203) — the same page frame as the Navigator tab, deliberately.
 *
 * Moving between spine tabs must not move the text under him: one column, one
 * measure, one header. The only thing that changes is which of the four questions
 * the body answers.
 *
 * `look` is the visit record read BEFORE this request was recorded, which is the
 * whole mechanism — a page that read it afterwards would say "just now" on every
 * visit and the signal would mean nothing (last-seen.mjs says the same).
 */
export const wirePage = (feed, look, lastLook) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Wire · obot</title>
<style>${OBOT_CSS}${SHELL_CSS}${NAV_CSS}${METRICS_CSS}${WIRE_CSS}
</style>
</head>
<body>
<header class="top">
  <span class="brand">🍊😺 obot</span>
  ${tabs('wire')}
  <span class="spacer"></span>
  <span class="where" title="${esc(lastLookTitle(lastLook))}"><span class="wide">local only · </span>${esc(phrase(lastLook))}</span>
</header>
<div class="nav-wrap">
${wireHtml(feed, look)}
</div>
</body>
</html>`;

const navigatorPage = (body) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Navigator · obot</title>
<style>${OBOT_CSS}${SHELL_CSS}${NAV_CSS}${METRICS_CSS}
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

/**
 * The Navigator tab, for a reader who was not present: release metrics first
 * (jwildfire/obot.roadmap#218 — "Show me key release metrics … in the last
 * 1/3/7/30/365 days"), then the sweep's typed events as a what-changed feed.
 *
 * Nothing the old view carried is deleted: the full record — RC queue, delivery
 * verdicts, discipline findings, ledger audits — lives whole at /navigator/record
 * for its dense readers, and the link here is how he reaches it when a number
 * needs its receipts.
 */
export function navigatorShell({ state = null, missing = null, unreadable = null, metrics = null, feed = [] } = {}) {
  const body = `${sweepHead(state, missing, unreadable)}
${ledgerNotes(state)}
<p class="reclink"><a href="/navigator/record">Full sweep record →</a> <span class="reclink-why">the RC queue, delivery verdicts and discipline findings, whole — what these numbers are built beside</span></p>
${metricsHtml(metrics)}
${feedHtml(feed)}`;
  return navigatorPage(body);
}

/**
 * The full sweep record — the pre-2026-08-16 Navigator tab, kept whole. Its
 * readers are the agents that read the state file densely, and him when a metric
 * needs its receipts; every `##` section in the state file still renders as
 * itself, including ones this code has never heard of.
 */
export function navigatorRecordShell({ state = null, missing = null, unreadable = null } = {}) {
  const body = `${sweepHead(state, missing, unreadable)}
${ledgerNotes(state, { full: true })}
<p class="reclink"><a href="/navigator">← Metrics and what changed</a></p>
${state && !missing ? sectionsHtml(state.sections) : ''}`;
  return navigatorPage(body);
}

/**
 * What the page says when nothing is listening for his answers.
 *
 * Shared with the server so the sentence he reads after clicking and the sentence
 * on the row are the same sentence. This is the failure the program keeps paying
 * for in other forms — green CI over a stale evidence baseline, a widget
 * rendering a pre-fix calculation for three weeks — so a hand-off with no
 * consumer has to look like a problem, not like success.
 */
export const NOT_LISTENING = 'Nothing is listening: the Navigator sweep is not running, so no agent will pick this up. Restart it with launchctl kickstart -k gui/$UID/com.obot.navigator-sweep';

const AGO = (at, now) => {
  const min = Math.max(0, Math.round((now.getTime() - Date.parse(at)) / 60000));
  if (!Number.isFinite(min)) return '';
  return min < 60 ? `${min}m ago` : `${Math.floor(min / 60)}h ago`;
};

const VERDICT = {
  'adopt-all': 'adopt all',
  'words-only': 'in your words',
  'per-question': 'question by question',
};

/**
 * One answer, with where it is in the pipeline. The three states are his three
 * questions: did the machine take it (captured), did anything see it (delivered),
 * did the artifact change (applied — and here is the link, go look).
 */
const answerRow = (a, now, late = null) => {
  // A promise with no expiry is how 2026-08-16 lasted nine hours. `delivered` said
  // "an agent has it; the artifact updates next" for the whole of it, at every
  // refresh, with no bar it could ever fail — so past the bar the row stops
  // promising and starts reporting (jwildfire/obot.roadmap#241).
  const state = late
    ? (late.condition === 'dropped'
      ? `past the hour — announced to the fleet ${AGO(late.at, now)} and the artifact still has not changed`
      : `past the hour — nothing has picked it up, so the Navigator sweep is the suspect rather than an agent`)
    : {
      captured: 'the Navigator picks it up within five minutes',
      delivered: 'an agent has it; the artifact updates next',
      applied: 'the artifact was updated',
    }[a.status] ?? a.status;
  const when = a.status === 'applied' ? (a.appliedAt ?? a.at) : a.at;
  const evidence = a.status === 'applied' && a.evidence
    ? ` — <a href="${esc(a.evidence)}" target="_blank" rel="noopener">see it</a>`
    : '';
  const history = (a.supersedes ?? []).length
    ? `<span class="ans-hist">replaced an earlier answer${(a.clicks ?? 1) > 1 ? `, clicked ${a.clicks} times` : ''}</span>`
    : ((a.clicks ?? 1) > 1 ? `<span class="ans-hist">clicked ${a.clicks} times — one answer</span>` : '');
  return `<li class="ans" data-status="${esc(a.status)}">
      <span class="ans-head"><span class="ans-id mono">${esc(a.decisionId ?? a.artifact ?? '')}</span><span class="ans-v">${esc(VERDICT[a.verdict] ?? a.verdict ?? '')}</span></span>
      <span class="ans-st">${esc(a.status)} ${esc(AGO(when, now))} · ${state}${evidence}</span>
      ${history}
    </li>`;
};

const answersPanel = (answers, deliverer, now) => {
  const waiting = answers.filter((a) => a.status === 'captured');
  // The other failure entirely, and the one that actually happened
  // (jwildfire/obot.roadmap#241). The alarm below counts `captured` — answers nothing
  // ever picked up — so an answer that WAS picked up and then dropped could never
  // reach it. All three of the 2026-08-16 answers were `delivered` inside six
  // minutes, which made that alarm structurally unreachable for the exact incident it
  // would have been useful for.
  const late = unappliedDetections(answers, { now });
  const lateById = new Map(late.map((d) => [d.id, d]));
  const stuck = late.length
    ? `<p class="alarm"><strong>${late.length} answer${late.length === 1 ? '' : 's'} of yours ${late.length === 1 ? 'is' : 'are'} past the hour and the artifact has not changed.</strong>
      ${late.map((d) => `${esc(d.name)} (${esc(AGO(d.at, now))})`).join(' &middot; ')}.
      Each one is on the Navigator's wake channel, which reaches an agent rather than sitting in a file — that is what was missing on 16 August.
      If a row here still says this at your next look, what is missing is an agent to apply it, not your answer.</p>`
    : '';
  // `alive === false` is a fact and earns the alarm. `alive === null` is this process
  // not knowing, and an accusation made out of not knowing is worse than silence — it
  // sends him to restart a service that is fine (jwildfire/obot.agent#215).
  const alarm = waiting.length && deliverer?.alive === false
    ? `<p class="alarm"><strong>${waiting.length} answer${waiting.length === 1 ? '' : 's'} of yours ${waiting.length === 1 ? 'is' : 'are'} going nowhere.</strong>
      Nothing is listening — the Navigator sweep is not running${deliverer?.sweptAt ? ` (last swept ${esc(deliverer.sweptAt)})` : ''}, so no agent will pick ${waiting.length === 1 ? 'it' : 'them'} up.<br>
      <code>launchctl kickstart -k gui/$UID/com.obot.navigator-sweep</code></p>`
    : (waiting.length && deliverer?.alive === null
      ? `<p class="q-unread">Whether anything is listening could not be determined — ${esc(deliverer.why ?? 'the sweep\u2019s state file could not be read')}. The sweep may well be running; nothing here is a claim that it is not.</p>`
      : '');
  return `<div class="answers">
      <h2>Your answers <span class="q-n">${answers[STORELESS] ? UNMEASURED : answers.length}</span></h2>
      ${stuck}
      ${alarm}
      <ul class="ans-list">${answers.length
    ? answers.map((a) => answerRow(a, now, lateById.get(a.id))).join('')
    : `<li class="q-empty">${answers[STORELESS]
      ? 'No answer store on this machine yet — it appears the first time you answer a decision here.'
      : 'Nothing recorded yet. Answer a decision and it appears here with its state.'}</li>`}</ul>
    </div>`;
};

/**
 * The loudest thing this page can say about itself: its own readers have been replaced.
 *
 * Every number below a disarmed reader is a guess, so this is a page-level statement
 * and it goes above the header rather than into a panel. It is deliberately not about
 * any particular culprit — the check is "are these the functions this process started
 * with", which catches whatever arms itself next (jwildfire/obot.agent#215, after
 * #206 where a guard from the public build did exactly this and every panel reported
 * the result as ordinary emptiness).
 */
const integrityBanner = (integrity) => (!integrity || integrity.intact ? '' : `<p class="dead">
  <strong>This page cannot be trusted right now.</strong> Something has replaced this server's own file readers
  (${esc(integrity.replaced.join(', '))}), so every count below may be an empty list standing in for a failed read.
  Restart the dashboard and, if it comes back, treat it as a repeat of
  <a href="https://github.com/jwildfire/obot.agent/issues/206">#206</a>.</p>`);

export function render({ queue, answers = [], deliverer = null, provenance = null, lastLook = null, integrity = null, rankHead = null, delivered = null, workspace, hub, generated = new Date() }) {
  const critical = queue.critical ?? [];
  const snoozed = queue.snoozed ?? [];
  const cleared = queue.cleared ?? [];
  // The header pills count what is actually waiting on him, pinned rows
  // included — the critical section moves rows between sections, and a count
  // that moved with them would make the queue look shorter than it is.
  const counts = {
    rc: queue.rcs.items.length + critical.filter((i) => i.kind === 'rc').length,
    config: queue.config.items.length + critical.filter((i) => i.kind === 'config').length,
    decision: queue.decisions.items.length + critical.filter((i) => i.kind === 'decision').length,
  };
  const total = counts.rc + counts.config + counts.decision;

  // Whether each collector actually opened its source. A count is a measurement,
  // and a page may print one only where it made one: on a machine with no hub
  // clone, no config list and no completed sweep, "0 · 0 · 0 — nothing is waiting
  // on you" is three zeros and a verdict standing in for three files nobody read
  // (jwildfire/obot.roadmap#223). Two of the three collectors already returned the
  // reason; only the decisions one ever reached the page, four elements below a
  // heading that contradicted it.
  // The collectors already know whether they read their source; the view used to
  // re-derive it from `error` and get a different answer. `collectRCs` deliberately
  // reports `error: null` when there is no cache but a sweep script exists, so
  // `!error` came out true with zero items and the header stated `0 release
  // candidates` about a number nobody had measured (jwildfire/obot.agent#215).
  // `??` rather than `||`: a fixture that carries no `read` field keeps the old
  // behaviour, a collector that says `read: false` is believed.
  const read = {
    rc: queue.rcs?.read ?? !queue.rcs?.error,
    decision: queue.decisions?.read ?? !queue.decisions?.error,
    config: queue.config?.read ?? !queue.config?.error,
  };
  // An unread source always carries a reason. `collectRCs` leaves `error` null on the
  // never-swept path, and a `—` with an empty tooltip is a worse answer than a zero.
  const sourceWhy = {
    rcs: queue.rcs?.error ?? (read.rc ? '' : 'no GitHub sweep has completed on this machine yet, so there is no count to show'),
    decisions: queue.decisions?.error ?? '',
    config: queue.config?.error ?? '',
  };
  const allRead = read.rc && read.decision && read.config;

  // What each group says when it is empty — and it depends on whether it is empty
  // or merely unread. "All answered" about a decision log that was never opened is
  // the same class of statement as "$0.00 spent" over an absent usage artifact.
  const rcEmpty = queue.rcs?.error
    ? nothingYet('No GitHub sweep has completed on this machine', `${queue.rcs.error}; release candidates cannot be listed until one does`)
    : (queue.rcs.refreshing ? 'Sweeping GitHub…' : 'None waiting.');
  const decisionEmpty = queue.decisions?.error
    ? nothingYet('Open decisions could not be read', `${queue.decisions.error}; clone jwildfire/obot.roadmap beside obot.agent and reload`)
    : 'All answered.';
  // Absent and unreadable get different sentences AND different remedies. Telling him
  // to capture his first config item, when the ten he has are sitting in a file this
  // process could not open, is the failure the requirement is named for. Anything
  // that is not explicitly `absent` is treated as a fault — when in doubt, be loud.
  const configEmpty = queue.config?.error
    ? (queue.config.absent === true
      ? nothingYet(
        'No config list on this machine yet',
        'every setup step this machine needs would be listed in .claude/blockers.md, which is local and does not travel between machines; capture the first with obot.agent/tools/blocker-log',
      )
      : nothingYet(
        `The config list could not be read — ${queue.config.error}`,
        'this list is not empty, it is unread; nothing here can be trusted to say whether something needs you until the read succeeds',
      ))
    : 'Nothing needs your keyboard.';
  // The sweep's age, when it has one and a newer attempt has since failed. Computed
  // and then discarded until now, so an offline machine read a six-hour-old queue
  // as if it were now.
  const rcAge = read.rc && queue.rcs.refreshing && queue.rcs.items.length && ageWords(queue.rcs.ageMin)
    ? `<p class="q-stale">Swept ${esc(ageWords(queue.rcs.ageMin))}; the refresh since has not completed, so this list may be out of date.</p>`
    : '';

  // Everything the page needs to show an item without another round trip: the
  // installation qualification for config rows, and how a check may be run.
  const iqs = Object.fromEntries([...critical, ...queue.config.items]
    .filter((it) => it.kind === 'config' && it.iq)
    .map((it) => [it.key, {
      id: it.id, title: it.title, filed: it.date, verified: it.verified,
      complete: it.complete ?? null,
      claim: it.criticalClaim ?? null,
      // The card at /config/<id> carries the item's prose now, so the page does not
      // also ship it: the sidebar needs the check and the sentence describing it.
      verify: {
        command: it.iq.verify?.command ?? null,
        expect: it.iq.verify?.expect ?? null,
        text: it.iq.verify?.text ?? null,
        manual: Boolean(it.iq.verify?.manual),
      },
      check: it.check ?? null,
      // The same sentence the row shows, computed once on the server. Two surfaces
      // phrasing one reading differently is how "unknown" turns back into "failed".
      currency: it.currency ?? null,
    }]));

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Operations Dashboard · obot</title>
<style>${OBOT_CSS}${SHELL_CSS}${DASHBOARD_CSS}
</style>
</head>
<body>

${integrityBanner(integrity)}
<header class="top">
  <span class="brand">🍊😺 Operations</span>
  ${tabs('ops')}
  <span class="counts">
    <span class="pill rc"${read.rc ? '' : ` title="${esc(sourceWhy.rcs)}"`}>${read.rc ? counts.rc : UNMEASURED} release candidate${read.rc && counts.rc === 1 ? '' : 's'}</span>
    <span class="pill decision"${read.decision ? '' : ` title="${esc(sourceWhy.decisions)}"`}>${read.decision ? counts.decision : UNMEASURED} decision${read.decision && counts.decision === 1 ? '' : 's'}</span>
    <span class="pill config"${read.config ? '' : ` title="${esc(sourceWhy.config)}"`}>${read.config ? counts.config : UNMEASURED} config</span>
  </span>
  <span class="spacer"></span>
  <span class="where" title="${esc(lastLookTitle(lastLook))}"><span class="wide">local only · ${esc(generated.toTimeString().slice(0, 5))} · </span>${esc(phrase(lastLook))}</span>
</header>

<div class="cols">

  <nav class="rail" aria-label="Your queue">
    ${provenanceLine(provenance ?? {})}
    ${total === 0 ? `<p class="q-empty">${esc(allRead
      ? 'Nothing is waiting on you.'
      : nothingYet('Nothing has been read on this machine yet', `${unreadNames(read)} could not be collected, so this page is not saying the queue is empty — it is saying it has not been able to look`))}</p>` : ''}
    ${critical.length ? group('Critical', critical, '') : ''}
    ${queue.overBudget ? `<p class="overbudget">${queue.overBudget} more item${queue.overBudget === 1 ? '' : 's'} claim${queue.overBudget === 1 ? 's' : ''} critical. The tag is capped at ${CRITICAL_BUDGET} so it keeps meaning something — the rest are at the top of their own sections.</p>` : ''}
    ${group('Release candidates', queue.rcs.items, rcEmpty, queue.rcs.moved, read.rc)}
    ${rcAge}
    ${standardLane(queue.rcs.standard)}
    ${group('Decisions', queue.decisions.items, decisionEmpty, queue.decisions.moved, read.decision)}
    ${foldedLane(queue.decisions.folded)}
    ${group('Config', queue.config.items, configEmpty, queue.config.moved, read.config)}
    ${clearedLine(queue.config.cleared)}
    ${collapsed('Snoozed', snoozed, (it) => wakeText(it.triage))}
    ${collapsed('Cleared', cleared, (it) => (it.triage?.action === 'done' ? 'marked done' : 'dismissed'))}
    ${rankHeadPanel(rankHead)}
    ${deliveredPanel(delivered, generated)}
  </nav>

  <main class="main" id="main">
    <div class="placeholder" id="placeholder">
      ${allRead ? '' : `<div class="firstday">
        <h2>Nothing has been collected on this machine yet.</h2>
        <p>The page is working; the record is not here. Each list fills itself once its source exists:</p>
        <ul>
          ${read.rc ? '' : '<li><strong>Release candidates</strong> — a GitHub sweep has to complete. Authenticate with <code>gh auth login</code>, then reload.</li>'}
          ${read.decision ? '' : '<li><strong>Decisions</strong> — clone <code>jwildfire/obot.roadmap</code> beside <code>obot.agent</code>; the dashboard reads the clone, not the published site.</li>'}
          ${read.config ? '' : '<li><strong>Config</strong> — <code>.claude/blockers.md</code> is local to a machine and does not travel. File this machine\'s first setup step with <code>obot.agent/tools/blocker-log</code>.</li>'}
        </ul>
      </div>`}
      <h2>Your todo list, and where you answer it.</h2>
      <p>The top of the list is already open. Anything else is one click on the left: a <strong>decision</strong> and a <strong>config</strong> item each open as the page they were written as, and you answer or check them in the sidebar; a <strong>release candidate</strong> opens as its summary, release notes, what it closes, and its demo page running live, with approval still a deliberate click on GitHub. Local, never published.</p>
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
      <p class="note">${deliverer?.alive === false
    ? 'Nothing is listening yet — the Navigator sweep is not running on this machine, so an answer recorded here will sit unread until it is installed: <code>obot.agent/tools/navigator/install-launchd</code>.'
    : (deliverer?.alive === null
      ? 'Your click is recorded on this machine. Whether the Navigator is listening could not be determined from here, so this page is not promising it will be picked up within five minutes — only that it is written down.'
      : 'Your click is recorded on this machine, handed to an agent by the Navigator within five minutes, and applied to the artifact — you can watch all three below.')}</p>
      <p class="ok" id="ok" hidden></p>
    </div>
    <div class="config-check" id="config-check" hidden></div>
    <div class="triage" id="triage" hidden>
      <div class="row">
        <button id="tri-done" hidden>Done</button>
        <button id="tri-snooze">Snooze</button>
        <button id="tri-dismiss">Dismiss</button>
      </div>
      <div class="snooze-menu" id="snooze-menu" hidden>
        <button data-snooze="1d">a day</button>
        <button data-snooze="1w">a week</button>
        <button data-snooze="change">until it changes</button>
      </div>
      <p class="means" id="tri-means"></p>
    </div>
    ${answersPanel(answers, deliverer, generated)}
  </aside>

</div>

<script id="questions-data" type="application/json">${
  JSON.stringify(Object.fromEntries([...critical, ...queue.decisions.items]
    .filter((d) => d.kind === 'decision').map((d) => [d.artifact, d.questions ?? []])))
    .replace(/</g, '\\u003c')
}</script>
<script id="iq-data" type="application/json">${
  JSON.stringify(iqs).replace(/</g, '\\u003c')
}</script>
<script id="dismiss-data" type="application/json">${
  JSON.stringify(DISMISS_MEANS).replace(/</g, '\\u003c')
}</script>
<script id="rc-data" type="application/json">${
  JSON.stringify(Object.fromEntries(queue.rcs.items.map((r) => [r.key, {
    title: r.title, url: r.url, sub: r.sub ?? null, checks: r.checks ?? null,
    size: r.size ?? null, repo: r.repo ?? null, ...(r.rc ?? {}),
  }]))).replace(/</g, '\\u003c')
}</script>
<script>
  const QUESTIONS = JSON.parse(document.getElementById('questions-data').textContent);
  const IQ = JSON.parse(document.getElementById('iq-data').textContent);
  const DISMISS = JSON.parse(document.getElementById('dismiss-data').textContent);
  const RCS = JSON.parse(document.getElementById('rc-data').textContent);
  const state = { item: null, verdict: null, perQuestion: {} };
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };

  // The check, in the sidebar, because the main pane now holds the card itself.
  //
  // What the card cannot carry: it is a static page, and only this server can run a
  // command and write the result down. So the two halves split by what each is for —
  // the reading is the artifact, the acting is here, beside the triage buttons that
  // were already the sidebar's job.
  function renderCheck(key) {
    const box = $('config-check');
    box.innerHTML = '';
    const iq = IQ[key];
    if (!iq || !iq.verify) { box.hidden = true; return; }
    box.hidden = false;
    box.appendChild(el('span', 'lab', 'The proof'));
    if (iq.verify.text) box.appendChild(el('p', 'cc-what', iq.verify.text));
    box.appendChild(checkRow(key, iq));
    if (iq.complete && iq.complete.ok === false) {
      box.appendChild(el('p', 'iq-warn', 'This entry is missing ' + iq.complete.missing.join(' and ') + ' — it was filed before the list carried a check.'));
    }
  }

  function copyBtn(text) {
    const b = el('button', 'copy', 'copy');
    b.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(text); b.textContent = 'copied'; }
      catch { b.textContent = 'select it'; }
      setTimeout(() => { b.textContent = 'copy'; }, 1500);
    });
    return b;
  }

  // Running the proof. A read-only command runs here on a click and the result
  // is recorded; anything else is his to run, and says so rather than pretending
  // the button is broken.
  function checkRow(key, iq) {
    const row = el('div', 'iq-check');
    if (iq.verify.command) row.appendChild(copyBtn(iq.verify.command));
    const btn = el('button', null, 'Check');
    const out = el('span', 'iq-res');
    if (iq.currency) { out.textContent = iq.currency.phrase; out.classList.add(iq.currency.state); }
    else if (iq.check) { out.textContent = iq.check.result + ' · ' + (iq.check.at || '').slice(11, 16); out.classList.add(iq.check.result); }
    btn.addEventListener('click', async () => {
      btn.disabled = true; out.className = 'iq-res'; out.textContent = 'running…';
      const r = await fetch('/check', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key: key, id: iq.id, command: iq.verify.command, expect: iq.verify.expect }) });
      const j = await r.json().catch(() => ({}));
      btn.disabled = false;
      out.classList.add(j.result || 'refused');
      // A failure has to say what was expected. "exit 1" tells him nothing he
      // can act on; "printed 0, expected 2" tells him the edit did not land.
      // Three outcomes, never two. An unknown is a command that never produced an exit
      // status — not installed, or killed by the timeout — and reporting it as FAIL
      // would be a measurement nobody took (obot.agent#262).
      out.textContent = j.result === 'pass' ? 'PASS — ' + (j.stdout || 'exit 0')
        : j.result === 'fail'
          ? 'FAIL — ' + (j.stdout ? 'printed ' + j.stdout : 'exit ' + j.exitCode)
            + (iq.verify.expect ? ', expected ' + iq.verify.expect.replace(/^prints /, '') : '')
          : 'NOT CHECKED — ' + (j.why || 'could not run');
      if (j.result === 'pass') $('tri-done').hidden = false;
    });
    if (iq.verify.manual || !iq.verify.command) {
      btn.disabled = true;
      row.appendChild(btn);
      row.appendChild(el('span', 'iq-res refused', 'manual — nothing here can be scripted'));
    } else {
      row.appendChild(btn);
      row.appendChild(out);
    }
    return row;
  }

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

    // Triage is available on every kind, because he asked to be able to clear
    // or defer anything in the list — not only the config half of it.
    state.item.fingerprint = li.dataset.fp || null;
    $('triage').hidden = false;
    $('snooze-menu').hidden = true;
    $('tri-done').hidden = kind !== 'config';
    $('tri-means').textContent = DISMISS[kind] || '';

    if (kind === 'decision') {
      $('placeholder').hidden = true;
      $('config-check').hidden = true;
      // The RC panel owns an iframe of its own inside #main, so it goes before the
      // artifact frame is looked up by selector.
      const panel = $('rc-panel'); if (panel) panel.remove();
      let f = document.querySelector('#main > iframe');
      if (!f) { f = document.createElement('iframe'); f.title = 'Decision artifact'; $('main').appendChild(f); }
      f.src = '/artifact/' + encodeURIComponent(li.dataset.artifact) + '/';
      $('answer').hidden = false;
      $('side-hint').textContent = 'Adopt all is one click. Otherwise pick a verdict and say why.';
    } else if (kind === 'rc') {
      $('answer').hidden = true;
      $('config-check').hidden = true;
      renderRC(li.dataset.key);
      $('side-hint').textContent = 'Skim it here, then approve on GitHub — the RC gate stays a deliberate click.';
    } else if (kind === 'config') {
      // The same treatment a decision gets, for the same reason: the artifact already
      // exists at /config/<id>, and rebuilding it here only produced a second version
      // of it that could disagree. @jwildfire, 2026-08-20: "show the html artifacts by
      // default - just like the decisions."
      $('answer').hidden = true;
      $('placeholder').hidden = true;
      const panel = $('rc-panel'); if (panel) panel.remove();
      let f = document.querySelector('#main > iframe');
      if (!f) { f = document.createElement('iframe'); $('main').appendChild(f); }
      f.title = 'Config artifact';
      f.src = '/config/' + encodeURIComponent((IQ[li.dataset.key] || {}).id || li.dataset.key);
      renderCheck(li.dataset.key);
      $('side-hint').textContent = 'Only your keyboard can apply this one. Run the check when you have.';
    } else {
      $('answer').hidden = true;
      const panel = $('rc-panel'); if (panel) panel.remove();
      $('side-hint').textContent = 'Nothing to show for this one.';
    }
  }

  // The release-candidate panel. @jwildfire asked for the PR itself in an iframe;
  // github.com answers x-frame-options: deny, so that renders blank permanently and
  // no amount of trying changes it. This is the native version, and it is the better
  // one: it opens instantly from the cache (so it works with the network down), it
  // matches the dashboard instead of dropping a foreign page into the middle of it,
  // and it shows his review order — skim the summary, read the demo, read the notes —
  // without the GitHub chrome around it. The demo page *is* framed live: Pages sets no
  // frame headers. Approving stays on GitHub, deliberately.
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function renderRC(key) {
    const rc = RCS[key];
    const main = $('main');
    $('placeholder').hidden = true;
    const old = main.querySelector(':scope > iframe'); if (old) old.remove();
    let box = $('rc-panel');
    if (!box) { box = document.createElement('div'); box.id = 'rc-panel'; box.className = 'rc-panel'; main.appendChild(box); }
    if (!rc) { box.innerHTML = '<p class="rc-none">No detail cached for this one yet — open it on GitHub.</p>'; return; }

    const checks = rc.checks
      ? '<span class="rc-checks ' + esc(rc.checks.state) + '">' + ({
          green: 'checks green', failing: rc.checks.failing + ' failing', pending: rc.checks.pending + ' running', none: 'no checks',
        }[rc.checks.state] || 'checks') + '</span>'
      : '';

    const reqs = (rc.requirements || []).length
      ? '<h3>Requirements this release closes</h3><ul class="rc-reqs">' + rc.requirements.map((r) =>
          '<li><a href="' + esc(rcIssueUrl(rc.repo, r.ref)) + '" target="_blank" rel="noopener">' + esc(r.ref) + '</a> ' + esc(r.text) + '</li>').join('') + '</ul>'
      : '<h3>Requirements this release closes</h3><p class="rc-none">None named in the body — the RC body contract wants a <code>Closes #N</code> line per issue shipped.</p>';

    const demo = rc.demo && rc.frameable
      ? '<h3>The demo</h3><iframe class="rc-demo" src="' + esc(rc.demo) + '" title="Release demo" loading="lazy"></iframe>'
      : rc.demo
        ? '<h3>The demo</h3><p class="rc-none"><a href="' + esc(rc.demo) + '" target="_blank" rel="noopener">Open the demo</a> — it is not on the Pages site, so it cannot be shown inline.</p>'
        : '<h3>The demo</h3><p class="rc-none">No demo link in the body. A PR without a working demo is not an RC.</p>';

    box.innerHTML =
      '<div class="rc-head"><h2>' + esc(rc.title) + '</h2>' + checks +
        (rc.size ? '<span class="rc-size">' + esc(rc.size) + '</span>' : '') + '</div>' +
      (rc.sub || rc.summary ? '<p class="rc-summary">' + esc(rc.summary || rc.sub) + '</p>' : '') +
      (rc.ask ? '<p class="rc-ask"><strong>The ask:</strong> ' + esc(rc.ask) + '</p>' : '') +
      '<p class="rc-links">' + (rc.news ? '<a href="' + esc(rc.news) + '" target="_blank" rel="noopener">Release notes (NEWS.md)</a>' : '<span class="rc-none">No NEWS.md link — the contract requires one.</span>') +
        ' · <a href="' + esc(rc.url) + '" target="_blank" rel="noopener">Open on GitHub to approve</a></p>' +
      reqs + demo;
  }

  const rcIssueUrl = (repo, ref) => repo ? 'https://github.com/' + repo + '/issues/' + String(ref).replace('#', '') : '#';

  // ---- triage -------------------------------------------------------------
  // Every action posts to the local server and the row leaves the list. Nothing
  // is deleted anywhere: the server appends to a ledger, and the row reappears
  // under Snoozed or Cleared with a way back.
  async function postTriage(body) {
    const r = await fetch('/triage', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (r.ok) location.reload();
    else { const j = await r.json().catch(() => ({})); $('tri-means').textContent = 'Could not record: ' + (j.error || r.status); }
  }

  $('tri-dismiss').addEventListener('click', () => {
    if (state.item) postTriage({ ...state.item, action: 'dismiss' });
  });
  $('tri-done').addEventListener('click', () => {
    if (state.item) postTriage({ ...state.item, action: 'done' });
  });
  $('tri-snooze').addEventListener('click', () => { $('snooze-menu').hidden = !$('snooze-menu').hidden; });
  document.querySelectorAll('#snooze-menu button').forEach((b) => b.addEventListener('click', () => {
    if (!state.item) return;
    const pick = b.dataset.snooze;
    const day = 86400000;
    // Every snooze carries a change-watch as well as its date, so an item that
    // moves under the snooze comes back on its own.
    postTriage({
      ...state.item, action: 'snooze', wakeOnChange: true,
      until: pick === 'change' ? null : new Date(Date.now() + (pick === '1d' ? day : 7 * day)).toISOString(),
    });
  }));
  document.querySelectorAll('.q-restore').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    postTriage({ key: b.dataset.key, kind: b.dataset.kind, action: 'restore' });
  }));

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

  document.querySelectorAll('.q:not(.q-off)').forEach((li) => li.addEventListener('click', () => select(li)));

  // Nothing is one click in. @jwildfire, 2026-08-20: "show the html artifacts by
  // default". The rail is already in the order he should work it, so the page opens
  // the top of it and the placeholder is what he sees only when there is nothing to
  // open — which is the one time it has anything to say.
  function selectFirst() {
    const first = document.querySelector('.rail .q:not(.q-off)');
    if (first) select(first);
  }
  selectFirst();

  document.querySelectorAll('.verdicts button').forEach((b) => b.addEventListener('click', () => {
    state.verdict = b.dataset.v;
    document.querySelectorAll('.verdicts button').forEach((o) => o.setAttribute('aria-pressed', String(o === b)));
    $('send').disabled = false;
  }));

  $('words').addEventListener('input', () => { $('send').disabled = !(state.verdict || $('words').value.trim()); });

  // What a click did, said on the page. He clicked three times on 2026-08-15 and
  // then asked twice whether it had landed, because the page named a state with
  // no consumer and said nothing else — so the reply now names the decision, the
  // state it is in, and what happens next, and a repeat click says so.
  async function post(body) {
    const r = await fetch('/answer', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    const ok = $('ok');
    ok.hidden = false;
    if (!r.ok) {
      ok.style.color = 'var(--accent)';
      ok.textContent = 'Not recorded — ' + (j.error || r.status) + '. Nothing was saved; try again.';
      return;
    }
    const name = j.decisionId || body.artifact || 'this decision';
    ok.style.color = j.warning ? 'var(--accent)' : 'var(--good)';
    ok.textContent = (j.duplicate
      ? 'Same answer as the one already recorded for ' + name + ' — still one decision, not two. '
      : 'Recorded as ' + name + '. ')
      + (j.warning || j.next);
    // The row appears in its real state, with its real handle.
    const li = document.createElement('li');
    li.className = 'ans';
    li.dataset.status = j.status || 'captured';
    li.innerHTML = '<span class="ans-head"><span class="ans-id mono"></span><span class="ans-v"></span></span>'
      + '<span class="ans-st"></span>';
    li.querySelector('.ans-id').textContent = name;
    li.querySelector('.ans-v').textContent = body.verdict || 'answered';
    li.querySelector('.ans-st').textContent = j.duplicate
      ? 'already recorded — refresh to see its state'
      : 'captured just now — the Navigator picks it up within five minutes';
    if (!j.duplicate) document.querySelector('.ans-list').prepend(li);
  }

  $('adopt').addEventListener('click', () => {
    if (!state.item) return;
    post({ artifact: state.item.artifact, verdict: 'adopt-all', words: $('words').value, questions: {} });
  });
  $('send').addEventListener('click', () => {
    if (!state.item) return;
    // Never call prose "per-question": on 2026-08-15 that mislabel was written to
    // disk with an empty questions map, which is the record that held his actual
    // reasoning. The verdict now describes what he did.
    const answered = Object.keys(state.perQuestion).length > 0;
    const verdict = state.verdict || (answered ? 'per-question' : ($('words').value.trim() ? 'words-only' : null));
    post({ artifact: state.item.artifact, verdict, words: $('words').value, questions: state.perQuestion });
  });
</script>
</body>
</html>`;
}
