// Decisions waiting on @jwildfire (jwildfire/obot.roadmap#238, task obot.agent#200).
//
// This is the one queue class the Navigator's sweep does NOT already carry. Its
// `## Decision answers` section is the inverse: answers he has already recorded
// that no agent has applied. Open decisions come from the hub clone's own
// collector — the same one the Operations Dashboard uses — so the briefing, the
// dashboard and the published decisions index cannot drift apart.
//
// The collector's `statusPlain` runs to hundreds of words on a live artifact.
// A briefing line is fifteen to twenty. Only id, title and the discussion URL
// cross this boundary; the prose stays where it was written.
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'
import { existsSync } from 'node:fs'

const COLLECTOR_REL = 'scripts/lib/collect/decision-log.mjs'

export async function openDecisions(hub, { load } = {}) {
  const mod = join(hub, COLLECTOR_REL)
  if (!load && !existsSync(mod)) {
    return { unknown: true, why: `no decision collector at ${COLLECTOR_REL}`, items: [] }
  }
  try {
    const m = load ? await load() : await import(pathToFileURL(mod).href)
    const log = await m.collectDecisionLog()
    const items = (log.open ?? []).map((d) => ({
      key: d.id,
      title: d.title,
      url: d.discussion?.url ?? null,
      questions: (d.questions ?? []).length,
      date: d.date ?? null,
    }))
    return { unknown: false, why: null, items }
  } catch (e) {
    return { unknown: true, why: `decision collector failed: ${e.message.split('\n')[0]}`, items: [] }
  }
}
