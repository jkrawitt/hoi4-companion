import { describe, expect, it } from 'vitest'
import {
  adjustmentSteps,
  emptyAdjustments,
  importCost,
  tradeOverTime,
  type Adjustments,
} from '../adjustments'
import { parseResourceCosts } from '../parsers/states'

const adj = (extra: Partial<Adjustments>): Adjustments => ({ ...emptyAdjustments(), ...extra })
const cost = { steel: 0.125, coal: 0.125 }
const at = (date: string) => new Date(`${date}T00:00:00Z`)

describe('adjustmentSteps', () => {
  it('makes a war entry a set_enemies line', () => {
    const steps = adjustmentSteps(
      adj({
        wars: [
          { id: 'a', date: '1939-11-30', enemies: ['SOV', 'EST'] },
          { id: 'b', date: '1940-03-13', enemies: [] },
        ],
      }),
    )
    expect(steps.map((s) => s.focus.effects)).toEqual([
      [{ depth: 0, key: 'set_enemies', value: 'SOV EST' }],
      [{ depth: 0, key: 'set_enemies', value: 'none' }],
    ])
  })

  it('makes a stability entry one set_actual_stability line on its date', () => {
    const [step] = adjustmentSteps(
      adj({ stability: [{ id: 'a', date: '1936-03-01', value: 0.6 }] }),
    )
    expect(step.end).toEqual(at('1936-03-01'))
    expect(step.focus.id).toBe('adjust:a')
    expect(step.focus.effects).toEqual([{ depth: 0, key: 'set_actual_stability', value: '0.6' }])
  })

  it('makes a timed modifier a timed idea with one modifier line', () => {
    const [step] = adjustmentSteps(
      adj({
        modifiers: [
          {
            id: 'm',
            date: '1936-02-01',
            name: 'Boom',
            key: 'consumer_goods_factor',
            value: 0.1,
            days: 90,
          },
        ],
      }),
    )
    const [header, line] = step.focus.effects
    expect(header).toMatchObject({
      depth: 0,
      key: 'add_timed_idea',
      value: 'adjust:m',
      valueName: 'Boom',
      days: 90,
    })
    expect(line).toMatchObject({
      depth: 1,
      key: 'consumer_goods_factor',
      value: '0.1',
      isModifier: true,
      stat: { key: 'consumer_goods_factor', kind: 'percent' },
    })
  })

  it('makes a modifier without days a plain idea', () => {
    const [step] = adjustmentSteps(
      adj({
        modifiers: [
          { id: 'm', date: '1936-02-01', name: 'PP', key: 'political_power_gain', value: 0.5 },
        ],
      }),
    )
    expect(step.focus.effects[0]).toMatchObject({ key: 'add_ideas' })
    expect(step.focus.effects[0].days).toBeUndefined()
    expect(step.focus.effects[1].stat?.kind).toBe('number')
  })
})

describe('tradeOverTime', () => {
  it('costs an import its civs, rounded up, from its start until its end', () => {
    expect(importCost({ resource: 'steel', amount: 16 }, cost)).toBe(2)
    expect(importCost({ resource: 'steel', amount: 17 }, cost)).toBe(3)
    const points = tradeOverTime(
      adj({
        imports: [
          { id: 'i', resource: 'coal', amount: 16, from: '1936-02-01', until: '1936-05-01' },
        ],
      }),
      cost,
      'coal',
    )
    expect(points.map((p) => [p.date, p.received, p.importCost, p.coal])).toEqual([
      [at('1936-02-01'), 0, 2, 16],
      [at('1936-05-01'), 0, 0, 0],
    ])
  })

  it('lets a received entry replace the one before it', () => {
    const points = tradeOverTime(
      adj({
        received: [
          { id: 'b', date: '1936-06-01', civs: 3 },
          { id: 'a', date: '1936-03-01', civs: 5 },
        ],
        imports: [{ id: 'i', resource: 'steel', amount: 8, from: '1936-04-01' }],
      }),
      cost,
      'coal',
    )
    expect(points.map((p) => [p.received, p.importCost])).toEqual([
      [5, 0],
      [5, 1],
      [3, 1],
    ])
  })
})

describe('parseResourceCosts', () => {
  it('reads the cic of each resource', () => {
    expect(
      parseResourceCosts(
        'resources = { oil = { icon_frame = 1 cic = 0.125 } steel = { cic = 0.25 } }',
      ),
    ).toEqual({ oil: 0.125, steel: 0.25 })
  })
})
