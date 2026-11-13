import { describe, expect, it } from 'vitest'
import type { GameFiles } from '../gameFiles'
import { loadNames } from '../names'

const files = (yml: string): GameFiles => ({
  readText: async () => yml,
  listFiles: async () => ['modifiers_l_english.yml'],
})

describe('loadNames', () => {
  it('fills in references, however deep they go', async () => {
    const { names } = await loadNames(
      files(`l_english:
 a: "$b$"
 b: "Maximum $c$ level"
 c: "Land Fort"
 unrelated: "never asked for"
 loop1: "$loop2$"
 loop2: "$loop1$"
`),
      new Set(['a', 'loop1']),
    )
    expect(names.a).toBe('Maximum Land Fort level')
    expect(names.unrelated).toBeUndefined()
    // References that go round in circles stay unresolved, and do not hang.
    expect(names.loop1).toMatch(/^\$loop\d\$$/)
  })

  it('leaves a reference to a missing text as written', async () => {
    const { names } = await loadNames(files('l_english:\n a: "Hello $missing$"\n'), new Set(['a']))
    expect(names.a).toBe('Hello $missing$')
  })
})
