import { describe, expect, it } from 'vitest'
import type { EffectLine } from '../focus'
import { parseFocusTreeFile } from '../parsers/focusTree'
import { blockedByAvailability, unavailableInPlan } from '../campaign/availability'
import { countryStateAt } from '../campaign/countryState'
import { schedulePlan } from '../plan/focusPlan'

const text = `focus_tree = {
  focus = { id = DISCREDIT cost = 5 }
  focus = {
    id = REGIME
    cost = 5
    prerequisite = { focus = DISCREDIT }
    bypass = { has_government = fascism }
    available = {
      is_subject = no
      OR = {
        has_completed_focus = COUP
        AND = { has_completed_focus = DISCREDIT fascism > 0.6 has_stability > 0.6 }
      }
    }
    completion_reward = { add_ideas = SPIRIT }
  }
  focus = { id = PLAIN cost = 5 available = { is_subject = no } }
}`

const focuses = Object.fromEntries(parseFocusTreeFile(text).map((f) => [f.id, f]))
const pop = (subject: string, value: string): EffectLine => ({
  depth: 0,
  key: 'add_popularity',
  subject,
  subjectName: subject,
  value,
  isModifier: true,
  stat: { key: 'add_popularity', kind: 'percent' },
})
const start = new Date(Date.UTC(1936, 0, 1))
const stability = (value: string): EffectLine => ({
  depth: 0,
  key: 'add_stability',
  value,
  isModifier: true,
  stat: { key: 'add_stability', kind: 'percent' },
})
const input = (fascism: string, plan: string[] = []) => ({
  plan,
  focuses,
  scheduleOptions: { startDate: start, speedBonus: 0 },
  stateOptions: {
    tag: 'FIN',
    startDate: start,
    start: [
      pop('democratic', String(1 - Number(fascism) - 0.1)),
      pop('fascism', fascism),
      pop('communism', '0.1'),
      stability('0.8'),
    ],
  },
})

describe('focus available and bypass', () => {
  it('reads triggers the campaign can answer, and drops ones it cannot', () => {
    expect(focuses.REGIME.available).toBeDefined()
    expect(focuses.REGIME.bypass).toEqual({ type: 'government', id: 'fascism' })
    // `is_subject = no` alone is unknown to us: it never blocks.
    expect(focuses.PLAIN.available).toBeUndefined()
  })

  it('blocks a focus whose available fails, and lets it through when popularity is enough', () => {
    expect(blockedByAvailability(input('0.3')).has('REGIME')).toBe(true)
    expect(blockedByAvailability(input('0.7')).has('REGIME')).toBe(false)
    expect(blockedByAvailability(input('0.7')).has('PLAIN')).toBe(false)
  })

  it('reports a planned focus that is not available when it starts', () => {
    expect([...unavailableInPlan(input('0.3', ['DISCREDIT', 'REGIME']))]).toEqual(['REGIME'])
    expect(unavailableInPlan(input('0.7', ['DISCREDIT', 'REGIME'])).size).toBe(0)
  })

  it('skips the reward of a bypassed focus', () => {
    const { stateOptions, scheduleOptions } = input('0.7', ['DISCREDIT', 'REGIME'])
    const schedule = schedulePlan(['DISCREDIT', 'REGIME'], focuses, scheduleOptions)
    const end = schedule.finish
    const normal = countryStateAt(schedule, end, stateOptions)
    expect(normal.ideas.map((i) => i.id)).toEqual(['SPIRIT'])
    expect(normal.bypassed).toEqual([])
    const fascist = {
      ...stateOptions,
      start: [
        ...stateOptions.start,
        { depth: 0, key: 'set_politics', value: 'fascism' } as EffectLine,
      ],
    }
    const bypassed = countryStateAt(schedule, end, fascist)
    expect(bypassed.bypassed).toEqual(['REGIME'])
    expect(bypassed.ideas).toEqual([])
  })
})
