/**
 * Scheduling the construction queue. It knows nothing about game files or the campaign: it is
 * given the production data and the dated inputs the campaign worked out
 * (`ConstructionEnvironment`), and depends on nothing but `production.ts`.
 *
 * It runs day by day. The queue is the user's items in order, then the builds focuses queued, each
 * joining the end of the queue on its focus's completion date. Every day:
 *
 * - the spare civilian factories are the civilian factories built so far minus the consumer goods
 *   (`consumerGoodsFor`, worked out again from the factories of that day);
 * - the projects take them in queue order, up to `civCapPerProject` each, until none are left;
 * - a project adds `civs x per-civ speed x (1 + building speeds) x infrastructure` a day to its
 *   current level, done at the building's `base_cost`. The level counts as built from the next day,
 *   so a new civilian factory joins construction and raises the consumer goods;
 * - an item builds its levels one after another. A level starts when its state has a free building
 *   slot (for buildings that share slots; a level in progress holds one) and room under
 *   `state_max`. One that has to wait does not hold up the items behind it.
 *
 * Three rules sit in one helper each: `infraSpeedFactor`, `isPowered` and `civCapPerProject`.
 * Checked in game for Romania's 1936 start (Muntenia and Bessarabia factory dates, 15 civs a
 * project); the energy check has only been seen powered, never short of energy.
 */
import type {
  BuiltLevel,
  ConstructionEnvironment,
  ConstructionFactors,
  ConstructionIssue,
  ConstructionItem,
  ConstructionOptions,
  ConstructionSchedule,
  ProductionData,
  ProductionDefines,
  ScheduledConstruction,
  ScheduledLevel,
} from '../production'
import { consumerGoodsFor } from '../production'
import { addDays, daysBetween } from '../calendar'

const EPSILON = 1e-9
const CIVILIAN = 'industrial_complex'
const MILITARY = 'arms_factory'
const NAVAL = 'dockyard'
const INFRASTRUCTURE = 'infrastructure'
/** The infrastructure level that counts as full for the construction bonus. */
const MAX_INFRASTRUCTURE = 5

/**
 * How much faster a building goes up in a state with `infrastructure` levels: a speed bonus growing
 * linearly with the level, to `INFRA_MAX_CONSTRUCTION_COST_EFFECT` at level 5. Checked in game:
 * +60% at infrastructure 3 (Muntenia) and +40% at 2 (Bessarabia) give the game's dates.
 */
export const infraSpeedFactor = (infrastructure: number, defines: ProductionDefines): number =>
  1 + (defines.infraEffect * Math.min(infrastructure, MAX_INFRASTRUCTURE)) / MAX_INFRASTRUCTURE

/**
 * Whether the country has the energy for its factories, and the numbers behind it. Only checked
 * while powered (Romania in 1936, 5 per civ a day matches the game); the shortfall side is not:
 * produced is `BASE_COUNTRY_ENERGY_PRODUCTION` plus the coal times
 * `RESOURCE_TO_ENERGY_COEFFICIENT`, raised by `energy_gain_factor`. Used is every civilian,
 * military and naval factory at `BASE_ENERGY_COST` grown by `ENERGY_SCALING_COST_BY_FACTORY_COUNT`
 * per factory, capped at `ENERGY_COST_CAP`, lowered by `factory_energy_consumption`. Powered when
 * produced covers used.
 */
export const isPowered = (
  factories: number,
  coal: number,
  factors: Pick<ConstructionFactors, 'energyGain' | 'energyConsumption'>,
  defines: ProductionDefines,
): { powered: boolean; produced: number; used: number } => {
  const produced =
    (defines.baseEnergy + coal * defines.energyPerResource) * (1 + factors.energyGain)
  const each = Math.min(
    defines.energyCostCap,
    defines.baseEnergyCost * (1 + defines.energyCostScaling * factories),
  )
  const used = factories * each * (1 + factors.energyConsumption)
  return { powered: produced >= used, produced, used }
}

/**
 * The civilian factories one project can take: the production line cap
 * (`MAX_CIV_FACTORIES_PER_LINE`), 15, which is the game's construction cap too.
 */
