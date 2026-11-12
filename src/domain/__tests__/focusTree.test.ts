import { describe, expect, it } from 'vitest'
import {
  collapseEffects,
  foldConditions,
  unwrapEventConditions,
  effectTone,
  flattenEffects,
  formatEffect,
  ideaIdsOf,
  markHidden,
  simplifyRandomStates,
} from '../focusEffects'
import { parseFocusTreeFile } from '../focusTree'
import { parseIdeas } from '../ideas'
import { parseOpinionModifiers } from '../opinionModifiers'
import { parseStaticModifiers } from '../staticModifiers'
import { parseEventTitles } from '../events'
import { parseFactionTemplates } from '../factions'
import { resolveEventText } from '../localisation'
import { formatStatValue, parseStatDocs, resolveStat, statTone } from '../stats'
import { cleanLocalisation, parseLocalisation } from '../localisation'
import { parseScript } from '../paradoxScript'

const sample = `
﻿focus_tree = {
  id = test_tree
  # focus = { id = COMMENTED_OUT }
  focus = {
    id = T_one
    mutually_exclusive = { focus = T_two focus = T_three }
    cost = 10
    x = -2
    y = 0
    available = { NOT = { has_war_with = SOU } size > 0 has_dlc = "A # B" }
  }
  focus = {
    id = T_two
    prerequisite = { focus = T_one }
    prerequisite = { focus = T_a focus = T_b } # OR group
    cost = 0.5
    x = 1
    y = 2
    relative_position_id = T_one
    completion_reward = {
      add_ideas = T_idea
      add_popularity = { ideology = communism popularity = 0.1 }
    }
  }
  focus = { id = T_default }
}
`

describe('parseScript', () => {
  it('handles comparison operators, quoted strings with # and bare values', () => {
    const block = parseScript('a = { size > 0 name = "x # y" b c }')
    const inner = block[0].value as { key: string | null; operator: string; value: unknown }[]
    expect(inner[0]).toMatchObject({ key: 'size', operator: '>', value: '0' })
    expect(inner[1]).toMatchObject({ key: 'name', value: 'x # y' })
    expect(inner[2]).toMatchObject({ key: null, value: 'b' })
  })
})

describe('parseFocusTreeFile', () => {
  const focuses = parseFocusTreeFile(sample)

  it('ignores commented-out focuses', () => {
    expect(focuses.map((f) => f.id)).toEqual(['T_one', 'T_two', 'T_default'])
  })

  it('converts cost in weeks to days, defaulting to 10 weeks', () => {
    expect(focuses.map((f) => f.days)).toEqual([70, 3.5, 70])
  })

  it('reads positions, defaulting to 0', () => {
    expect(focuses[1]).toMatchObject({ x: 1, y: 2, relativeTo: 'T_one' })
    expect(focuses[0]).toMatchObject({ x: -2, y: 0, relativeTo: undefined })
    expect(focuses[2]).toMatchObject({ x: 0, y: 0 })
  })

  it('reads each prerequisite block as an OR group and exclusivity as a list', () => {
    expect(focuses[1].prerequisites).toEqual([['T_one'], ['T_a', 'T_b']])
    expect(focuses[0].mutuallyExclusive).toEqual(['T_two', 'T_three'])
  })
})

describe('focus effects', () => {
  it('collapses add_popularity into one stat line', () => {
    const effects = parseFocusTreeFile(sample)[1].effects
    expect(effects).toContainEqual({
      depth: 0,
      key: 'add_popularity',
      value: '0.1',
      subject: 'communism',
      isModifier: true,
    })
  })

  it('flattens completion_reward into depth-annotated lines, collapsing popularity', () => {
    expect(parseFocusTreeFile(sample)[1].effects).toEqual([
      { depth: 0, key: 'add_ideas', value: 'T_idea' },
      { depth: 0, key: 'add_popularity', value: '0.1', subject: 'communism', isModifier: true },
    ])
    expect(parseFocusTreeFile(sample)[0].effects).toEqual([])
  })
})

describe('cleanLocalisation', () => {
  it('strips colour codes, resolves newlines and dynamic text', () => {
    expect(cleanLocalisation('§Ya§! [SOU.GetNameDefCap]\\nb [?x|G] c')).toBe('a SOU\nb  c')
  })
})

describe('parseLocalisation', () => {
  it('parses both key formats and filters wanted keys', () => {
    const yml = '﻿l_english:\n T_one:0 "One"\n T_two: "Two" # note\n OTHER:1 "x"\n'
    expect(parseLocalisation(yml, new Set(['T_one', 'T_two']))).toEqual({
      T_one: 'One',
      T_two: 'Two',
    })
  })
})

