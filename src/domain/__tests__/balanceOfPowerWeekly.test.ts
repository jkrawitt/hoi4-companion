import { describe, expect, it } from 'vitest'
import { addDays } from '../calendar'
import type { BalanceOfPower, BopWeeklyRule } from '../balanceOfPower'
import type { EffectLine, Focus } from '../focus'
import { parseWeeklyRules, readWeeklyRules } from '../parsers/balanceOfPowerWeekly'
import { countryStateAt } from '../campaign/countryState'
import { schedulePlan } from '../plan/focusPlan'

const ON_ACTIONS = `
on_actions = {
  on_weekly_FIN = {
    effect = {
      if = {
        limit = { has_country_leader = { ruling_only = yes character = FIN_a } }
        FIN_check_losing_cores = yes
        if = {
          limit = { OR = { communism > 0.09 democratic > 0.09 } }
          if = {
            limit = { NOT = { has_power_balance_modifier = { id = B modifier = M_bad } } }
            add_power_balance_modifier = { id = B modifier = M_bad }
          }
          if = {
            limit = { has_power_balance_modifier = { id = B modifier = M_good } }
            remove_power_balance_modifier = { id = B modifier = M_good }
          }
        }
        else = {
          if = {
            limit = { has_power_balance_modifier = { id = B modifier = M_bad } }
            remove_power_balance_modifier = { id = B modifier = M_bad }
          }
        }
        if = {
          limit = { democratic < 0.01 }
          add_power_balance_modifier = { id = B modifier = M_good }
        }
      }
      else_if = {
        limit = { has_country_leader = { ruling_only = yes character = FIN_b } }
        if = {
          limit = { has_war = yes }
          add_power_balance_modifier = { id = B modifier = M_war }
        }
        else = {
          add_power_balance_modifier = { id = B modifier = M_peace }
        }
      }
    }
  }
}`

describe('parseWeeklyRules', () => {
  const rules = parseWeeklyRules(ON_ACTIONS, 'FIN')

  it('finds each modifier added, under the leader whose branch adds it', () => {
    expect(rules.map((r) => [r.leader, r.modifier])).toEqual([
      ['FIN_a', 'M_bad'],
      ['FIN_a', 'M_good'],
      ['FIN_b', 'M_war'],
      ['FIN_b', 'M_peace'],
    ])
  })

  it('keeps the conditions around the modifier, without the guard about modifiers', () => {
    expect(rules[0].when).toMatchObject({ type: 'any' })
    expect(rules[1].when).toEqual({
      type: 'popularity',
      ideology: 'democratic',
      op: '<',
      than: 0.01,
    })
  })

  it('negates the `if` before an `else`', () => {
    expect(rules[2].when).toEqual({ type: 'war', atWar: true })
    expect(rules[3].when).toEqual({ type: 'not', of: { type: 'war', atWar: true } })
  })

  it('reads nothing for a country without a weekly script', () => {
    expect(parseWeeklyRules(ON_ACTIONS, 'SWE')).toEqual([])
  })

  it('takes each modifier’s weekly value from the modifiers files', async () => {
    const files: Record<string, string> = {
      'common/on_actions/x.txt': ON_ACTIONS,
      'common/modifiers/m.txt':
        'M_bad = { power_balance_weekly = -0.01 }\nM_good = { power_balance_weekly = 0.02 }',
    }
    const read = await readWeeklyRules(
      {
        readText: async (p) => files[p] ?? null,
        listFiles: async (p) =>
          Object.keys(files)
            .filter((f) => f.startsWith(`${p}/`))
            .map((f) => f.slice(p.length + 1)),
      },
      'FIN',
    )
    expect(read.map((r) => [r.modifier, r.weekly])).toEqual([
      ['M_bad', -0.01],
      ['M_good', 0.02],
    ])
  })
})

describe('the weekly drift of the balance of power', () => {
  const start = new Date(Date.UTC(1936, 0, 1))
  const stat = (key: string) => ({ key, kind: 'percent' as const })
  const range = (id: string, min: number, max: number, mods: Record<string, string>) => ({
    id,
    name: id,
    min,
    max,
    modifiers: Object.entries(mods).map(
      ([key, value]): EffectLine => ({ depth: 0, key, value, isModifier: true, stat: stat(key) }),
    ),
  })
  const weekly: BopWeeklyRule[] = [
    {
      leader: 'FIN_a',
      modifier: 'bad',
      weekly: -0.01,
      when: { type: 'popularity', ideology: 'democratic', op: '>', than: 0.09 },
    },
  ]
  const bop: BalanceOfPower = {
    id: 'B',
    name: 'Trust',
    initial: 0.1,
    weekly,
    ranges: [
      range('mid', -0.1, 0.1, {}),
      range('low', -0.6, -0.1, { stability_factor: '-0.05' }),
      range('very-low', -1, -0.6, { stability_factor: '-0.1' }),
    ],
  }
  const pop = (subject: string, value: string): EffectLine => ({
    depth: 0,
    key: 'add_popularity',
    value,
    subject,
    subjectName: subject,
    stat: stat('add_popularity'),
  })
  const startLines = (democratic: string): EffectLine[] => [
    { depth: 0, key: 'set_power_balance' },
    { depth: 1, key: 'id', value: 'B' },
    { depth: 1, key: 'set_value', value: '-0.45' },
    pop('democratic', democratic),
    pop('neutrality', String(1 - Number(democratic))),
    { depth: 0, key: 'promote_character', value: 'FIN_a' },
  ]
  const noFocuses = {
    id: 'f',
    name: 'f',
    days: 1,
    prerequisites: [],
    mutuallyExclusive: [],
    x: 0,
    y: 0,
    effects: [],
  } satisfies Focus
  const at = (days: number, democratic: string, balanceOfPower = bop) =>
    countryStateAt(
      schedulePlan(['f'], { f: noFocuses }, { startDate: start, speedBonus: 0 }),
      addDays(start, days),
      { tag: 'FIN', balanceOfPower, start: startLines(democratic), startDate: start },
    )

  it('moves the balance each week while the leader’s condition holds', () => {
    expect(at(6, '0.15').balance).toBe(-0.45)
    expect(at(7, '0.15').balance).toBe(-0.46)
    expect(at(70, '0.15').balance).toBeCloseTo(-0.55, 6)
  })

  it('does not move it when the condition fails, or for another leader', () => {
    expect(at(70, '0.05').balance).toBe(-0.45)
    const other = { ...bop, weekly: [{ ...weekly[0], leader: 'FIN_b' }] }
    expect(at(70, '0.15', other).balance).toBe(-0.45)
  })

  it('swaps the range’s modifiers and notes the day it crossed into another range', () => {
    const before = at(98, '0.15')
    expect(before.balance).toBeCloseTo(-0.59, 6)
    expect(before.balanceChanges).toEqual([])
    const after = at(105, '0.15')
    expect(after.balance).toBeCloseTo(-0.6, 6)
    expect(after.balanceChanges).toEqual([addDays(start, 105)])
    expect(after.modifierTotals.find((t) => t.key === 'stability_factor')?.total).toBeCloseTo(-0.1)
  })

  it('stops at -1', () => {
    expect(at(2000, '0.15').balance).toBe(-1)
  })
})
