import { describe, expect, it } from 'vitest'
import { addDays } from '../calendar'
import type { EffectLine, Focus } from '../focus'
import { countryStateAt } from '../campaign/countryState'
import { schedulePlan } from '../plan/focusPlan'

const focus = (id: string, effects: EffectLine[], days = 70): Focus => ({
  id,
  name: id.toUpperCase(),
  days,
  prerequisites: [],
  mutuallyExclusive: [],
  x: 0,
  y: 0,
  effects,
})

const stat = (key: string) => ({ key, kind: 'percent' as const })
const modifier = (depth: number, key: string, value: string): EffectLine => ({
  depth,
  key,
  value,
  isModifier: true,
  stat: stat(key),
})

const start = new Date(Date.UTC(1936, 0, 1))
const day = (n: number) => addDays(start, n)

const stateAt = (focuses: Focus[], days: number) =>
  countryStateAt(
    schedulePlan(
      focuses.map((f) => f.id),
      Object.fromEntries(focuses.map((f) => [f.id, f])),
      { startDate: start, speedBonus: 0 },
    ),
    day(days),
    { tag: 'ROM' },
  )

const ideaFocus = (id: string, idea: string, mods: EffectLine[]) =>
  focus(id, [{ depth: 0, key: 'add_ideas', value: idea, valueName: idea }, ...mods])

describe('countryStateAt', () => {
  it('replaces the active law of a category when a new law is added', () => {
    const focuses = [
      ideaFocus('a', 'civilian_economy', [modifier(1, 'consumer_goods_expected_value', '0.35')]),
      ideaFocus('b', 'other_idea', []),
      ideaFocus('c', 'war_economy', [modifier(1, 'consumer_goods_expected_value', '0.2')]),
    ]
    const s = countryStateAt(
      schedulePlan(
        focuses.map((f) => f.id),
        Object.fromEntries(focuses.map((f) => [f.id, f])),
        { startDate: start, speedBonus: 0 },
      ),
      day(210),
      {
        tag: 'ROM',
        laws: {
          civilian_economy: 'economy',
          war_economy: 'economy',
          volunteer_only: 'mobilization',
        },
      },
    )
    expect(s.ideas.map((i) => i.id)).toEqual(['other_idea', 'war_economy'])
    expect(s.modifierTotals.map((t) => [t.key, t.total])).toEqual([
      ['consumer_goods_expected_value', 0.2],
    ])
  })

  it('is empty before the first focus completes', () => {
    const s = stateAt([ideaFocus('a', 'idea_a', [modifier(1, 'x', '0.1')])], 69)
    expect(s.completed).toHaveLength(0)
    expect(s.next?.focus.id).toBe('a')
    expect(s.ideas).toEqual([])
    expect(s.modifierTotals).toEqual([])
  })

  it('adds ideas with their modifiers and sums them', () => {
    const s = stateAt(
      [
        ideaFocus('a', 'idea_a', [modifier(1, 'x', '0.1')]),
        ideaFocus('b', 'idea_b', [modifier(1, 'x', '0.05')]),
      ],
      140,
    )
    expect(s.ideas.map((i) => i.id)).toEqual(['idea_a', 'idea_b'])
    expect(s.ideas[0].modifiers[0].depth).toBe(0)
    expect(s.modifierTotals).toMatchObject([{ key: 'x', total: 0.15 }])
    expect(s.next).toBeUndefined()
  })

  it('removes an idea that a later focus removes', () => {
    const s = stateAt(
      [
        ideaFocus('a', 'idea_a', [modifier(1, 'x', '0.1')]),
        focus('b', [{ depth: 0, key: 'remove_ideas', value: 'idea_a' }]),
      ],
      140,
    )
    expect(s.ideas).toEqual([])
    expect(s.modifierTotals).toEqual([])
  })

  it('stops counting a timed idea once it runs out', () => {
    const timed = focus('a', [
      { depth: 0, key: 'add_timed_idea', value: 'idea_t', valueName: 'T', days: 30 },
      modifier(1, 'x', '0.1'),
    ])
    expect(stateAt([timed], 80).ideas).toHaveLength(1)
    expect(stateAt([timed], 101).ideas).toHaveLength(0)
  })

  it('sums one-off stat changes without counting idea modifiers twice', () => {
    const s = stateAt(
      [
        focus('a', [
          modifier(0, 'add_stability', '0.05'),
          { depth: 0, key: 'add_ideas', value: 'i', valueName: 'I' },
          modifier(1, 'x', '0.1'),
        ]),
        focus('b', [modifier(0, 'add_stability', '0.03')]),
      ],
      140,
    )
    expect(s.statChanges).toMatchObject([{ key: 'add_stability', total: 0.08 }])
  })

  it('sums popularity per ideology and tracks the ruling party', () => {
    const pop = (subject: string, value: string): EffectLine => ({
      ...modifier(0, 'add_popularity', value),
      subject,
      subjectName: subject,
    })
    const s = stateAt(
      [
        focus('a', [pop('fascism', '0.1'), pop('communism', '0.05')]),
        focus('b', [
          pop('fascism', '0.1'),
          { depth: 0, key: 'set_politics', value: 'fascism', valueName: 'Fascism' },
        ]),
      ],
      140,
    )
    expect(s.popularity).toMatchObject([
      { subject: 'fascism', total: 0.2 },
      { subject: 'communism', total: 0.05 },
    ])
    expect(s.rulingParty).toBe('Fascism')
  })

  it('lists conditional effects without applying them', () => {
    const s = stateAt(
      [
        focus('a', [
          { depth: 0, key: 'if', condition: 'x' },
          modifier(1, 'add_stability', '0.5'),
          modifier(0, 'add_political_power', '50'),
        ]),
      ],
      80,
    )
    expect(s.statChanges).toMatchObject([{ key: 'add_political_power', total: 50 }])
    expect(s.conditional).toHaveLength(1)
    expect(s.conditional[0].lines.map((l) => l.key)).toEqual(['if', 'add_stability'])
  })

  it('skips other countries and states but looks into hidden effects and its own scope', () => {
    const s = stateAt(
      [
        focus('a', [
          { depth: 0, key: 'SOV' },
          modifier(1, 'add_stability', '0.5'),
          { depth: 0, key: '46' },
          modifier(1, 'add_political_power', '50'),
          { depth: 0, key: 'hidden_effect' },
          modifier(1, 'army_experience', '10'),
          { depth: 0, key: 'ROM' },
          modifier(1, 'navy_experience', '5'),
        ]),
      ],
      80,
    )
    expect(s.statChanges.map((c) => c.key)).toEqual(['army_experience', 'navy_experience'])
  })

  it('names the leader from a character scope', () => {
    const s = stateAt(
      [
        focus('a', [
          { depth: 0, key: 'ROM_ion_antonescu', subjectName: 'Ion Antonescu' },
          { depth: 1, key: 'add_country_leader_role', value: 'promote' },
        ]),
      ],
      80,
    )
    expect(s.leader?.name).toBe('Ion Antonescu')
  })
})

