import { describe, expect, it } from 'vitest'
import { parseScript } from '../parsers/paradoxScript'

describe('parseScript', () => {
  it('handles comparison operators, quoted strings with # and bare values', () => {
    const block = parseScript('a = { size > 0 name = "x # y" b c }')
    const inner = block[0].value as { key: string | null; operator: string; value: unknown }[]
    expect(inner[0]).toMatchObject({ key: 'size', operator: '>', value: '0' })
    expect(inner[1]).toMatchObject({ key: 'name', value: 'x # y' })
    expect(inner[2]).toMatchObject({ key: null, value: 'b' })
  })
})
