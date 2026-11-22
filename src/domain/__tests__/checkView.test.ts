import { describe, expect, it } from 'vitest'
import { viewCheck } from '../campaign/checkView'
import type { ConditionContext } from '../campaign/conditions'
import type { Check } from '../focus'

const ctx = (ideas: string[]): ConditionContext =>
  ({
    hasIdea: (id) => ideas.includes(id),
    hasFocus: () => false,
    leader: () => undefined,
    government: () => 'fascism',
    popularity: () => undefined,
    tag: 'ROM',
    atWar: () => false,
  }) as ConditionContext

describe('viewCheck', () => {
  const check: Check = {
    type: 'all',
    of: [
      { type: 'idea', id: 'war_economy' },
      {
        type: 'any',
        of: [
          { type: 'government', id: 'fascism' },
          { type: 'unknown', text: 'Is puppet: yes' },
        ],
      },
    ],
  }

  it('marks each term as holding, failing or unknown, with names', () => {
    const view = viewCheck(check, ctx([]), { idea: () => 'War Economy' })
    expect(view.join).toBe('all')
    expect(view.holds).toBe(false)
    expect(view.children[0]).toMatchObject({ text: 'Has idea: War Economy', holds: false })
    const any = view.children[1]
    expect(any.join).toBe('any')
    expect(any.holds).toBe(true)
    expect(any.children.map((c) => [c.text, c.holds])).toEqual([
      ['Government is Fascism', true],
      ['Is puppet: yes', undefined],
    ])
  })

  it('flattens nested groups of the same kind and reads not over a term', () => {
    const view = viewCheck(
      {
        type: 'all',
        of: [
          { type: 'all', of: [{ type: 'war', atWar: true }] },
          { type: 'not', of: { type: 'idea', id: 'x' } },
        ],
      },
      ctx([]),
    )
    expect(view.children.map((c) => c.text)).toEqual(['At war', 'Not: Has idea: X'])
  })

  it('leaves out branches that need another country and tag terms that hold', () => {
    const check: Check = {
      type: 'all',
      of: [
        { type: 'tag', id: 'ROM' },
        {
          type: 'any',
          of: [
            {
              type: 'all',
              of: [
                { type: 'tag', id: 'PHI' },
                { type: 'idea', id: 'a' },
              ],
            },
            {
              type: 'all',
              of: [
                { type: 'tag', id: 'ROM' },
                { type: 'idea', id: 'b' },
              ],
            },
            { type: 'government', id: 'fascism' },
          ],
        },
      ],
    }
    const view = viewCheck(check, ctx([]))
    expect(JSON.stringify(view)).not.toContain('PHI')
    const any = view.join === 'any' ? view : view.children[0]
    expect(any.children.map((c) => c.text)).toEqual(['Has idea: B', 'Government is Fascism'])
  })

  it('drops the other countries from a mobilisation-style condition', () => {
    const check: Check = {
      type: 'all',
      of: [
        { type: 'stat', key: 'war_support', op: '>', than: 0.15 },
        {
          type: 'not',
          of: {
            type: 'all',
            of: [
              { type: 'tag', id: 'HUN' },
              { type: 'dlc', id: 'Death or Dishonor' },
            ],
          },
        },
        { type: 'not', of: { type: 'idea', id: 'HUN_treaty_of_trianon' } },
        {
          type: 'any',
          of: [
            { type: 'all', of: [{ type: 'focus', id: 'USA_limited_intervention' }] },
            {
              type: 'all',
              of: [
                { type: 'not', of: { type: 'focus', id: 'USA_limited_intervention' } },
                { type: 'const', value: true },
              ],
            },
          ],
        },
      ],
    }
    const view = viewCheck(check, { ...ctx([]), stat: () => 0.5 } as ConditionContext)
    expect(view.children).toEqual([])
    expect(view.text).toBe('War support > 15%')
  })
})

describe('a block the campaign cannot answer', () => {
  it('shows its conditions without a verdict', () => {
    const view = viewCheck(
      {
        type: 'unknown',
        text: 'Any enemy country',
        of: [{ type: 'government', id: 'fascism' }],
      },
      ctx([]),
    )
    expect(view.text).toBe('Any enemy country')
    expect(view.holds).toBeUndefined()
    // Our own government is fascism here, but the term is about an enemy: no verdict.
    expect(view.children).toMatchObject([{ text: 'Government is Fascism', holds: undefined }])
  })
})
