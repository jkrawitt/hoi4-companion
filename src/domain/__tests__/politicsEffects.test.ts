import { describe, expect, it } from 'vitest'
import {
  collapseEffects,
  foldConditions,
  pruneEmptyBlocks,
  defaultGoodWhen,
  ideaLineIndexes,
  removedIdeaLineIndexes,
  reverseModifier,
  resolveDlcConditions,
  unwrapEventConditions,
  effectTone,
  flattenEffects,
  formatEffect,
} from '../focusEffects'
import { parseIdeaNames } from '../parsers/ideas'
import { parseLeaderTraits } from '../parsers/leaderTraits'
import { parseScript } from '../parsers/paradoxScript'

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
      'Carol II Becomes Leader',
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
    expect(show('if = { limit = { a = b } add_stability = 1 }')[0]).toBe('If:')
    expect(
      show('if = { limit = { a = b } POL = { country_event = a.1 } } else = { x = y }')[0],
    ).toBe('If:')
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
    // NOT, OR and scopes are written out.
    expect(show('if = { limit = { NOT = { a = b } } c = d }')[0]).toBe('If not a: b:')
    expect(
      show('if = { limit = { FRA = { OR = { has_war = yes is_subject = yes } } } c = d }')[0],
    ).toBe('If FRA (has war: yes or is subject: yes):')
    expect(show('if = { limit = { OR = { a = 1 b = 2 } } c = d }')[0]).toBe('If a: 1 or b: 2:')
    expect(show('if = { limit = { has_country_leader = { id = 5 } } c = d }')[0]).toBe(
      'If has country leader (id: 5):',
    )
    // A condition we cannot read keeps the raw limit.
    expect(show('if = { limit = { x = { y = { z = 1 } } } c = d }').slice(0, 2)).toEqual([
      'If:',
      '  limit:',
    ])
  })

  it('records a limit the campaign can answer as a check', () => {
    const checkOf = (script: string) =>
      foldConditions(collapseEffects(flattenEffects(parseScript(script))))[0].check
    expect(checkOf('if = { limit = { has_completed_focus = F } a = b }')).toEqual({
      type: 'focus',
      id: 'F',
    })
    expect(checkOf('if = { limit = { NOT = { has_government = fascism } } a = b }')).toEqual({
      type: 'not',
      of: { type: 'government', id: 'fascism' },
    })
    expect(checkOf('if = { limit = { democratic > party_popularity@communism } a = b }')).toEqual({
      type: 'popularity',
      ideology: 'democratic',
      op: '>',
      than: 'communism',
    })
    expect(checkOf('if = { limit = { fascism > 0.5 } a = b }')).toEqual({
      type: 'popularity',
      ideology: 'fascism',
      op: '>',
      than: 0.5,
    })
    // Terms we cannot answer stay in as unknown, beside the ones we can; all of them is nothing.
    expect(checkOf('if = { limit = { has_idea = X has_war = yes } a = b }')).toEqual({
      type: 'all',
      of: [{ type: 'idea', id: 'X' }, { type: 'unknown' }],
    })
    expect(checkOf('if = { limit = { has_war = yes } a = b }')).toBeUndefined()
    expect(checkOf('if = { limit = { has_country_leader = { id = 550 } } a = b }')).toEqual({
      type: 'leader',
      id: '550',
    })
    expect(
      checkOf(
        'if = { limit = { has_country_leader = { character = C ruling_only = yes } } a = b }',
      ),
    ).toEqual({ type: 'leader', character: 'C' })
    expect(
      checkOf('if = { limit = { has_country_leader = { unit_leader = yes } } a = b }'),
    ).toBeUndefined()
    // Only the four ideology groups are popularities, not any `key > number`.
    expect(checkOf('if = { limit = { num_of_factories > 5 } a = b }')).toBeUndefined()
  })

  it('writes comparisons, else branches and empty limits', () => {
    const show = (script: string) =>
      foldConditions(collapseEffects(flattenEffects(parseScript(script)))).map(
        (e) => '  '.repeat(e.depth) + formatEffect(e),
      )
    expect(
      show(
        'if = { limit = { a > 5 } x = 1 } else_if = { limit = { b = 1 } y = 2 } else = { z = 3 }',
      ),
    ).toEqual(['If a > 5:', '  x: 1', 'Otherwise, if b: 1:', '  y: 2', 'Otherwise:', '  z: 3'])
    // An empty limit always applies: the body is shown and the else branches never are.
    expect(show('if = { limit = { } x = 1 } else = { z = 3 }')).toEqual(['x: 1'])
    expect(show('every_other_country = { limit = { has_war = yes } x = 1 }').slice(0, 1)).toEqual([
      'Every other country where has war: yes:',
    ])
  })

  it('keeps the branch for a DLC we know the ownership of', () => {
    const script = `IF = { limit = { has_dlc = "AAT" } a = 1 b = 2 } else = { c = 3 }`
    const show = (owned: Record<string, boolean>, text = script) =>
      resolveDlcConditions(collapseEffects(flattenEffects(parseScript(text))), owned).map(
        (e) => '  '.repeat(e.depth) + formatEffect(e),
      )
    expect(show({ AAT: false })).toEqual(['c: 3'])
    expect(show({ AAT: true })).toEqual(['a: 1', 'b: 2'])
    // Unknown DLCs are left as they were.
    expect(show({})[0]).toBe('If:')
    // Without an `else`: the body, or nothing.
    const alone = 'if = { limit = { has_dlc = "AAT" } a = 1 }'
    expect(show({ AAT: true }, alone)).toEqual(['a: 1'])
    expect(show({ AAT: false }, alone)).toEqual([])
    // `NOT`, and an `else` inside the `if`.
    expect(show({ AAT: false }, 'if = { limit = { NOT = { has_dlc = "AAT" } } a = 1 }')).toEqual([
      'a: 1',
    ])
    expect(
      show({ AAT: false }, 'if = { limit = { has_dlc = "AAT" } a = 1 else = { c = 3 } }'),
    ).toEqual(['c: 3'])
    // With other terms in the limit: gone when the DLC is missing, otherwise only the DLC goes.
    const mixed = 'if = { limit = { has_dlc = "AAT" has_war = yes } a = 1 }'
    expect(show({ AAT: false }, mixed)).toEqual([])
    // (the remaining `limit` is folded into the header later, at import)
    expect(show({ AAT: true }, mixed)).toEqual(['If:', '  limit:', '    has war: yes', '  a: 1'])
  })

  it('reads create_unit, drops division templates and prunes what that empties', () => {
    const show = (script: string) =>
      pruneEmptyBlocks(collapseEffects(flattenEffects(parseScript(script)))).map(
        (e) => '  '.repeat(e.depth) + formatEffect(e),
      )
    const unit =
      'create_unit = { division = "name = \\"Royal Guards\\" division_template = \\"Royal Guards\\" start_experience_factor = 1.0" owner = ROM }'
    expect(show(unit)).toEqual(['Create unit: Royal Guards'])
    const template = 'division_template = { name = "X" regiments = { infantry = { x = 0 y = 0 } } }'
    expect(
      show(
        `hidden_effect = { if = { limit = { a = b } ${template} } else = { ${template} } ${unit} }`,
      ),
    ).toEqual(['Hidden effect:', '  Create unit: Royal Guards'])
    // A block with something left in it stays.
    expect(show('if = { limit = { a = b } add_stability = 1 }')).toEqual([
      'If:',
      '  limit:',
      '    a: b',
      '  add extra'.replace('add extra', 'add stability: +1'),
    ])
  })

  it('keeps the traits of a new country leader and reads trait stats', () => {
    const [leader] = collapseEffects(
      flattenEffects(
        parseScript(
          'create_country_leader = { name = "C" ideology = d traits = { hedonist other } }',
        ),
      ),
    )
    expect(leader.traits).toEqual(['hedonist', 'other'])
    expect(
      parseLeaderTraits(
        'hedonist = { random = no sprite = 3 stability_factor = -0.05 x = 0 }',
        new Set(['hedonist']),
      ),
    ).toEqual({
      hedonist: [{ depth: 0, key: 'stability_factor', value: '-0.05', isModifier: true }],
    })
    expect(defaultGoodWhen('economy_cost_factor')).toBe('negative')
    expect(defaultGoodWhen('production_speed_bunker_factor')).toBe('positive')
    expect(defaultGoodWhen('stability_factor')).toBeUndefined()
  })

  it('finds removed ideas and reverses their modifiers', () => {
    const effects = collapseEffects(
      flattenEffects(
        parseScript('remove_ideas = A swap_ideas = { add_idea = B remove_idea = C } add_ideas = D'),
      ),
    )
    expect(removedIdeaLineIndexes(effects).map((i) => effects[i].value)).toEqual(['A', 'C'])
    expect(ideaLineIndexes(effects).map((i) => effects[i].value)).toEqual(['B', 'D'])
    const line = { depth: 0, key: 'conscription', value: '0.01', isModifier: true }
    expect(reverseModifier(line).value).toBe('-0.01')
    expect(reverseModifier({ ...line, value: '-0.5' }).value).toBe('0.5')
    const rule = { depth: 0, key: 'can_send_volunteers', value: 'yes', isRule: true }
    expect(reverseModifier(rule).value).toBe('no')
  })

  it('reads leader roles, breakthrough progress and idea aliases', () => {
    const run = (script: string) => collapseEffects(flattenEffects(parseScript(script)))
    const [role] = run(
      'add_country_leader_role = { country_leader = { ideology = f traits = { t1 t2 } } promote_leader = yes }',
    )
    expect(role).toMatchObject({
      key: 'add_country_leader_role',
      value: 'promote',
      traits: ['t1', 't2'],
    })
    expect(formatEffect(role)).toBe('Becomes country leader')
    expect(formatEffect({ ...role, value: 'role' })).toBe('Gains a country leader role')
    const [progress] = run('add_breakthrough_progress = { specialization = s value = 0.75 }')
    expect(formatEffect({ ...progress, subjectName: 'Nuclear Research' })).toBe(
      'Nuclear Research breakthrough progress: +75%',
    )
    expect(effectTone(progress)).toBe('good')
    expect(
      parseIdeaNames('A_2 = { name = A picture = p } B = { x = 1 }', new Set(['A_2', 'B'])),
    ).toEqual({ A_2: 'A', B: '' })
  })
})
