import { describe, expect, it } from 'vitest'
import {
  collapseEffects,
  effectTone,
  flattenEffects,
  formatEffect,
  ideaIdsOf,
  markHidden,
  simplifyRandomStates,
} from '../focusEffects'
import { parseScript } from '../parsers/paradoxScript'

describe('hidden effects, custom tooltips and relations', () => {
  const effects = markHidden(
    collapseEffects(
      flattenEffects(
        parseScript(`
          custom_effect_tooltip = T_tt
          hidden_effect = { GER = { diplomatic_relation = { country = ROOT relation = military_access active = yes } } }
          after = yes
        `),
      ),
    ),
  )

  it('marks only lines inside hidden_effect as hidden', () => {
    expect(effects.map((e) => [e.key, !!e.hidden])).toEqual([
      ['custom_effect_tooltip', false],
      ['hidden_effect', true],
      ['GER', true],
      ['diplomatic_relation', true],
      ['after', false],
    ])
  })

  it('collapses diplomatic_relation and formats it, the tooltip text and the hidden header', () => {
    const relation = effects[3]
    expect(relation).toMatchObject({ value: 'military_access', subject: 'ROOT', active: true })
    expect(
      formatEffect({ ...relation, valueName: 'Military access', subjectName: 'Romania' }),
    ).toBe('Military access with Romania: yes')
    expect(formatEffect({ ...relation, active: false, subject: 'ROOT' })).toBe(
      'military access with us: no',
    )
    expect(formatEffect({ ...effects[0], valueName: 'Permit troops.\n' })).toBe('Permit troops.')
    expect(formatEffect(effects[1])).toBe('Hidden effect:')
  })
})

describe('random owned controlled states', () => {
  const run = (text: string) =>
    simplifyRandomStates(collapseEffects(flattenEffects(parseScript(text))))

  it('moves prioritize onto the header and drops the limit', () => {
    const effects = run(`random_owned_controlled_state = {
      prioritize = { 46 79 }
      limit = { ROOT = { has_full_control_of_state = PREV } }
      add_resource = { type = oil amount = 8 }
    }`)
    expect(effects).toEqual([
      { depth: 0, key: 'random_owned_controlled_state', preferStates: ['46', '79'] },
      { depth: 1, key: 'add_resource', value: '8', subject: 'oil' },
    ])
  })

  it('drops any limit, including ones about building slots', () => {
    const effects = run(`random_owned_controlled_state = {
      limit = { free_building_slots = { building = arms_factory } }
      some_other_effect = yes
    }`)
    expect(effects.map((e) => e.key)).toEqual([
      'random_owned_controlled_state',
      'some_other_effect',
    ])
  })

  it('formats the header and resource lines', () => {
    const [header, resource] = run(
      'random_owned_controlled_state = { prioritize = { 46 } add_resource = { type = oil amount = 8 } }',
    )
    expect(formatEffect({ ...header, preferNames: ['Muntenia'] })).toBe(
      'Random owned and controlled state (prioritize Muntenia):',
    )
    expect(formatEffect({ ...header, preferStates: undefined })).toBe(
      'Random owned and controlled state:',
    )
    expect(formatEffect(resource)).toBe('Add production of 8 Oil')
    expect(formatEffect({ ...resource, subjectName: 'Steel', value: '-3' })).toBe(
      'Remove production of 3 Steel',
    )
    expect(effectTone(resource)).toBe('good')
    expect(effectTone({ ...resource, value: '-3' })).toBe('bad')
  })
})

