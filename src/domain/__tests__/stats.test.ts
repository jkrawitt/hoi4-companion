import { describe, expect, it } from 'vitest'
import { effectTone, formatEffect } from '../focusEffects'
import { parseIdeas } from '../parsers/ideas'
import {
  formatStatValue,
  parseStatDocs,
  parseTooltipFormat,
  resolveStat,
  statTone,
  tidyLabel,
} from '../stats'
import { nameLines, type NameContext } from '../nameLines'

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

  it('tidies tooltip-style labels from the game', () => {
    expect(tidyLabel('Spotting Speed Modifier: ')).toBe('Spotting Speed Modifier')
    expect(tidyLabel(' Attack bonus against country')).toBe('Attack bonus against country')
    expect(tidyLabel('Assign Army Leader Cost ( ): $VALUE|Y0$')).toBe('Assign Army Leader Cost')
    expect(tidyLabel('Support Value $RIGHT|+=%$')).toBe('Support Value')
    expect(tidyLabel('Production  Efficiency Cap')).toBe('Production Efficiency Cap')
    expect(tidyLabel('')).toBeUndefined()
    expect(tidyLabel(undefined)).toBeUndefined()
    expect(resolveStat('k', 'Cap: ', {}, {}).label).toBe('Cap')
  })
})

describe('tooltip formats', () => {
  it('reads colour, percent and decimals out of the value template', () => {
    expect(parseTooltipFormat(' $MODIFIER_X$: $RIGHT|+=%1$')).toEqual({
      goodWhen: 'positive',
      kind: 'percent',
      decimals: 1,
    })
    expect(parseTooltipFormat('$X$: $RIGHT|-=%0$')).toMatchObject({ goodWhen: 'negative' })
    expect(parseTooltipFormat('$X$: $RIGHT|Y=%1$')).toEqual({
      goodWhen: undefined,
      kind: 'percent',
      decimals: 1,
    })
    expect(parseTooltipFormat('$X$ $RIGHT|+=2$')).toEqual({
      goodWhen: 'positive',
      kind: 'number',
      decimals: 2,
    })
    expect(parseTooltipFormat('$X$: $RIGHT|G=0$')).toMatchObject({ kind: 'number', decimals: 0 })
  })

  it('marks values already in percentage points', () => {
    expect(parseTooltipFormat('$X$: $RIGHT|-=%%1$')).toEqual({
      goodWhen: 'negative',
      kind: 'percent',
      percentPoints: true,
      decimals: 1,
    })
    const stat = { key: 'x', kind: 'percent' as const, percentPoints: true as const }
    expect(formatStatValue(stat, '20')).toBe('+20%')
  })

  it('gives nothing without a template', () => {
    expect(parseTooltipFormat(undefined)).toEqual({})
    expect(parseTooltipFormat('Just a name')).toEqual({})
  })

  it('ranks overrides over the tooltip over docs over guesses', () => {
    const docs = parseStatDocs('## a_cost_factor\n\n* Number with 2 decimal places\n')
    const tooltip = parseTooltipFormat('$A$: $RIGHT|+=%1$')
    const guessed = { goodWhen: 'negative' as const }
    expect(resolveStat('a_cost_factor', 'A', docs, {}, guessed, tooltip)).toMatchObject({
      decimals: 1,
      kind: 'percent',
      goodWhen: 'positive',
    })
    expect(
      resolveStat(
        'a_cost_factor',
        'A',
        docs,
        { a_cost_factor: { goodWhen: 'negative' } },
        {},
        tooltip,
      ),
    ).toMatchObject({ goodWhen: 'negative', decimals: 1 })
    // A neutral colour clears a guessed direction.
    const neutral = resolveStat(
      'a_cost_factor',
      'A',
      {},
      {},
      guessed,
      parseTooltipFormat('$A$ $R|Y=%$'),
    )
    expect(neutral.goodWhen).toBeUndefined()
  })

  it('keeps a rule a flag whatever its tooltip format says', () => {
    const stat = resolveStat('r', 'R', {}, {}, { kind: 'flag' }, parseTooltipFormat('$R$ $V|+=%1$'))
    expect(stat).toMatchObject({ kind: 'flag', goodWhen: 'positive' })
  })

  it('names conscription and conscription_factor apart from their tooltips', () => {
    const ctx = {
      country: { name: 'Romania' },
      names: {
        MODIFIER_CONSCRIPTION_FACTOR: 'Recruitable Population',
        MODIFIER_CONSCRIPTION_TOTAL_FACTOR: 'Recruitable Population Factor',
        conscription_tt: ' Recruitable Population: $RIGHT|Y=%1$',
        conscription_factor_tt: ' Recruitable Population Factor: $RIGHT|+=%1$',
      },
      rawNames: {},
      rulingParties: {},
      factionTemplates: {},
      factionNames: {},
      eventTitles: {},
      ideaAliases: {},
      opinions: {},
      statDocs: {},
      statOverrides: {},
    } as NameContext
    const line = (key: string) => ({ depth: 0, key, value: '0.05', isModifier: true })
    const [plain, factor] = nameLines([line('conscription'), line('conscription_factor')], ctx)
    expect(plain.stat?.label).toBe('Recruitable Population')
    expect(factor.stat?.label).toBe('Recruitable Population Factor')
    expect(factor.stat?.goodWhen).toBe('positive')
  })
})
