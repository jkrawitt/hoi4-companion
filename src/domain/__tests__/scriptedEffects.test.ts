import { describe, expect, it } from 'vitest'
import { parseScript } from '../parsers/paradoxScript'
import { expandEffects, parseScriptedEffects } from '../parsers/scriptedEffects'
import { parseFocusTreeFile } from '../parsers/focusTree'

const effects = parseScriptedEffects(`
  small_effect = { add_stability = 0.05 }
  with_arg = { add_political_power = $AMOUNT$ }
  outer = { small_effect = yes with_arg = { AMOUNT = 10 } }
`)

describe('expandEffects', () => {
  it('writes a call out, with arguments filled in and nested calls expanded', () => {
    const out = expandEffects(
      parseScript('a = yes outer = yes b = { with_arg = { AMOUNT = 3 } }'),
      effects,
    )
    expect(out).toEqual(
      parseScript(
        'a = yes add_stability = 0.05 add_political_power = 10 b = { add_political_power = 3 }',
      ),
    )
  })

  it('stops at a loop', () => {
    const loop = parseScriptedEffects('x = { x = yes }')
    expect(() => expandEffects(parseScript('x = yes'), loop)).not.toThrow()
  })

  it('shows up in a focus reward', () => {
    const focuses = parseFocusTreeFile(
      'focus_tree = { focus = { id = A cost = 1 completion_reward = { small_effect = yes } } }',
      effects,
    )
    expect(focuses[0].effects.map((l) => l.key)).toContain('add_stability')
  })
})
