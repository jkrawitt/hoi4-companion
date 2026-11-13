import { describe, expect, it } from 'vitest'
import { cleanLocalisation, parseLocalisation } from '../parsers/localisation'

describe('cleanLocalisation', () => {
  it('strips colour codes, resolves newlines and dynamic text', () => {
    expect(cleanLocalisation('§Ya§! [SOU.GetNameDefCap]\\nb [?x|G] c')).toBe('a SOU\nb  c')
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