describe('ideas', () => {
  const ideasText = `ideas = { country = {
    T_idea = { removal_cost = -1 modifier = { guarantee_cost = -0.5 industrial_capacity_factory = 0.05 } }
    OTHER = { modifier = { x = 1 } }
  } }`

  it('extracts only wanted ideas, with their modifier lines', () => {
    expect(parseIdeas(ideasText, new Set(['T_idea']))).toEqual({
      T_idea: [
        { depth: 0, key: 'guarantee_cost', value: '-0.5', isModifier: true },
        { depth: 0, key: 'industrial_capacity_factory', value: '0.05', isModifier: true },
      ],
    })
  })

  it('finds idea lines in both add_ideas forms', () => {
    const effects = flattenEffects(
      parseScript('add_ideas = A add_ideas = { B C } other = { add_ideas = D } x = E'),
    )
    expect(ideaIdsOf(effects)).toEqual(['A', 'B', 'C', 'D'])
  })
})

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
    expect(ideaIdsOf(effects)).toEqual(['A', 'C'])
  })
})

describe('wargoals', () => {
  it('collapses create_wargoal, dropping the generator states', () => {
    const [line] = collapseEffects(
      flattenEffects(
        parseScript(
          'create_wargoal = { type = take_state_focus target = SOV generator = { 834 } }',
        ),
      ),
    )
    expect(line).toEqual({
      depth: 0,
      key: 'create_wargoal',
      value: 'take_state_focus',
      subject: 'SOV',
    })
    expect(
      formatEffect({ ...line, valueName: 'Conquer (Focus)', subjectName: 'Soviet Union' }),
    ).toBe('Gain Conquer (Focus) wargoal on Soviet Union')
    expect(formatEffect({ ...line, value: 'annex_everything' })).toBe(
      'Gain annex everything wargoal on SOV',
    )
  })
})

describe('events', () => {
  it('collapses both country_event forms to the id, ignoring the delay', () => {
    const lines = collapseEffects(
      flattenEffects(
        parseScript('country_event = { id = A.1 hours = 12 random_hours = 6 } country_event = B.2'),
      ),
    )
    expect(lines).toEqual([
      { depth: 0, key: 'country_event', value: 'A.1' },
      { depth: 0, key: 'country_event', value: 'B.2' },
    ])
    expect(formatEffect({ ...lines[0], eventTitle: 'Hello' })).toBe('Event: Hello')
    expect(formatEffect(lines[0])).toBe('Event: A.1')
  })

  it('finds event titles, including conditional ones', () => {
    const titles = parseEventTitles(
      `namespace = x
       country_event = { id = x.1 title = x.1.t }
       country_event = { id = x.2 title = { text = x.2.t trigger = { always = yes } } }
       country_event = { id = x.3 title = x.3.t }`,
      new Set(['x.1', 'x.2']),
    )
    expect(titles).toEqual({ 'x.1': 'x.1.t', 'x.2': 'x.2.t' })
  })

  it('resolves From, Root and the faction name, falling back to "our faction"', () => {
    const raw = '[From.GetNameDefCap] seeks to join the [Root.GetFactionName]'
    expect(resolveEventText(raw, { from: 'Romania', root: 'Germany', rootFaction: 'Axis' })).toBe(
      'Romania seeks to join the Axis',
    )
    expect(resolveEventText(raw, { from: 'Romania', root: 'Germany' })).toBe(
      'Romania seeks to join our faction',
    )
  })

  it('reads faction template names', () => {
    expect(
      parseFactionTemplates('t = { name = Axis icon = X } u = { name = Y }', new Set(['t'])),
    ).toEqual({ t: 'Axis' })
  })
})

