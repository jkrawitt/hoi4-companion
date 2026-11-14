import { describe, expect, it } from 'vitest'
import { addDays, daysBetween } from '../calendar'
import { evaluateCheck } from '../campaign/conditions'
import { countryStateAt } from '../campaign/countryState'
import { planCampaign } from '../campaign/plan'
import { planPolitics } from '../campaign/politics'
import type { Technology } from '../research'
import type { EffectLine, Focus } from '../focus'
import { DEFAULT_POLITICS_DEFINES } from '../politics'
import type { PoliticalOption, PoliticsData, PoliticsItem } from '../politics'
import { schedulePlan } from '../plan/focusPlan'
import {
  addPurchase,
  dailyGain,
  knownPurchases,
  movePurchase,
  purchaseCost,
  removePurchase,
  setNotBefore,
  stabilityFactor,
} from '../plan/politicsPlan'
import { checkOfLines } from '../effects/conditions'
import { flattenEffects } from '../effects/lines'
import { parseScript } from '../parsers/paradoxScript'
import {
  parseAdvisors,
  parseDesigners,
  parseIdeaSlots,
  parseLaws,
  parsePoliticsDefines,
} from '../parsers/politics'

/** The game's numbers without the running focus's cost, so the sums below stay round. */
const NO_FOCUS = { ...DEFAULT_POLITICS_DEFINES, focusCost: 0 }

const trigger = (text: string) => checkOfLines(flattenEffects(parseScript(text)))
const ctx = (over = {}) => ({
  hasIdea: (id: string) => id === 'held',
  hasFocus: (id: string) => id === 'done',
  government: () => undefined,
  leader: () => undefined,
  popularity: () => undefined,
  tag: 'ROM',
  hasDlc: (id: string) => id === 'Owned',
  stat: (key: string) => (key === 'war_support' ? 0.2 : undefined),
  ...over,
})
const holds = (text: string, over = {}) => evaluateCheck(trigger(text), ctx(over))

describe('trigger checks', () => {
  it('reads tags, DLCs, constants and stats', () => {
    expect(holds('original_tag = ROM')).toBe(true)
    expect(holds('tag = HUN')).toBe(false)
    expect(holds('has_dlc = "Owned"')).toBe(true)
    expect(holds('has_dlc = "Other"')).toBe(false)
    expect(holds('always = no')).toBe(false)
    expect(holds('has_war_support > 0.15')).toBe(true)
    expect(holds('has_war_support > 0.25')).toBe(false)
    expect(holds('has_stability > 0.25')).toBeUndefined()
  })

  it('answers a stat only when the campaign knows it', () => {
    expect(holds('has_war_support > 0.1', { stat: () => undefined })).toBeUndefined()
  })

  it('reads a trigger if as "if the limit holds, so must the body"', () => {
    const text = `if = { limit = { original_tag = HUN } has_completed_focus = missing }`
    expect(holds(text)).toBe(true)
    const rom = `if = { limit = { original_tag = ROM } has_completed_focus = missing }`
    expect(holds(rom)).toBe(false)
    expect(holds(`if = { limit = { original_tag = ROM } has_completed_focus = done }`)).toBe(true)
  })

  it('follows else branches, nested or beside the if, and uppercase IF', () => {
    const beside = `if = { limit = { original_tag = HUN } always = no }
      else = { has_completed_focus = done }`
    expect(holds(beside)).toBe(true)
    const nested = `IF = { limit = { original_tag = HUN } always = no
      ELSE = { has_completed_focus = missing } }`
    expect(holds(nested)).toBe(false)
    const chain = `if = { limit = { original_tag = HUN } always = no }
      else_if = { limit = { original_tag = ROM } has_completed_focus = done }
      else = { always = no }`
    expect(holds(chain)).toBe(true)
  })

  it('leaves terms about other roles unknown', () => {
    expect(holds('not_already_hired_except_as = army_chief')).toBeUndefined()
    expect(holds('has_idea = held not_already_hired_except_as = x')).toBeUndefined()
    expect(holds('always = no not_already_hired_except_as = x')).toBe(false)
  })
})

