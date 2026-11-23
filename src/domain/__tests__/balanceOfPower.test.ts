import { describe, expect, it } from 'vitest'
import { addDays } from '../calendar'
import type { EffectLine, Focus } from '../focus'
import type { BalanceOfPower } from '../balanceOfPower'
import { formatBalance, rangeAt } from '../balanceOfPower'
import { parseBalancesOfPower } from '../parsers/balanceOfPower'
import { parseStartingLines } from '../parsers/countryStart'
import { countryStateAt } from '../campaign/countryState'
import { schedulePlan } from '../plan/focusPlan'

const BOP_TEXT = `
FIN_power_balance = {
  initial_value = 0.1
  range = { id = mid min = -0.10 max = 0.10 modifier = { } }
  side = { id = bad range = { id = low min = -0.6 max = -0.1
    modifier = { stability_factor = -0.05 political_power_factor = -0.1 } } }
  side = { id = good range = { id = high min = 0.1 max = 0.6 modifier = { stability_factor = 0.05 } } }
}`

const stat = (key: string) => ({ key, kind: 'percent' as const })
const named = (id: string, min: number, max: number, mods: Record<string, string>) => ({
  id,
  name: id,
  min,
  max,
  modifiers: Object.entries(mods).map(
    ([key, value]): EffectLine => ({ depth: 0, key, value, isModifier: true, stat: stat(key) }),
  ),
})
const bop: BalanceOfPower = {
  id: 'FIN_power_balance',
  name: 'Public Trust',
  initial: 0.1,
  ranges: [
    named('mid', -0.1, 0.1, {}),
    named('low', -0.6, -0.1, { stability_factor: '-0.05', political_power_factor: '-0.1' }),
    named('high', 0.1, 0.6, { stability_factor: '0.05' }),
  ],
}

describe('balance of power', () => {
  it('reads the ranges of the middle and both sides', () => {
    const [read] = parseBalancesOfPower(BOP_TEXT)
    expect(read.id).toBe('FIN_power_balance')
    expect(read.initial).toBe(0.1)
    expect(read.ranges.map((r) => r.id)).toEqual(['mid', 'low', 'high'])
    expect(read.ranges[1].modifiers).toEqual([
      { depth: 0, key: 'stability_factor', value: '-0.05', isModifier: true },
      { depth: 0, key: 'political_power_factor', value: '-0.1', isModifier: true },
    ])
  })

  it('shows the balance as the game does, cut to a percentage, with the exact value', () => {
    expect(formatBalance(-0.45)).toBe('-45% (-0.450)')
    expect(formatBalance(-0.4628571)).toBe('-46% (-0.463)')
    expect(formatBalance(0.1)).toBe('10% (0.100)')
    expect(formatBalance(0)).toBe('0% (0.000)')
  })

  it('puts a value on a range border in the middle range', () => {
    expect(rangeAt(bop, -0.45)?.id).toBe('low')
    expect(rangeAt(bop, -0.1)?.id).toBe('mid')
    expect(rangeAt(bop, 0.3)?.id).toBe('high')
  })

  it('reads a start `add_stability` as a change to the default 50%', () => {
    const lines = parseStartingLines('add_stability = -0.1 add_war_support = 0.05')
    expect(lines.map((l) => [l.key, l.value])).toEqual([
      ['add_stability', '0.4'],
      ['add_war_support', '0.55'],
    ])
  })

  it('reads the 1936 balance of the start, not the 1939 one', () => {
    const lines = parseStartingLines(`
      if = {
        limit = { has_start_date < 1936.01.02 }
        set_power_balance = { id = FIN_power_balance left_side = a right_side = b set_value = -0.45 }
        add_ideas = FIN_sisu_2
      }
      1939.1.1 = { set_power_balance = { id = FIN_power_balance set_value = 0 } }`)
    expect(lines.map((l) => l.key)).toEqual([
      'set_power_balance',
      'id',
      'left_side',
      'right_side',
      'set_value',
      'add_ideas',
    ])
  })

  const start = new Date(Date.UTC(1936, 0, 1))
  const focus = (id: string, effects: EffectLine[]): Focus => ({
    id,
    name: id,
    days: 70,
    prerequisites: [],
    mutuallyExclusive: [],
    x: 0,
    y: 0,
    effects,
  })
  const stateAfter = (focuses: Focus[], days: number) =>
    countryStateAt(
      schedulePlan(
        focuses.map((f) => f.id),
        Object.fromEntries(focuses.map((f) => [f.id, f])),
        { startDate: start, speedBonus: 0 },
      ),
      addDays(start, days),
      {
        tag: 'FIN',
        balanceOfPower: bop,
        start: [
          { depth: 0, key: 'set_power_balance' },
          { depth: 1, key: 'id', value: 'FIN_power_balance' },
          { depth: 1, key: 'set_value', value: '-0.45' },
        ],
        startDate: start,
      },
    )

  it('gives the range as a spirit, and moves it with the focuses', () => {
    const up = focus('up', [
      { depth: 0, key: 'add_power_balance_value', value: '0.5', subject: 'FIN_power_balance' },
    ])
    const before = stateAfter([up], 10)
    expect(before.balance).toBe(-0.45)
    expect(before.ideas.map((i) => i.id)).toContain('bop:FIN_power_balance')
    expect(
      before.modifierTotals.find((t) => t.key === 'political_power_factor')?.total,
    ).toBeCloseTo(-0.1)
    const after = stateAfter([up], 100)
    expect(after.balance).toBeCloseTo(0.05)
    // The middle range gives nothing, so it is no spirit.
    expect(after.ideas.map((i) => i.id)).not.toContain('bop:FIN_power_balance')
    expect(after.modifierTotals.find((t) => t.key === 'political_power_factor')).toBeUndefined()
  })

  it('keeps the value between -1 and 1 and sets it by default', () => {
    const down = focus('down', [
      { depth: 0, key: 'add_power_balance_value', value: '-0.9', subject: 'FIN_power_balance' },
    ])
    expect(stateAfter([down], 100).balance).toBe(-1)
    const reset = focus('reset', [
      { depth: 0, key: 'set_power_balance' },
      { depth: 1, key: 'id', value: 'FIN_power_balance' },
      { depth: 1, key: 'set_default', value: 'yes' },
    ])
    expect(stateAfter([reset], 100).balance).toBe(0.1)
  })
})
