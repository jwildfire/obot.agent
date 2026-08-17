// The trend chart behind each metric — a bar sparkline drawn as an SVG string.
//
// @jwildfire, 2026-08-17 (jwildfire/obot.roadmap#227): "a metric driven dashboard
// showing trends over a selectable time period."
//
// WHY BARS AND NOT A LINE. Each value is a count inside a bucket, not a reading of a
// continuous quantity. A line drawn between two buckets asserts values in between
// that were never measured; bars assert only what was counted. Same reason the marks
// are anchored to a drawn baseline: a zero bucket has to look like a zero, not like
// the chart ending.
//
// WHY THE BANDS ARE THE POINT. The commissioning issue puts it plainly: worker ids,
// the delivery record and the discipline checks are one to two days old, so a 30- or
// 365-day trend is mostly pre-instrumentation, and "a rising line that only reflects
// when measurement started is a lie with a slope". Where measurement begins must be
// visible ON THE CHART, not in a footnote — so the span before it is hatched, its
// boundary is ruled, and the tile prints the date underneath. The second band is the
// mirror of the first at the other end: the current bucket is still in progress, and
// the part of it that has not happened yet is tinted so its short bar reads as
// "not finished" rather than as a collapse.
//
// The two bands are deliberately different fills — a hatch for "never measured", a
// flat tint for "not elapsed yet". Using one texture for two meanings is how a chart
// teaches a reader something false.
//
// NO CLIENT-SIDE JAVASCRIPT. This whole page is server-rendered and carries no script
// (tools/ops-dashboard/lib/render.mjs, navigatorPage). A hover-only chart would also
// fail the requirement's own rule that a hover affordance needs a tap equivalent, so
// the numbers are never locked inside the picture: every tile prints its total, and
// every chart ships the bucket-by-bucket table beside it.
import { esc } from './esc.mjs';

// A 240×40 user-space box, stretched by CSS to whatever width the tile gives it and a
// fixed height (`preserveAspectRatio="none"`). Non-uniform scaling is the right choice
// here and not a shortcut: every mark is an axis-aligned rect or rule, so the only
// thing distortion costs is a fraction of a pixel on two hairlines and a few degrees
// on the hatch — and what it buys is that the bars always span exactly the tile,
// whatever the breakpoint, with no letterboxing beside a 2px-wide bar. The CSS sets
// width and height explicitly because an inline SVG with only a viewBox has no
// intrinsic size in a flex or grid child and collapses to nothing.
export const VB_W = 240;
export const VB_H = 40;
const TOP = 3;
const BASE = 36;

const clampX = (x) => Math.max(0, Math.min(VB_W, x));
const r2 = (n) => Math.round(n * 100) / 100;

/**
 * Where a timestamp falls on the chart's x axis, in user-space units.
 * Values outside the window clamp to the edges rather than drawing off-canvas.
 */
export function xAt(t, { start, end }) {
  if (!Number.isFinite(t) || end <= start) return 0;
  return clampX(((t - start) / (end - start)) * VB_W);
}

/**
 * One series → an SVG string.
 *
 * `id` must be unique on the page: SVG pattern references are document-global, so two
 * charts sharing an id share a fill, and a defs block that loses its uniqueness is the
 * kind of bug that only shows up once a second chart exists.
 */