describe('countryStateAt with a starting state', () => {
  const startLines: EffectLine[] = [
    { depth: 0, key: 'add_stability', value: '0.6', isModifier: true, stat: stat('add_stability') },
    { depth: 0, key: 'set_politics', value: 'democratic', valueName: 'Democratic' },
    { depth: 0, key: 'add_ideas', value: 'start_idea', valueName: 'Start' },
    modifier(1, 'x', '0.1'),
  ]

  it('applies the start before any focus, with the plan adding to it', () => {
    const plus = focus('a', [
      {
        depth: 0,
        key: 'add_stability',
        value: '0.05',
        isModifier: true,
        stat: stat('add_stability'),
      },
    ])
    const schedule = schedulePlan(['a'], { a: plus }, { startDate: start, speedBonus: 0 })
    const before = countryStateAt(schedule, day(0), { start: startLines, startDate: start })
    expect(before.ideas).toMatchObject([{ id: 'start_idea', focusId: '__start__' }])
    expect(before.rulingParty).toBe('Democratic')
    expect(before.statChanges).toMatchObject([{ key: 'add_stability', total: 0.6 }])
    expect(before.modifierTotals).toMatchObject([{ key: 'x', total: 0.1 }])
    const after = countryStateAt(schedule, day(70), { start: startLines, startDate: start })
    expect(after.statChanges).toMatchObject([{ key: 'add_stability', total: 0.65 }])
    expect(after.completed).toHaveLength(1)
  })
})