const IDEA_TAGS = `idea_categories = {
  country = { type = national_spirit }
  government = {
    slot = mobilization_laws slot = trade_laws slot = economy
    character_slot = political_advisor character_slot = political_advisor
    character_slot = political_advisor
    cost = 150
  }
  research_production = {
    slot = tank_manufacturer slot = industrial_concern
    character_slot = theorist
  }
  military_staff = { character_slot = army_chief character_slot = high_command
    character_slot = high_command }
}`

const LAWS = `ideas = {
  economy = {
    law = yes
    use_list_view = yes
    isolation = { allowed = { always = no } modifier = { x = 0.1 } }
    civilian_economy = {
      cost = 150
      default = yes
      modifier = { consumer_goods_expected_value = 0.35 ai_x = 1 }
      rule = { can_x = no }
    }
    partial_economic_mobilisation = {
      available = {
        has_war_support > 0.15
        IF = {
          limit = { original_tag = HUN }
          has_completed_focus = HUN_x
        }
      }
      allowed = { NOT = { has_idea = foo } }
      modifier = { production_speed_arms_factory_factor = -0.1 }
    }
  }
}`

describe('parseIdeaSlots', () => {
  it('counts the slots and tells law slots from designer slots', () => {
    const slots = parseIdeaSlots(IDEA_TAGS)
    expect(slots.lawSlots).toEqual(['mobilization_laws', 'trade_laws', 'economy'])
    expect(slots.designerSlots).toEqual(['tank_manufacturer', 'industrial_concern'])
    expect(slots.slots).toMatchObject({
      political_advisor: 3,
      economy: 1,
      theorist: 1,
      high_command: 2,
      tank_manufacturer: 1,
    })
    expect(slots.slots.country).toBeUndefined()
  })
})

describe('parseLaws', () => {
  const laws = parseLaws(LAWS, ['economy'])
  it('reads the default, cost and modifiers of a law', () => {
    const civilian = laws.find((l) => l.id === 'civilian_economy')
    expect(civilian).toMatchObject({
      kind: 'law',
      slot: 'economy',
      group: 'laws',
      cost: 150,
      default: true,
    })
    expect(civilian?.modifiers.map((m) => `${m.key}${m.isRule ? ' (rule)' : ''}`)).toEqual([
      'consumer_goods_expected_value',
      'can_x (rule)',
    ])
  })

  it('reads allowed and the available block with its trigger if', () => {
    const isolation = laws.find((l) => l.id === 'isolation')
    expect(isolation?.allowed).toEqual({ type: 'const', value: false })
    const partial = laws.find((l) => l.id === 'partial_economic_mobilisation')
    expect(partial?.default).toBeUndefined()
    // Not HUN, so the trigger if holds; war support decides.
    const at = (war: number | undefined) =>
      evaluateCheck(partial!.available!, ctx({ stat: () => war }))
    expect(at(0.2)).toBe(true)
    expect(at(0.1)).toBe(false)
    expect(at(undefined)).toBeUndefined()
    expect(partial?.availableLines?.length).toBeGreaterThan(0)
  })
})

const DESIGNERS = `ideas = {
  hidden_ideas = { some = { modifier = { } } }
  tank_manufacturer = {
    designer = yes
    pzinz = {
      allowed = { original_tag = ROM }
      research_bonus = { armor = 0.15 }
      traits = { tank_manufacturer }
    }
    works = {
      cost = 50
      available = { has_completed_focus = ROM_tanks }
      allowed = { original_tag = ROM has_dlc = "Death or Dishonor" }
      research_bonus = { armor = 0.05 }
      modifier = { equipment_conversion_speed = 0.1 }
    }
    generic = {
      allowed = { NOT = { has_allowed_idea_with_traits = { idea = tank_manufacturer limit = 1 } } }
    }
  }
}`