describe('relation modifiers', () => {
  it('collapses add_relation_modifier and formats it', () => {
    const [line] = collapseEffects(
      flattenEffects(parseScript('add_relation_modifier = { target = GER modifier = M }')),
    )
    expect(line).toEqual({ depth: 0, key: 'add_relation_modifier', value: 'M', subject: 'GER' })
    expect(formatEffect({ ...line, valueName: 'License', subjectName: 'German Reich' })).toBe(
      'Gains License when dealing with German Reich',
    )
  })

  it('reads only non-zero numeric stats from a static modifier', () => {
    const defs = parseStaticModifiers(
      `M = { valid_relation_trigger = { FROM = { NOT = { has_war_with = ROOT } } }
             license_purchase_cost = 0 license_production_speed = 0.25 }
       OTHER = { x = 1 }`,
      new Set(['M']),
    )
    expect(defs).toEqual({
      M: [{ depth: 0, key: 'license_production_speed', value: '0.25', isModifier: true }],
    })
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

describe('opinion modifiers', () => {
  it('collapses add_opinion_modifier and reads definitions', () => {
    const effects = collapseEffects(
      flattenEffects(
        parseScript('add_opinion_modifier = { target = SOV modifier = X } SOV = { y = 1 }'),
      ),
    )
    expect(effects[0]).toEqual({
      depth: 0,
      key: 'add_opinion_modifier',
      value: 'X',
      subject: 'SOV',
    })
    const defs = parseOpinionModifiers(
      'opinion_modifiers = { X = { value = 40 years = 2 } Y = { value = -5 } }',
      new Set(['X', 'Y']),
    )
    expect(defs).toEqual({ X: { value: 40, months: 24 }, Y: { value: -5, months: undefined } })
  })

  it('formats and colours opinion lines', () => {
    const line = {
      depth: 0,
      key: 'add_opinion_modifier',
      value: 'X',
      valueName: 'Deal',
      subject: 'SOV',
      subjectName: 'Russia',
      opinion: { value: 40, months: 24 },
    }
    expect(formatEffect(line)).toBe('Opinion of Russia: +40 (Deal, 24 months)')
    expect(formatEffect({ ...line, opinion: { value: -5 } })).toBe('Opinion of Russia: -5 (Deal)')
    expect(effectTone({ ...line, opinion: { value: -5 } })).toBe('bad')
    expect(formatEffect({ ...line, subject: 'ROOT', subjectName: undefined })).toContain('of us')
    expect(effectTone(line)).toBe('good')
  })
})

describe('stats', () => {
  it('colours popularity gains green and losses red', () => {
    const stat = { key: 'add_popularity', goodWhen: 'positive' as const }
    expect(statTone(stat, '0.1')).toBe('good')
    expect(statTone(stat, '-0.1')).toBe('bad')
  })

  const docs = parseStatDocs(
    '## a_factor\n\n* Number with 2 decimal places\n\n## flag_x\n\n* Boolean\n',
  )

  it('parses decimals and flags from the documentation', () => {
    expect(docs).toEqual({ a_factor: { decimals: 2 }, flag_x: { kind: 'flag' } })
  })

  it('prefers overrides over docs over guesses', () => {
    const stat = resolveStat('a_factor', 'A', docs, { a_factor: { kind: 'number' } })
    expect(stat).toMatchObject({ label: 'A', decimals: 2, kind: 'number' })
  })

  it('formats percent, number and flag values', () => {
    expect(formatStatValue({ key: 'x', kind: 'percent', decimals: 0 }, '-0.5')).toBe('-50%')
    expect(formatStatValue({ key: 'x_factor' }, '0.05')).toBe('+5%')
    expect(formatStatValue({ key: 'x', kind: 'percent', decimals: 0 }, '-1.0')).toBe('-100%')
    expect(formatStatValue({ key: 'x', kind: 'number', decimals: 1 }, '-1.5')).toBe('-1.5')
    expect(formatStatValue({ key: 'x' }, '10')).toBe('+10')
    expect(formatStatValue({ key: 'x' }, '0.25')).toBe('+25%')
    expect(formatStatValue({ key: 'x', kind: 'flag' }, 'yes')).toBe('yes')
  })

  it('reads idea rules as yes/no lines, green for yes and red for no', () => {
    const ideas = parseIdeas(
      'ideas = { c = { I = { rule = { can_x = yes } modifier = { a = 1 } } } }',
      new Set(['I']),
    )
    expect(ideas.I).toEqual([
      { depth: 0, key: 'a', value: '1', isModifier: true },
      { depth: 0, key: 'can_x', value: 'yes', isModifier: true, isRule: true },
    ])
    const stat = resolveStat('can_x', 'Can x', {}, {}, { kind: 'flag' })
    const line = (value: string) => ({ depth: 0, key: 'can_x', value, isModifier: true, stat })
    expect(formatEffect(line('yes'))).toBe('Can x: yes')
    expect(effectTone(line('yes'))).toBe('good')
    expect(formatEffect(line('no'))).toBe('Can x: no')
    expect(effectTone(line('no'))).toBe('bad')
    expect(statTone({ ...stat, goodWhen: 'negative' }, 'yes')).toBe('bad')
  })

  it('supports fixed decimals and hiding the plus sign', () => {
    const plain = { fixedDecimals: true, showPlus: false, decimals: 2 }
    expect(formatStatValue({ key: 'x', kind: 'percent', ...plain }, '0.01')).toBe('1.00%')
    expect(formatStatValue({ key: 'x', kind: 'number', ...plain }, '0.01')).toBe('0.01')
    expect(formatStatValue({ key: 'x', kind: 'number', ...plain }, '-0.01')).toBe('-0.01')
  })

  it('reports tone from goodWhen', () => {
    const cost = { key: 'c', goodWhen: 'negative' as const }
    expect(statTone(cost, '-0.5')).toBe('good')
    expect(statTone(cost, '0.5')).toBe('bad')
    expect(statTone({ key: 'c' }, '0.5')).toBe('neutral')
  })

  it('formats modifier effect lines through their stat', () => {
    const line = { depth: 0, key: 'k', value: '-0.5', isModifier: true as const }
    expect(formatEffect(line)).toBe('k: -50%')
    expect(formatEffect({ ...line, stat: { key: 'k', label: 'Cost', kind: 'percent' } })).toBe(
      'Cost: -50%',
    )
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

describe('politics and leader effects', () => {
  const lines = (script: string) =>
    collapseEffects(flattenEffects(parseScript(script))).map((e) => formatEffect(e))

  it('reads ruling party, popularity and party names', () => {
    expect(lines('set_politics = { ruling_party = a elections_allowed = no }')).toEqual([
      'Ruling party: a (no elections)',
    ])
    expect(lines('set_politics = { ruling_party = a elections_allowed = yes }')).toEqual([
      'Ruling party: a',
    ])
    expect(lines('set_political_party = { ideology = a popularity = 65 }')).toEqual([
      'Set a popularity: 65%',
    ])
    expect(lines('set_party_name = { ideology = a long_name = L name = N }')).toEqual([
      'Rename a party: N',
    ])
  })

  it('reads leader promotion, creation and retirement', () => {
    expect(lines('promote_character = { character = X ideology = liberalism }')).toEqual([
      'Promote X to country leader (liberalism)',
    ])
    expect(lines('promote_character = { ideology = fascism }')).toEqual([
      'Promote a new leader to country leader (fascism)',
    ])
    expect(lines('create_country_leader = { name = "Carol II" ideology = d id = 5 }')).toEqual([
      'Create country leader: Carol II (d)',
    ])
    expect(lines('create_corps_commander = { name = "B P" skill = 2 }')).toEqual([
      'Create corps commander: B P',
    ])
    expect(lines('retire_country_leader = yes')).toEqual(['Retire country leader'])
    expect(lines('add_country_leader_trait = camarilla_leader')).toEqual([
      'Add leader trait: camarilla leader',
    ])
  })

  it('reads autonomy and advisor removal', () => {
    expect(lines('set_autonomy = { target = ROM autonomy_state = puppet }')).toEqual([
      'Autonomy of ROM: puppet',
    ])
    expect(lines('remove_advisor_role = { slot = army_chief }')).toEqual([
      'Remove advisor role: army chief',
    ])
  })

  it('reads faction creation', () => {
    expect(lines('create_faction_from_template = { template = t name = F_NAME }')).toEqual([
      'Create faction: F NAME',
    ])
  })

  it('drops the conditions around events sent to other countries', () => {
    const show = (script: string) =>
      unwrapEventConditions(collapseEffects(flattenEffects(parseScript(script)))).map(
        (e) => '  '.repeat(e.depth) + formatEffect(e),
      )
    expect(
      show('if = { limit = { POL = { exists = yes } } POL = { country_event = a.1 } }'),
    ).toEqual(['POL:', '  Event: a.1'])
    // Other conditionals, and ones with an else branch, are kept.
    expect(show('if = { limit = { a = b } add_stability = 1 }')[0]).toBe('if:')
    expect(
      show('if = { limit = { a = b } POL = { country_event = a.1 } } else = { x = y }')[0],
    ).toBe('if:')
  })

  it('folds a simple limit into its if header', () => {
    const show = (script: string) =>
      foldConditions(collapseEffects(flattenEffects(parseScript(script)))).map(
        (e) => '  '.repeat(e.depth) + formatEffect(e),
      )
    expect(
      show('if = { limit = { FRA = { is_in_faction_with = ENG } } add_stability = 1 }'),
    ).toEqual(['If FRA is in faction with: ENG:', '  add stability: +1'])
    expect(show('if = { limit = { has_idea = X is_ok = no } a = b }')[0]).toBe(
      'If has idea: X and is ok: no:',
    )
    // Anything with NOT or OR in the limit is left as it was.
    expect(show('if = { limit = { NOT = { a = b } } c = d }').slice(0, 2)).toEqual([
      'if:',
      '  limit:',
    ])
  })
})
