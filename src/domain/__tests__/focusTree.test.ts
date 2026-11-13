import { describe, expect, it } from 'vitest'
import { parseFocusTreeFile } from '../parsers/focusTree'

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