describe('parseDesigners', () => {
  const designers = parseDesigners(DESIGNERS, ['tank_manufacturer', 'industrial_concern'])
  it('reads designers of the designer slots only', () => {
    expect(designers.map((d) => d.id)).toEqual(['pzinz', 'works', 'generic'])
    expect(designers[0]).toMatchObject({
      kind: 'designer',
      group: 'research_production',
      cost: 150,
      researchBonus: { armor: 0.15 },
    })
  })

  it('reads cost, availability and what allows it', () => {
    const works = designers[1]
    expect(works.cost).toBe(50)
    expect(works.available).toEqual({ type: 'focus', id: 'ROM_tanks' })
    expect(works.modifiers.map((m) => m.key)).toEqual(['equipment_conversion_speed'])
    expect(evaluateCheck(works.allowed!, ctx({ hasDlc: () => false }))).toBe(false)
    expect(evaluateCheck(works.allowed!, ctx({ hasDlc: () => true }))).toBe(true)
  })

  it('marks a generic fallback', () => {
    expect(designers[2].fallback).toBe('tank_manufacturer')
    expect(designers[0].fallback).toBeUndefined()
  })
})

describe('parseAdvisors', () => {
  const advisors = parseAdvisors(`characters = {
    ROM_calinescu = {
      name = ROM_calinescu
      advisor = {
        slot = political_advisor
        idea_token = ROM_calinescu
        allowed = { original_tag = ROM }
        traits = { prince_of_terror }
      }
      country_leader = { ideology = centrism }
    }
    ROM_potopeanu = {
      advisor = { cost = 100 slot = theorist idea_token = ROM_potopeanu ledger = army
        traits = { military_theorist } }
    }
    ROM_sanatescu = {
      advisor = { slot = army_chief idea_token = ROM_sanatescu cost = 100 }
    }
    ROM_nobody = { name = x }
  }`)

  it('reads slot, cost (default 150), ledger and traits', () => {
    expect(advisors.map((a) => a.id)).toEqual(['ROM_calinescu', 'ROM_potopeanu', 'ROM_sanatescu'])
    expect(advisors[0]).toMatchObject({
      kind: 'advisor',
      group: 'government',
      cost: 150,
      character: 'ROM_calinescu',
      traits: ['prince_of_terror'],
    })
    expect(advisors[1]).toMatchObject({ cost: 100, ledger: 'army', group: 'research_production' })
    // A chief's ledger follows from the slot.
    expect(advisors[2]).toMatchObject({ ledger: 'army', group: 'military_staff' })
  })
})

describe('parsePoliticsDefines', () => {
  it('reads the base gain and the cap, with fallbacks', () => {
    const text = `NDefines.NCountry = {
      POLITICAL_POWER_UPPER_CAP = 1500.0,
      BASE_POLITICAL_POWER_INCREASE = 3, -- weekly
    }`
    expect(parsePoliticsDefines(text)).toMatchObject({ baseGain: 3, cap: 1500 })
    expect(parsePoliticsDefines('')).toEqual(DEFAULT_POLITICS_DEFINES)
  })

  it('reads stability and focus political power from the static modifiers', () => {
    const statics = `stability_good_modifier = {
      industrial_capacity_factory = 0.20
      political_power_factor = 0.15
    }
    stability_bad_modifier = { political_power_factor = -0.3 }
    gain_focus = { political_power_cost = 2 }`
    expect(
      parsePoliticsDefines('BASE_STABILITY_PARTY_POPULARITY_FACTOR = 0.2,', statics),
    ).toMatchObject({ partyStability: 0.2, stabilityGood: 0.15, stabilityBad: -0.3, focusCost: 2 })
  })
})

// --- Planning ---

const begin = new Date(Date.UTC(1936, 0, 1))
const day = (n: number) => addDays(begin, n)
const num = (key: string) => ({ key, kind: 'number' as const })
const line = (key: string, value: string, depth = 0): EffectLine => ({
  depth,
  key,
  value,
  isModifier: true,
  stat: num(key),
})
const focus = (
  id: string,
  effects: EffectLine[],
  days = 70,
  prerequisites: string[][] = [],
): Focus => ({
  id,
  name: id,
  days,
  prerequisites,
  mutuallyExclusive: [],
  x: 0,
  y: 0,
  effects,
})
const option = (id: string, extra: Partial<PoliticalOption> = {}): PoliticalOption => ({
  id,
  name: id,
  kind: 'law',
  slot: 'economy',
  group: 'laws',
  cost: 150,
  modifiers: [],
  ...extra,
})
const data = (options: PoliticalOption[], extra: Partial<PoliticsData> = {}): PoliticsData => ({
  options,
  slots: { economy: 1, political_advisor: 2, tank_manufacturer: 1 },
  categoryNames: {},
  defines: NO_FOCUS,
  ...extra,
})

