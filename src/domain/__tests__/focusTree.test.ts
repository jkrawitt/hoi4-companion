import { describe, expect, it } from 'vitest'
import { parseFocusTreeFile } from '../focusTree'
import { parseLocalisation } from '../localisation'
import { parseScript } from '../paradoxScript'

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
  }
  focus = { id = T_default }
}
`

describe('parseScript', () => {
  it('handles comparison operators, quoted strings with # and bare values', () => {
    const block = parseScript('a = { size > 0 name = "x # y" b c }')
    const inner = block[0].value as { key: string | null; operator: string; value: unknown }[]
    expect(inner[0]).toMatchObject({ key: 'size', operator: '>', value: '0' })
    expect(inner[1]).toMatchObject({ key: 'name', value: 'x # y' })
    expect(inner[2]).toMatchObject({ key: null, value: 'b' })
  })
})

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

describe('parseLocalisation', () => {
  it('parses both key formats and filters wanted keys', () => {
    const yml = '﻿l_english:\n T_one:0 "One"\n T_two: "Two" # note\n OTHER:1 "x"\n'
    expect(parseLocalisation(yml, new Set(['T_one', 'T_two']))).toEqual({
      T_one: 'One',
      T_two: 'Two',
    })
  })
})
