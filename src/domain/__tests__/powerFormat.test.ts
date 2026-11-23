import { describe, expect, it } from 'vitest'
import { shown, withExact } from '../../components/powerFormat'

describe('power format', () => {
  it('cuts the shown value like the game, and keeps the exact one beside it', () => {
    expect(shown(0.798, 2)).toBe('0.79')
    expect(shown(27.334, 0)).toBe('27')
    expect(shown(0.8, 2)).toBe('0.80')
    expect(withExact(0.798, 2)).toBe('0.79 (0.798)')
    expect(withExact(106.83, 0)).toBe('106 (106.830)')
  })

  it('does not lose a value that is a hair under a round number to float error', () => {
    expect(shown(1.1 * 3, 2)).toBe('3.30')
  })
})