const planOf = (
  queue: PoliticsItem[],
  politics: PoliticsData,
  focuses: Focus[] = [],
  startPower = 0,
  input: Partial<Parameters<typeof planPolitics>[0]> = {},
) =>
  planPolitics({
    focusSchedule: schedulePlan(
      focuses.map((f) => f.id),
      Object.fromEntries(focuses.map((f) => [f.id, f])),
      { startDate: begin, speedBonus: 0 },
    ),
    options: {
      tag: 'ROM',
      startDate: begin,
      start: [line('add_political_power', String(startPower))],
    },
    queue,
    data: politics,
    startDate: begin,
    until: day(3000),
    ...input,
  })
const daysOf = (plan: ReturnType<typeof planOf>) =>
  plan.items.map((i) => daysBetween(begin, i.date))
const buy = (...ids: string[]): PoliticsItem[] => ids.map((optionId) => ({ optionId }))

describe('political power formulas', () => {
  it('works out the daily gain from the modifiers', () => {
    const defines = NO_FOCUS
    expect(dailyGain({}, defines)).toBe(2)
    expect(dailyGain({ political_power_gain: 0.5 }, defines)).toBe(2.5)
    expect(
      dailyGain({ political_power_gain: 1, political_power_factor: 0.1 }, defines),
    ).toBeCloseTo(3.3)
    expect(dailyGain({ political_power_cost: 0.5 }, defines)).toBe(1.5)
  })

  it('scales the stability modifiers from 50% and pays for the running focus', () => {
    const d = DEFAULT_POLITICS_DEFINES
    expect(stabilityFactor(0.5, d)).toBeCloseTo(0)
    expect(stabilityFactor(1, d)).toBeCloseTo(0.1)
    expect(stabilityFactor(0, d)).toBeCloseTo(-0.2)
    // Romania on 1 January 1936: 60% stability plus 60% democratic popularity x 0.15 = 69%.
    expect(stabilityFactor(0.69, d)).toBeCloseTo(0.038)
    expect(dailyGain({}, d, 0.69)).toBeCloseTo(2 * 1.038 - 1)
  })

  it('applies the slot and ledger cost factors to a cost, never below zero', () => {
    const advisor = option('a', { kind: 'advisor', slot: 'army_chief', ledger: 'army', cost: 100 })
    expect(purchaseCost(advisor, {})).toBe(100)
    // A mobilization law costs its cost for every rank moved; one without a rank costs it flat.
    const volunteer = option('volunteer', { slot: 'mobilization_laws', level: 6 })
    const extensive = option('extensive', { slot: 'mobilization_laws', level: 4 })
    expect(purchaseCost(extensive, {}, volunteer)).toBe(300)
    expect(purchaseCost(volunteer, {}, extensive)).toBe(300)
    expect(purchaseCost(extensive, {})).toBe(150)
    expect(purchaseCost(option('war_economy'), {}, option('civilian_economy'))).toBe(150)
    expect(
      purchaseCost(advisor, { army_chief_cost_factor: -0.25, army_advisor_cost_factor: -0.25 }),
    ).toBe(50)
    expect(purchaseCost(advisor, { army_chief_cost_factor: -2 })).toBe(0)
    // The ledger only counts for advisors.
    expect(purchaseCost(option('l', { ledger: 'army' }), { army_advisor_cost_factor: -0.5 })).toBe(
      150,
    )
  })
})

