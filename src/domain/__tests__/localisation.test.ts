import { describe, expect, it } from 'vitest'
import { cleanLocalisation, parseLocalisation } from '../parsers/localisation'

describe('cleanLocalisation', () => {
  it('strips colour codes, resolves newlines and dynamic text', () => {
    expect(cleanLocalisation('§Ya§! [SOU.GetNameDefCap]\\nb [?x|G] c')).toBe('a SOU\nb  c')
  })

  it('drops icon tokens and the spacing they leave', () => {
    expect(cleanLocalisation('£prod_eff_cap  Production Efficiency Cap')).toBe(
      'Production Efficiency Cap',
    )
    expect(cleanLocalisation('£crypto£ Decryption Power')).toBe('Decryption Power')
    expect(cleanLocalisation('£operative_mission_icons_small|8£ For hire')).toBe('For hire')
    expect(cleanLocalisation('Cost (£command_power ): 5')).toBe('Cost ( ): 5')
    // Text without an icon keeps its spacing.
    expect(cleanLocalisation(' a  b ')).toBe(' a  b ')
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
