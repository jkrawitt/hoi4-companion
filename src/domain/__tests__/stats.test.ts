import { describe, expect, it } from 'vitest'
import { effectTone, formatEffect } from '../focusEffects'
import { parseIdeas } from '../parsers/ideas'
import { formatStatValue, parseStatDocs, resolveStat, statTone } from '../stats'

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