describe('simple effects', () => {
  const run = (text: string) => collapseEffects(flattenEffects(parseScript(text)))

  it('treats number effects as stats', () => {
    const [stability, pp] = run('add_stability = -0.05 add_political_power = 120')
    expect(stability).toMatchObject({ key: 'add_stability', value: '-0.05', isModifier: true })
    expect(pp).toMatchObject({ key: 'add_political_power', isModifier: true })
  })

  it('drops bookkeeping flags, and a hidden_effect left empty by that', () => {
    expect(
      run('set_country_flag = x hidden_effect = { set_state_flag = y } add_ideas = I'),
    ).toEqual([{ depth: 0, key: 'add_ideas', value: 'I' }])
    expect(run('hidden_effect = { set_country_flag = x news_event = { id = n.1 } }')).toEqual([
      { depth: 0, key: 'hidden_effect' },
      { depth: 1, key: 'news_event', value: 'n.1' },
    ])
  })

  it('turns set_rule into a yes/no rule line', () => {
    expect(run('set_rule = { can_create_factions = yes }')).toEqual([
      { depth: 0, key: 'can_create_factions', value: 'yes', isModifier: true, isRule: true },
    ])
  })

  it('collapses remove_opinion_modifier and add_timed_idea', () => {
    const [remove, timed] = run(
      'remove_opinion_modifier = { target = ROM modifier = M } add_timed_idea = { idea = I days = 360 }',
    )
    expect(remove).toEqual({ depth: 0, key: 'remove_opinion_modifier', value: 'M', subject: 'ROM' })
    expect(formatEffect({ ...remove, valueName: 'Pact', subjectName: 'Romania' })).toBe(
      'Remove Pact opinion modifier with Romania',
    )
    expect(timed).toEqual({ depth: 0, key: 'add_timed_idea', value: 'I', days: 360 })
    expect(formatEffect({ ...timed, valueName: 'Accounts' })).toBe(
      'Add timed idea: Accounts (360 days)',
    )
  })

  it('formats news and tooltip-only effects, and finds more idea lines', () => {
    expect(formatEffect({ depth: 0, key: 'news_event', value: 'n.1', eventTitle: 'Coup' })).toBe(
      'News: Coup',
    )
    expect(
      formatEffect({ depth: 0, key: 'unlock_decision_tooltip', value: 'd', valueName: 'Join' }),
    ).toBe('Unlocks decision: Join')
    const effects = run('swap_ideas = { add_idea = A remove_idea = B } show_ideas_tooltip = C')
    // Removed ideas are included too, since their modifiers are shown reversed.
    expect(ideaIdsOf(effects)).toEqual(['A', 'C', 'B'])
  })
})

describe('doctrine cost reductions', () => {
  const [line] = collapseEffects(
    flattenEffects(
      parseScript(
        'add_doctrine_cost_reduction = { name = N cost_reduction = 0.35 uses = 2 category = land_doctrine }',
      ),
    ),
  )

  it('collapses into one line with the category as its value', () => {
    expect(line).toEqual({
      depth: 0,
      key: 'add_doctrine_cost_reduction',
      value: 'land_doctrine',
      doctrine: { reduction: 0.35, uses: 2, name: 'N' },
    })
  })

  it('formats as "2x 35% cost reduction for: Land Doctrine" in green', () => {
    expect(formatEffect({ ...line, valueName: 'Land Doctrine' })).toBe(
      '2x 35% cost reduction for: Land Doctrine',
    )
    expect(formatEffect(line)).toBe('2x 35% cost reduction for: land doctrine')
    expect(effectTone(line)).toBe('good')
  })
})

describe('research, building and design effects', () => {
  const lines = (script: string) =>
    collapseEffects(flattenEffects(parseScript(script))).map((e) => formatEffect(e))

  it('reads tech bonuses with several categories and the ahead-of-time penalty', () => {
    expect(
      lines(
        'add_tech_bonus = { name = N bonus = 1.0 uses = 2 category = a category = b ahead_reduction = 2 }',
      ),
    ).toEqual(['2x 100% research bonus for: a, b, ignores 2 years of ahead-of-time penalty'])
  })

  it('reads mastery bonuses and technology unlocks', () => {
    expect(lines('add_mastery_bonus = { name = N bonus = 0.2 days = 240 track = air }')).toEqual([
      'Doctrine mastery: +20% for 240 days on air',
    ])
    expect(lines('set_technology = { mountain_gun = 1 }')).toEqual([
      'Unlocks technology: mountain gun',
    ])
  })

  it('reads buildings, slots and equipment designs', () => {
    expect(
      lines('add_building_construction = { type = arms_factory level = 2 instant_build = yes }'),
    ).toEqual(['Build 2 arms factory (instantly)'])
    // The label ("Building slots") comes from statOverrides at import, so it is the key here.
    expect(lines('add_extra_state_shared_building_slots = 2')).toEqual([
      'add extra state shared building slots: +2',
    ])
    expect(
      lines('create_equipment_variant = { name = "IAR 80" type = x modules = { a = b } }'),
    ).toEqual(['Create design: IAR 80'])
  })
})