export function sparkSvg({
  buckets = [], start, end, id = 's', label = '', unmeasuredUntil = null, nowAt = null,
} = {}) {
  const n = buckets.length;
  if (!n || !(end > start)) {
    return `<svg class="spark" viewBox="0 0 ${VB_W} ${VB_H}" role="img" aria-label="${esc(label || 'no data')}"></svg>`;
  }
  const max = Math.max(1, ...buckets.map((b) => b.n));
  // Bars are placed and sized by the time they actually cover, not by their index.
  // Only the 365-day view has an uneven bucket — its first one is the day the year
  // does not divide into weeks — and drawing that one day as wide as a week would
  // overstate it by seven times, on the exact chart where the honesty of the span is
  // the point.
  const gapFor = (b) => Math.min(1.6, (xAt(b.end, { start, end }) - xAt(b.start, { start, end })) * 0.28);
  const bars = buckets.map((b) => {
    if (!b.n) return '';
    const x0 = xAt(b.start, { start, end });
    const x1 = xAt(b.end, { start, end });
    const gap = gapFor(b);
    const w = Math.max(0.8, x1 - x0 - gap);
    const h = Math.max(1, (b.n / max) * (BASE - TOP));
    return `<rect class="sbar" x="${r2(x0 + gap / 2)}" y="${r2(BASE - h)}" width="${r2(w)}" height="${r2(h)}" rx="${r2(Math.min(1.5, w / 2))}"/>`;
  }).join('');

  // Bands first so the bars sit on top of them — a bar inside the unmeasured span is
  // real data (a repo can have a stray item before its own epoch) and must stay legible.
  const bands = [];
  const rules = [];
  if (unmeasuredUntil !== null && unmeasuredUntil > start) {
    const x = r2(xAt(unmeasuredUntil, { start, end }));
    if (x > 0.5) {
      bands.push(`<rect class="sband" x="0" y="${TOP}" width="${x}" height="${BASE - TOP}" fill="url(#h${esc(id)})"/>`);
      rules.push(`<line class="srule" x1="${x}" y1="${TOP - 1}" x2="${x}" y2="${BASE}"/>`);
    }
  }
  if (nowAt !== null && nowAt < end) {
    const x = r2(xAt(nowAt, { start, end }));
    if (x < VB_W - 0.5) {
      bands.push(`<rect class="sfuture" x="${x}" y="${TOP}" width="${r2(VB_W - x)}" height="${BASE - TOP}"/>`);
    }
  }
  // The hatch is declared per chart because its id is; 45° only, per the house rule
  // that horizontal or vertical hatching reads as gridlines or as bars.
  const defs = unmeasuredUntil !== null
    ? `<defs><pattern id="h${esc(id)}" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line class="shatch" x1="0" y1="0" x2="0" y2="5"/></pattern></defs>`
    : '';
  return `<svg class="spark" viewBox="0 0 ${VB_W} ${VB_H}" preserveAspectRatio="none" role="img" aria-label="${esc(label)}">${defs}${bands.join('')}<line class="sbase" x1="0" y1="${BASE}" x2="${VB_W}" y2="${BASE}"/>${bars}${rules.join('')}</svg>`;
}

/**
 * A bucket's label — the date or hour it covers, in the reader's own terms.
 *
 * Buckets sit on a UTC grid (tools/navigator/metrics.mjs, trendSeries) precisely so
 * this can name them. Rendered in the local zone, because the page is his and the
 * hours he reads are his.
 */
export function bucketLabel(b, unit) {
  const d = new Date(b.start);
  const p = (x) => String(x).padStart(2, '0');
  if (unit === 'hour') return `${p(d.getHours())}:00`;
  if (unit === '6 hours') return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:00`;
  const day = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  if (unit === 'week') return `week of ${day}`;
  return day;
}

/**
 * The chart as a table — the tap equivalent, and the fallback the house rule makes
 * mandatory rather than optional. Only the buckets that carry something are listed:
 * a 53-row table of zeros is not a fallback, it is a wall.
 */
export function bucketTable(buckets, unit) {
  const rows = buckets.map((b, i) => ({ b, i })).filter(({ b }) => b.n);
  if (!rows.length) return '<p class="t-none">Nothing in any bucket of this period.</p>';
  return `<table class="sbt"><thead><tr><th>${esc(unit)}</th><th>count</th></tr></thead><tbody>${
    rows.map(({ b }) => `<tr><td>${esc(bucketLabel(b, unit))}</td><td>${b.n}</td></tr>`).join('')
  }</tbody></table>`;
}

// Marks use the accent; chrome uses the neutrals. --faint does not clear 3:1 as a
// non-text mark in the light scheme, so nothing structural is drawn in it.
export const SPARK_CSS = `
  .spark { display:block; width:100%; height:38px; overflow:visible; }
  .spark .sbar { fill:var(--accent); }
  .spark .sbase { stroke:var(--line); stroke-width:1; }
  .spark .shatch { stroke:var(--line); stroke-width:1.4; }
  .spark .srule { stroke:var(--muted); stroke-width:1; }
  .spark .sfuture { fill:var(--line); opacity:0.35; }
  .sbt { border-collapse:collapse; font-size:0.7rem; margin:0.2rem 0 0; }
  .sbt th { text-align:left; font-weight:500; color:var(--faint); padding:0.1rem 0.5rem 0.1rem 0;
            font-size:0.62rem; text-transform:uppercase; letter-spacing:0.07em; }
  .sbt td { padding:0.05rem 0.5rem 0.05rem 0; color:var(--muted); font-family:var(--mono);
            font-size:0.68rem; }
`;