describe('planPolitics', () => {
  it('starts with a day of base gain less the first focus (checked in game: 1)', () => {
    const plan = planOf([], data([], { defines: DEFAULT_POLITICS_DEFINES }))
    expect(plan.balanceAt(begin)).toBe(1)
  })

  it('buys the first day the political power is there', () => {
    // The first day already holds a day's gain (2, with no focus cost here), so 148 to go.
    const plan = planOf(buy('a'), data([option('a')]))
    expect(daysOf(plan)).toEqual([74])
    expect(plan.items[0]).toMatchObject({ cost: 150, balanceAfter: 0 })
    expect(plan.balanceAt(day(40))).toBe(82)
    expect(plan.balanceAt(day(74))).toBe(0)
    expect(plan.balanceAt(day(84))).toBe(20)
  })

  it('starts with the political power the start gives', () => {
    expect(daysOf(planOf(buy('a'), data([option('a')]), [], 100))).toEqual([24])
    expect(daysOf(planOf(buy('a'), data([option('a')]), [], 400))).toEqual([0])
  })

  it('keeps the queue in order: a cheap item waits behind an expensive one', () => {
    const options = data([option('big'), option('small', { slot: 'trade_laws', cost: 10 })])
    expect(daysOf(planOf(buy('big', 'small'), options, [], 100))).toEqual([24, 29])
    expect(daysOf(planOf(buy('small', 'big'), options, [], 100))).toEqual([0, 29])
  })

  it('adds the political power a focus gives', () => {
    const f = focus('f', [line('add_political_power', '100')])
    const plan = planOf(buy('a'), data([option('a')]), [f])
    // 2 on the first day and 140 saved by day 70, plus 100 from the focus.
    expect(daysOf(plan)).toEqual([70])
    expect(plan.items[0].balanceAfter).toBe(92)
  })

  it('waits for a focus to make an option available', () => {
    const gated = option('works', {
      kind: 'designer',
      slot: 'tank_manufacturer',
      cost: 50,
      available: { type: 'focus', id: 'f' },
    })
    const plan = planOf(buy('works'), data([gated]), [focus('f', [])], 1000)
    expect(daysOf(plan)).toEqual([70])
    expect(planOf(buy('works'), data([gated]), [], 1000).unscheduled).toEqual([
      { index: 0, optionId: 'works', reason: 'unavailable' },
    ])
  })

  it('allows an option whose availability it cannot tell, with a warning', () => {
    const unsure = option('u', { available: { type: 'unknown' } })
    const plan = planOf(buy('u'), data([unsure]), [], 1000)
    expect(plan.items[0].issues).toEqual([{ kind: 'availability-unknown' }])
  })

  it('answers war support and stability from the start', () => {
    const law = option('war', {
      available: { type: 'stat', key: 'war_support', op: '>', than: 0.3 },
    })
    const start = [line('add_political_power', '500'), line('add_war_support', '0.5')]
    expect(
      daysOf(
        planOf(buy('war'), data([law]), [], 0, {
          options: { tag: 'ROM', startDate: begin, start },
        }),
      ),
    ).toEqual([0])
    const low = [line('add_political_power', '500'), line('add_war_support', '0.1')]
    expect(
      planOf(buy('war'), data([law]), [], 0, {
        options: { tag: 'ROM', startDate: begin, start: low },
      }).unscheduled[0].reason,
    ).toBe('unavailable')
  })

  it('replaces the law in a slot, and lets the state hold only the new one', () => {
    const options = data([option('old'), option('new')])
    const plan = planOf(buy('old', 'new'), options, [], 1000)
    expect(plan.items.map((i) => i.optionId)).toEqual(['old', 'new'])
    const focuses: Focus[] = []
    const state = countryStateAt(
      schedulePlan(
        focuses.map((f) => f.id),
        {},
        { startDate: begin, speedBonus: 0 },
      ),
      day(10),
      { tag: 'ROM', politics: options, extraSteps: plan.steps },
    )
    expect(state.ideas.map((i) => i.id)).toEqual(['new'])
  })

  it('leaves an advisor out when its slot is full, until another is dismissed', () => {
    const advisors = ['a1', 'a2', 'a3'].map((id) =>
      option(id, {
        kind: 'advisor',
        slot: 'political_advisor',
        group: 'government',
        character: id,
        recruited: true,
        cost: 10,
      }),
    )
    const options = data(advisors)
    const full = planOf(buy('a1', 'a2', 'a3'), options, [], 1000)
    expect(full.items.map((i) => i.optionId)).toEqual(['a1', 'a2'])
    expect(full.unscheduled).toEqual([{ index: 2, optionId: 'a3', reason: 'slots-full' }])
    const queue: PoliticsItem[] = [
      ...buy('a1', 'a2'),
      { optionId: 'a1', dismiss: true },
      ...buy('a3'),
    ]
    const swapped = planOf(queue, options, [], 1000)
    expect(swapped.items.map((i) => i.optionId)).toEqual(['a1', 'a2', 'a1', 'a3'])
    expect(swapped.unscheduled).toEqual([])
  })

  it('needs an advisor to be recruited, and to not lead the country', () => {
    const adv = (id: string, extra = {}) =>
      option(id, {
        kind: 'advisor',
        slot: 'political_advisor',
        group: 'government',
        character: id,
        cost: 10,
        ...extra,
      })
    const options = data([adv('stranger'), adv('hired', { recruited: true })])
    const plan = planOf(buy('stranger', 'hired'), options, [], 1000)
    expect(plan.unscheduled).toEqual([{ index: 0, optionId: 'stranger', reason: 'not-recruited' }])
    expect(plan.items.map((i) => i.optionId)).toEqual(['hired'])
    const leader = [
      line('add_political_power', '1000'),
      { depth: 0, key: 'promote_character', value: 'hired' },
    ]
    const led = planOf(buy('hired'), options, [], 0, {
      options: { tag: 'ROM', startDate: begin, start: leader },
    })
    expect(led.unscheduled[0].reason).toBe('is-leader')
  })

  it('recruits through a focus, which makes the advisor hireable', () => {
    const adv = option('later', {
      kind: 'advisor',
      slot: 'political_advisor',
      group: 'government',
      character: 'later',
      cost: 10,
    })
    const f = focus('f', [{ depth: 0, key: 'recruit_character', value: 'later' }])
    expect(daysOf(planOf(buy('later'), data([adv]), [f], 1000))).toEqual([70])
  })

  it('dismisses what is held, and skips what is not', () => {
    const options = data([option('a'), option('b', { slot: 'trade_laws' })])
    const plan = planOf(
      [{ optionId: 'a' }, { optionId: 'a', dismiss: true }, { optionId: 'b', dismiss: true }],
      options,
      [],
      1000,
    )
    expect(plan.items.map((i) => [i.optionId, i.dismiss, i.cost])).toEqual([
      ['a', false, 150],
      ['a', true, 0],
    ])
    expect(plan.unscheduled).toEqual([{ index: 2, optionId: 'b', reason: 'not-held' }])
  })

  it('does nothing for what is already held', () => {
    const plan = planOf(buy('a', 'a'), data([option('a')]), [], 1000)
    expect(plan.items.map((i) => i.issues)).toEqual([[], [{ kind: 'already-held' }]])
    expect(plan.items[1].cost).toBe(0)
  })

  it('caps the political power', () => {
    const capped = data([option('a')], { defines: { ...NO_FOCUS, cap: 100 } })
    expect(planOf(buy('a'), capped).unscheduled[0].reason).toBe('unaffordable')
    const roomy = data([option('a', { cost: 100 })], { defines: { ...NO_FOCUS, cap: 100 } })
    expect(daysOf(planOf(buy('a'), roomy))).toEqual([49])
    // Far later the balance has stopped at the cap.
    expect(
      planOf(
        buy('a'),
        data([option('a', { cost: 10 })], { defines: { ...NO_FOCUS, cap: 100 } }),
      ).balanceAt(day(900)),
    ).toBe(100)
  })

  it('does not buy before the not-before date', () => {
    const plan = planOf([{ optionId: 'a', notBefore: '1936-03-01' }], data([option('a')]), [], 1000)
    expect(daysOf(plan)).toEqual([59]) // 31 + 28: the game has no 29 February
    expect(plan.items[0].balanceAfter).toBeGreaterThan(1000 - 150)
  })

  it('earns faster after buying a law that adds political power, and cheaper with cost factors', () => {
    const boost = option('boost', { cost: 10, modifiers: [line('political_power_gain', '1', 0)] })
    const cheap = option('cheap', {
      kind: 'advisor',
      slot: 'political_advisor',
      group: 'government',
      character: 'cheap',
      recruited: true,
      cost: 150,
    })
    const discount = option('discount', {
      slot: 'trade_laws',
      cost: 10,
      modifiers: [line('political_advisor_cost_factor', '-0.5')],
    })
    const options = data([boost, cheap, discount])
    const base = planOf(buy('boost', 'cheap'), options)
    // 10 for the law on day 4 (2 to start with), then 3 a day: 150 takes 50 more days.
    expect(daysOf(base)).toEqual([4, 54])
    expect(base.gainAt(day(10))).toBe(3)
    const discounted = planOf(buy('discount', 'cheap'), options)
    expect(discounted.items[1].cost).toBe(75)
  })

  it('does not count timed ideas past their end', () => {
    const f = focus('f', [
      { depth: 0, key: 'add_timed_idea', value: 'boom', days: 30, valueName: 'boom' },
      line('political_power_gain', '3', 1),
    ])
    const plan = planOf([], data([]), [f])
    expect(plan.gainAt(day(80))).toBe(5)
    expect(plan.gainAt(day(101))).toBe(2)
    expect(plan.balanceAt(day(100))).toBe(2 + 2 * 70 + 5 * 30)
  })

  it('has nothing to plan without data', () => {
    const plan = planOf(buy('a'), undefined as unknown as PoliticsData, [], 0, { data: undefined })
    expect(plan.items).toEqual([])
    expect(plan.balanceAt(day(5))).toBe(0)
  })
})