describe('leader traits added after the leader', () => {
  it('lists a trait a later focus adds, with its stats, and drops it when removed', () => {
    const leaderFocus = focus('a', [
      { depth: 0, key: 'create_country_leader', value: 'Carol II', traits: ['hedonist'] },
      { depth: 1, key: 'leader_trait', value: 'hedonist' },
      modifier(2, 'stability_factor', '-0.05'),
    ])
    const traitFocus = focus('b', [
      {
        depth: 0,
        key: 'add_country_leader_trait',
        value: 'camarilla_leader',
        valueName: 'Camarilla Leader',
      },
      modifier(1, 'economy_cost_factor', '-0.25'),
    ])
    const dropFocus = focus('c', [
      { depth: 0, key: 'remove_country_leader_trait', value: 'hedonist' },
    ])
    const s = stateAt([leaderFocus, traitFocus], 140)
    expect(s.leader?.traits.map((t) => t.key)).toEqual([
      'leader_trait',
      'stability_factor',
      'leader_trait',
      'economy_cost_factor',
    ])
    expect(s.modifierTotals.map((t) => t.key).sort()).toEqual([
      'economy_cost_factor',
      'stability_factor',
    ])
    expect(s.statChanges).toEqual([])
    const after = stateAt([leaderFocus, traitFocus, dropFocus], 210)
    expect(after.leader?.traits.map((t) => t.value)).toEqual(['camarilla_leader', '-0.25'])
  })
})

describe('resources and construction', () => {
  const f = focus('a', [
    { depth: 0, key: 'random_owned_controlled_state', preferStates: ['46'] },
    { depth: 1, key: 'add_resource', value: '8', subject: 'oil', subjectName: 'Oil' },
    { depth: 1, key: 'add_stability', value: '0.01' },
    { depth: 1, key: 'add_extra_state_shared_building_slots', value: '2' },
    {
      depth: 0,
      key: 'add_building_construction',
      value: '1',
      subject: 'industrial_complex',
      instant: true,
    },
    { depth: 0, key: '46' },
    { depth: 1, key: 'add_resource', value: '4', subject: 'oil', subjectName: 'Oil' },
    { depth: 1, key: 'add_resource', value: '2', subject: 'steel', subjectName: 'Steel' },
    { depth: 0, key: 'GER' },
    { depth: 1, key: 'random_owned_controlled_state' },
    { depth: 2, key: 'add_resource', value: '5', subject: 'steel', subjectName: 'Steel' },
  ])

  it('sums resources by type, including own state scopes but not other countries', () => {
    const s = stateAt([f], 70)
    expect(s.resources).toEqual([
      { type: 'oil', name: 'Oil', total: 12 },
      { type: 'steel', name: 'Steel', total: 2 },
    ])
  })

  it('sums buildings per type, and keeps other effects of a random block as conditional', () => {
    const more = focus('b', [
      { depth: 0, key: 'random_owned_controlled_state' },
      { depth: 1, key: 'add_extra_state_shared_building_slots', value: '1' },
      {
        depth: 1,
        key: 'add_building_construction',
        value: '1',
        subject: 'industrial_complex',
        instant: true,
      },
    ])
    const s = stateAt([f, more], 140)
    expect(s.buildingSlots).toBe(3)
    expect(s.buildings).toEqual([
      { type: 'industrial_complex', name: 'industrial_complex', total: 2, instant: true },
    ])
    expect(s.conditional[0].lines.map((l) => l.key)).toEqual([
      'random_owned_controlled_state',
      'add_stability',
    ])
  })
})

describe('construction batches', () => {
  it('records one batch per block with its state, preferred states and buildings', () => {
    const f = focus('a', [
      { depth: 0, key: 'random_owned_controlled_state', preferStates: ['79', '81'] },
      {
        depth: 1,
        key: 'add_building_construction',
        value: '2',
        subject: 'arms_factory',
        subjectName: 'Military factory',
        instant: true,
      },
      { depth: 1, key: 'add_extra_state_shared_building_slots', value: '1' },
      { depth: 0, key: '46' },
      { depth: 1, key: 'add_resource', value: '4', subject: 'oil', subjectName: 'Oil' },
    ])
    const s = stateAt([f], 70)
    expect(s.construction).toEqual([
      {
        focusId: 'a',
        focusName: 'A',
        date: day(70),
        state: undefined,
        prefer: [79, 81],
        random: true,
        buildings: [{ type: 'arms_factory', name: 'Military factory', level: 2, instant: true }],
        slots: 1,
        resources: [],
      },
      {
        focusId: 'a',
        focusName: 'A',
        date: day(70),
        state: 46,
        prefer: undefined,
        random: false,
        buildings: [],
        slots: 0,
        resources: [{ type: 'oil', name: 'Oil', amount: 4 }],
      },
    ])
  })
})