export const civCapPerProject = (defines: ProductionDefines): number => defines.maxCivsPerProject

const noFactors = (date: Date): ConstructionFactors => ({
  date,
  buildingsSpeed: 0,
  buildingSpeed: {},
  poweredSpeed: 0,
  slotFactor: 0,
  consumerExpected: 0,
  consumerFactor: 0,
  stability: 0,
  energyGain: 0,
  energyConsumption: 0,
})

interface StateNow {
  id: number
  categorySlots: number
  built: Record<string, number>
  extraSlots: number
  /** Levels being built now, by building. */
  progressing: Record<string, number>
}

interface Entry {
  source: 'queue' | 'focus'
  index: number
  item: ConstructionItem
  joinDay: number
  joined: Date
  focusName?: string
  guessed?: boolean
  levels: ScheduledLevel[]
  issues: Set<ConstructionIssue>
  /** The level in progress. */
  current?: { start: number; progress: number; civs: number }
  /** Done, or never going to start (unknown building or state, no room under `state_max`). */
  closed: boolean
}

export const scheduleConstruction = (
  queue: ConstructionItem[],
  production: ProductionData,
  env: ConstructionEnvironment,
  options: ConstructionOptions,
): ConstructionSchedule => {
  const { startDate } = options
  const { defines } = production
  const dayOf = (date: Date) => Math.max(0, Math.ceil(daysBetween(startDate, date) - EPSILON))
  const horizon = dayOf(options.until)
  const buildings = new Map(production.buildings.map((b) => [b.id, b]))
  const shared = new Set([CIVILIAN, MILITARY, NAVAL, ...production.sharedSlotBuildings])

  const states = new Map<number, StateNow>(
    production.states.map((s) => [
      s.id,
      {
        id: s.id,
        categorySlots: production.categorySlots[s.category] ?? 0,
        built: { ...s.buildings },
        extraSlots: 0,
        progressing: {},
      },
    ]),
  )
  /** Every building of the country by type, including what fits no state. */
  const totals: Record<string, number> = {}
  const addTotal = (type: string, n: number) => (totals[type] = (totals[type] ?? 0) + n)
  let coal = 0
  for (const s of production.states) {
    for (const [type, n] of Object.entries(s.buildings)) addTotal(type, n)
    coal += s.resources[defines.energyResource] ?? 0
  }

  const factorsByDay = env.factors
    .map((f) => ({ day: dayOf(f.date), factors: f }))
    .sort((a, b) => a.day - b.day)
  const factorsOn = (day: number): ConstructionFactors => {
    let found: ConstructionFactors | undefined
    for (const f of factorsByDay) {
      if (f.day > day) break
      found = f.factors
    }
    return found ?? noFactors(startDate)
  }
  const events = env.events
    .map((e) => ({ day: dayOf(e.date), event: e }))
    .sort((a, b) => a.day - b.day)
  let nextEvent = 0

  const entries: Entry[] = [
    ...queue.map(
      (item, index): Entry => ({
        source: 'queue',
        index,
        item,
        joinDay: 0,
        joined: startDate,
        levels: [],
        issues: new Set(),
        closed: false,
      }),
    ),
    ...env.focusBuilds
      .map((b, index) => ({ b, index }))
      .sort((x, y) => x.b.date.getTime() - y.b.date.getTime() || x.index - y.index)
      .map(
        ({ b, index }): Entry => ({
          source: 'focus',
          index,
          item: b.item,
          joinDay: dayOf(b.date),
          joined: b.date,
          focusName: b.focusName,
          guessed: b.guessed,
          levels: [],
          issues: new Set(),
          closed: false,
        }),
      ),
  ]
  const built: BuiltLevel[] = []

  const slotsOf = (st: StateNow, slotFactor: number) =>
    Math.floor(st.categorySlots * (1 + slotFactor)) + st.extraSlots
  const sharedUsed = (st: StateNow) =>
    Object.entries(st.built).reduce((n, [type, v]) => n + (shared.has(type) ? v : 0), 0) +
    Object.entries(st.progressing).reduce((n, [type, v]) => n + (shared.has(type) ? v : 0), 0)

  for (const entry of entries) {
    if (!buildings.has(entry.item.building)) {
      entry.issues.add('unknown-building')
      entry.closed = true
    } else if (!states.has(entry.item.state)) {
      entry.issues.add('unknown-state')
      entry.closed = true
    }
  }

  for (let day = 0; day < horizon; day++) {
    while (nextEvent < events.length && events[nextEvent].day <= day) {
      const e = events[nextEvent++].event
      const st = e.state === undefined ? undefined : states.get(e.state)
      for (const [type, n] of Object.entries(e.built)) {
        addTotal(type, n)
        if (st) st.built[type] = (st.built[type] ?? 0) + n
      }
      if (st) st.extraSlots += e.slots
      coal += e.resources[defines.energyResource] ?? 0
    }
    if (entries.every((entry) => entry.closed)) break

    const factors = factorsOn(day)
    const civ = totals[CIVILIAN] ?? 0
    const goods = consumerGoodsFor(
      civ,
      totals[MILITARY] ?? 0,
      factors.consumerExpected,
      factors.consumerFactor,
      factors.stability,
      defines,
    )
    let spare = Math.max(0, civ - goods.factories)
    const { powered } = isPowered(
      civ + (totals[MILITARY] ?? 0) + (totals[NAVAL] ?? 0),
      coal,
      factors,
      defines,
    )
    const perCiv = powered ? defines.poweredFactorySpeed : defines.baseFactorySpeed
    const finished: { entry: Entry; state: StateNow }[] = []

    for (const entry of entries) {
      if (entry.closed || entry.joinDay > day) continue
      const data = buildings.get(entry.item.building)!
      const st = states.get(entry.item.state)!
      if (!entry.current) {
        const have = (st.built[data.id] ?? 0) + (st.progressing[data.id] ?? 0)
        if (have + 1 > data.stateMax) {
          entry.issues.add('state-max')
          entry.closed = true
          continue
        }
        if (data.sharesSlots && sharedUsed(st) + 1 > slotsOf(st, factors.slotFactor)) {
          entry.issues.add('no-slots')
          continue
        }
        if (spare <= 0) continue
        entry.current = { start: day, progress: 0, civs: 0 }
        // It waited for a slot but got one, so only an item that never fits keeps the issue.
        entry.issues.delete('no-slots')
        st.progressing[data.id] = (st.progressing[data.id] ?? 0) + 1
      }
      const civs = Math.min(civCapPerProject(defines), spare)
      spare -= civs
      if (civs <= 0) continue
      const speed =
        Math.max(
          0,
          1 +
            factors.buildingsSpeed +
            (factors.buildingSpeed[data.id] ?? 0) +
            (powered ? factors.poweredSpeed : 0),
        ) * (data.infraEffect ? infraSpeedFactor(st.built[INFRASTRUCTURE] ?? 0, defines) : 1)
      entry.current.civs = civs
      entry.current.progress += civs * perCiv * speed
      if (entry.current.progress >= data.cost - EPSILON) finished.push({ entry, state: st })
    }

    // A level done today counts as built from tomorrow.
    for (const { entry, state: st } of finished) {
      const current = entry.current!
      const type = entry.item.building
      const end = addDays(startDate, day + 1)
      entry.levels.push({
        start: addDays(startDate, current.start),
        end,
        days: day + 1 - current.start,
        civs: current.civs,
      })
      built.push({ date: end, state: st.id, building: type })
      st.progressing[type]--
      st.built[type] = (st.built[type] ?? 0) + 1
      addTotal(type, 1)
      entry.current = undefined
      if (entry.levels.length >= entry.item.levels) entry.closed = true
    }
  }

  const items = entries
    .map(
      (e): ScheduledConstruction => ({
        index: e.index,
        source: e.source,
        item: e.item,
        focusName: e.focusName,
        guessed: e.guessed,
        joined: e.joined,
        levels: e.levels,
        issues: [...e.issues],
      }),
    )
    .sort((a, b) => (a.source === b.source ? a.index - b.index : a.source === 'queue' ? -1 : 1))
  return {
    items,
    built,
    finish: built.reduce((latest, b) => (b.date > latest ? b.date : latest), startDate),
  }
}
