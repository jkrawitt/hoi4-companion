import { describe, expect, it } from 'vitest'
import type { EffectLine } from '../focus'
import { formatEffect } from '../focusEffects'
import { onlyWhatHappens } from '../effects/onlyWhatHappens'

const line = (depth: number, key: string, value?: string, branch?: EffectLine['branch']) => ({
  depth,
  key,
  ...(value !== undefined && { value }),
  ...(branch && { branch }),
})

const shape = (lines: EffectLine[]) => lines.map((l) => `${l.depth}:${l.key}`)

describe('onlyWhatHappens', () => {
  it('dissolves the branch that applies and drops the ones that do not', () => {
    const lines = [
      line(0, 'if', undefined, 'applies'),
      line(1, 'remove_ideas', 'a'),
      line(0, 'else', undefined, 'skipped'),
      line(1, 'if', undefined, 'skipped'),
      line(2, 'add_ideas', 'b', 'skipped'),
      line(0, 'add_stability', '0.1'),
    ]
    expect(shape(onlyWhatHappens(lines))).toEqual(['0:remove_ideas', '0:add_stability'])
  })

  it('lifts nested applying branches all the way out', () => {
    const lines = [
      line(0, 'if', undefined, 'skipped'),
      line(1, 'x', '1', 'skipped'),
      line(0, 'else', undefined, 'applies'),
      line(1, 'if', undefined, 'applies'),
      line(2, 'add_ideas', 'c'),
      line(2, 'if', undefined, 'skipped'),
      line(3, 'y', '1', 'skipped'),
    ]
    expect(shape(onlyWhatHappens(lines))).toEqual(['0:add_ideas'])
  })

  it('drops a block whose contents were all branches that do not run', () => {
    const lines = [
      line(0, 'hidden_effect'),
      line(1, 'if', undefined, 'skipped'),
      line(2, 'add_ideas', 'a', 'skipped'),
    ]
    expect(onlyWhatHappens(lines)).toEqual([])
  })

  it('keeps unanswered chains and other blocks as written', () => {
    const lines = [
      line(0, 'if'),
      line(1, 'add_ideas', 'a'),
      line(0, 'hidden_effect'),
      line(1, 'add_stability', '0.1'),
      line(0, 'unlock_decision_tooltip', undefined),
    ]
    expect(onlyWhatHappens(lines)).toEqual(lines)
  })
  describe('swap_ideas', () => {
    const mod = (depth: number, key: string, value: string): EffectLine => ({
      depth,
      key,
      value,
      isModifier: true,
      stat: { key },
    })
    const idea = (depth: number, key: string, name: string): EffectLine => ({
      depth,
      key,
      value: name.toLowerCase(),
      valueName: name,
    })
    const text = (lines: EffectLine[]) => lines.map((l) => `${l.depth}|${formatEffect(l)}`)

    it('says add and remove when the ideas differ', () => {
      const lines = [
        line(0, 'swap_ideas'),
        idea(1, 'add_idea', 'New'),
        mod(2, 'a', '0.1'),
        idea(1, 'remove_idea', 'Old'),
        mod(2, 'a', '-0.2'),
      ]
      expect(text(onlyWhatHappens(lines))).toEqual([
        '0|add idea: New',
        '1|a: +10%',
        '0|remove idea: Old',
        '1|a: -20%',
      ])
    })

    it('replaces an idea with itself and lists the net change', () => {
      const lines = [
        line(0, 'swap_ideas'),
        idea(1, 'remove_idea', 'Policy'),
        mod(2, 'a', '-0.5'),
        mod(2, 'same', '-0.1'),
        mod(2, 'rule', 'no'),
        idea(1, 'add_idea', 'Policy'),
        mod(2, 'a', '-1'),
        mod(2, 'b', '0.25'),
        mod(2, 'same', '0.1'),
        mod(2, 'rule', 'yes'),
      ].map((l) => (l.isModifier && l.key === 'rule' ? { ...l, isRule: true } : l))
      const out = onlyWhatHappens(lines)
      expect(out.map((l) => l.depth)).toEqual([0, 1, 2, 2, 2])
      expect(out.slice(0, 2).map(formatEffect)).toEqual([
        'Replace idea Policy with Policy:',
        'Net change:',
      ])
      expect(out.slice(2).map((l) => [l.key, l.value])).toEqual([
        ['a', '-1.5'],
        ['rule', 'yes'],
        ['b', '0.25'],
      ])
    })

    it('says so when nothing nets out', () => {
      const lines = [
        line(0, 'swap_ideas'),
        idea(1, 'remove_idea', 'P'),
        mod(2, 'a', '-0.5'),
        idea(1, 'add_idea', 'P'),
        mod(2, 'a', '0.5'),
      ]
      expect(text(onlyWhatHappens(lines))).toEqual([
        '0|Replace idea P with P:',
        '1|Net change: none',
      ])
    })
  })
})
