/**
 * What the construction effects of a reward add up to: resources, buildings and building slots
 * (`totalConstruction`), and the batches the construction planner builds from (`recordBatches`).
 * `rewardScopes.ts` tells which lines are construction.
 */
import type { EffectLine, Step } from '../focus'
import { CONSTRUCTION_KEYS } from './rewardScopes'
import { isNumeric, round } from '../numbers'
import type { ConstructionBatch } from './types'
import type { Working } from './working'

/** Totals the construction effects that happen: resources, buildings and building slots. */
export const totalConstruction = (w: Working, built: EffectLine[]) => {
  for (const l of built) {
    if (l.key === 'add_extra_state_shared_building_slots' && isNumeric(l.value)) {
      w.buildingSlots += Number(l.value)
    }
    if (!l.subject || !isNumeric(l.value)) continue
    if (l.key === 'add_resource') {
      const total = w.resources.get(l.subject)?.total ?? 0
      w.resources.set(l.subject, {
        type: l.subject,
        name: l.subjectName ?? l.subject,
        total: round(total + Number(l.value)),
      })
    } else if (l.key === 'add_building_construction') {
      const id = `${l.subject}${l.instant ? ':instant' : ''}`
      const total = w.buildings.get(id)?.total ?? 0
      w.buildings.set(id, {
        type: l.subject,
        name: l.subjectName ?? l.subject,
        total: total + Number(l.value),
        instant: l.instant === true,
      })
    }
  }
}

/** Groups the construction lines of a reward into one batch per header block. */
export const recordBatches = (w: Working, step: Step, built: EffectLine[]) => {
  let batch: ConstructionBatch | undefined
  const start = (header?: EffectLine) => {
    const key = header?.key ?? ''
    const state = /^\d+$/.test(key) ? Number(key) : undefined
    const prefer = header?.preferStates?.map(Number).filter((n) => Number.isFinite(n))
    batch = {
      focusId: step.focus.id,
      focusName: step.focus.name,
      date: step.end,
      state,
      prefer: prefer && prefer.length > 0 ? prefer : undefined,
      random: key.startsWith('random_owned_'),
      buildings: [],
      slots: 0,
      resources: [],
    }
    w.construction.push(batch)
  }
  for (const l of built) {
    const isConstruction = l.key !== null && CONSTRUCTION_KEYS.has(l.key)
    if (!isConstruction) {
      start(l)
      continue
    }
    // A loose top-level line (not under a header) gets a batch of its own.
    if (l.depth === 0 || !batch) start()
    if (!batch || !isNumeric(l.value)) continue
    if (l.key === 'add_extra_state_shared_building_slots') batch.slots += Number(l.value)
    else if (!l.subject) continue
    else if (l.key === 'add_resource') {
      batch.resources.push({
        type: l.subject,
        name: l.subjectName ?? l.subject,
        amount: Number(l.value),
      })
    } else {
      batch.buildings.push({
        type: l.subject,
        name: l.subjectName ?? l.subject,
        level: Number(l.value),
        instant: l.instant === true,
      })
    }
  }
}