describe('conditions on having an idea', () => {
  const remove = (idea: string): EffectLine[] => [
    { depth: 0, key: 'if', condition: `has idea: ${idea}`, check: { type: 'idea', id: idea } },
    { depth: 1, key: 'remove_ideas', value: idea },
    { depth: 1, key: 'else' },
    {
      depth: 2,
      key: 'if',
      condition: 'has idea: b',
      check: { type: 'idea', id: 'idea_b' },
    },
    { depth: 3, key: 'remove_ideas', value: 'idea_b' },
  ]

  it('removes whichever idea the country has, and nothing is left as conditional', () => {
    const give = (id: string) => ideaFocus(`give_${id}`, id, [])
    const s = stateAt([give('idea_b'), focus('r', remove('idea_a'))], 140)
    expect(s.ideas).toEqual([])
    expect(s.conditional).toEqual([])
    const kept = stateAt([give('idea_a'), give('idea_b'), focus('r', remove('idea_a'))], 210)
    expect(kept.ideas.map((i) => i.id)).toEqual(['idea_b'])
  })

  it('does nothing when the country has none of the ideas', () => {
    const s = stateAt([focus('r', remove('idea_a'))], 70)
    expect(s.ideas).toEqual([])
    expect(s.conditional).toEqual([])
  })

  it('applies a swap guarded by NOT has idea', () => {
    const swap = focus('s', [
      {
        depth: 0,
        key: 'if',
        condition: 'not has idea',
        check: { type: 'not', of: { type: 'idea', id: 'new' } },
      },
      { depth: 1, key: 'swap_ideas' },
      { depth: 2, key: 'remove_idea', value: 'old' },
      { depth: 2, key: 'add_idea', value: 'new', valueName: 'New' },
    ])
    const s = stateAt([ideaFocus('o', 'old', []), swap], 140)
    expect(s.ideas.map((i) => i.id)).toEqual(['new'])
  })
})

describe('the game picking a new leader', () => {
  const candidate = (group: string, character: string) => ({
    group,
    line: {
      depth: 0,
      key: 'promote_character',
      value: character,
      valueName: character.toUpperCase(),
    },
  })
  const leaders = {
    candidates: [
      candidate('neutrality', 'n1'),
      candidate('democratic', 'd1'),
      candidate('democratic', 'd2'),
    ],
    groups: { despotism: 'neutrality' },
  }
  const carol = focus('carol', [
    {
      depth: 0,
      key: 'create_country_leader',
      value: 'Carol II',
      subject: 'despotism',
      leaderId: '550',
    },
    { depth: 0, key: 'set_politics', value: 'neutrality' },
  ])
  const at = (focuses: Focus[]) =>
    countryStateAt(
      schedulePlan(
        focuses.map((f) => f.id),
        Object.fromEntries(focuses.map((f) => [f.id, f])),
        { startDate: start, speedBonus: 0 },
      ),
      day(70 * focuses.length),
      { tag: 'ROM', leaders },
    )

  it('keeps a leader created together with the party they lead for', () => {
    expect(at([carol]).leader).toMatchObject({ name: 'Carol II' })
  })

  it('picks the ruling party’s first candidate when the leader is retired', () => {
    const retire = focus('retire', [
      { depth: 0, key: 'retire_country_leader', value: 'yes' },
      { depth: 0, key: 'set_politics', value: 'democratic' },
    ])
    const s = at([carol, retire])
    expect(s.leader).toMatchObject({ name: 'D1', character: 'd1' })
    expect(s.rulingParty).toBe('democratic')
  })

  it('switches leader when the party changes away from the one they lead for', () => {
    const swing = focus('swing', [{ depth: 0, key: 'set_politics', value: 'democratic' }])
    expect(at([carol, swing]).leader).toMatchObject({ character: 'd1' })
  })

  it('moves on to the next candidate when the picked one is retired in turn', () => {
    const toDemocratic = focus('to', [{ depth: 0, key: 'set_politics', value: 'democratic' }])
    const retire = focus('retire', [{ depth: 0, key: 'retire_country_leader', value: 'yes' }])
    expect(at([carol, toDemocratic, retire]).leader).toMatchObject({ character: 'd2' })
  })

  it('leaves a leader the reward made itself, and everything without candidate data', () => {
    const own = focus('own', [
      { depth: 0, key: 'set_politics', value: 'democratic' },
      { depth: 0, key: 'promote_character', value: 'x', subject: 'despotism' },
    ])
    expect(at([carol, own]).leader).toMatchObject({ character: 'x' })
    const swing = focus('swing', [{ depth: 0, key: 'set_politics', value: 'democratic' }])
    const bare = countryStateAt(
      schedulePlan(['carol', 'swing'], { carol, swing }, { startDate: start, speedBonus: 0 }),
      day(140),
      { tag: 'ROM' },
    )
    expect(bare.leader).toMatchObject({ name: 'Carol II' })
  })
})