describe('the purchase queue', () => {
  it('adds, avoids repeats, moves, removes and sets a not-before date', () => {
    let queue = addPurchase([], 'a')
    queue = addPurchase(queue, 'a')
    expect(queue).toEqual([{ optionId: 'a' }])
    queue = addPurchase(queue, 'a', true)
    queue = addPurchase(queue, 'b')
    expect(queue.map((i) => [i.optionId, Boolean(i.dismiss)])).toEqual([
      ['a', false],
      ['a', true],
      ['b', false],
    ])
    expect(movePurchase(queue, 2, -1).map((i) => i.optionId)).toEqual(['a', 'b', 'a'])
    expect(movePurchase(queue, 0, -1)).toBe(queue)
    expect(removePurchase(queue, 0).map((i) => i.optionId)).toEqual(['a', 'b'])
    queue = setNotBefore(queue, 2, '1937-01-01')
    expect(queue[2]).toEqual({ optionId: 'b', notBefore: '1937-01-01' })
    expect(setNotBefore(queue, 2, '')[2]).toEqual({ optionId: 'b' })
    expect(knownPurchases(queue, [option('a')]).map((i) => i.optionId)).toEqual(['a', 'a'])
  })
})

describe('planCampaign', () => {
  const tank: Technology = {
    id: 'tank1',
    name: 'tank1',
    cost: 1,
    startYear: 1936,
    folders: [{ id: 'f', x: 0, y: 0 }],
    categories: ['armor'],
    prerequisites: [],
    exclusiveWith: [],
    researchable: true,
    modifiers: [],
  }
  const research = {
    techs: [tank],
    folders: [{ id: 'f', name: 'f' }],
    defines: { baseCost: 110, aheadPenalty: 2, minSpeed: 0.1 },
  }
  const designer = option('works', {
    kind: 'designer',
    slot: 'tank_manufacturer',
    group: 'research_production',
    cost: 150,
    researchBonus: { armor: 0.5 },
  })
  const run = (politicsQueue: PoliticsItem[]) =>
    planCampaign({
      focusSchedule: schedulePlan([], {}, { startDate: begin, speedBonus: 0 }),
      options: {
        tag: 'ROM',
        startDate: begin,
        start: [line('add_political_power', '150'), line('add_research_slot', '1')],
      },
      researchQueue: [{ techId: 'tank1' }],
      researchData: research,
      politicsQueue,
      politicsData: data([designer]),
      startDate: begin,
      until: day(3000),
    })

  it('speeds research up with a designer bought on the first day', () => {
    const without = run([])
    const bought = run(buy('works'))
    expect(without.schedule.items[0].days).toBe(110)
    expect(bought.politics.items[0].date).toEqual(begin)
    expect(bought.schedule.items[0].days).toBe(Math.ceil(110 / 1.5))
  })

  it('moves research when the purchase moves', () => {
    const late = run([{ optionId: 'works', notBefore: '1936-02-01' }])
    // Bought on day 31: 31 days at the normal rate, then faster.
    expect(late.schedule.items[0].days).toBeGreaterThan(Math.ceil(110 / 1.5))
    expect(late.schedule.items[0].days).toBeLessThan(110)
  })
})
