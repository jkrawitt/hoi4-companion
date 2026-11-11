import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { layoutFocuses } from '../focusLayout'
import { importCountryFocuses } from '../gameImport'

// Runs against a real install only when HOI4_DIR is set, e.g.
//   HOI4_DIR="/path/to/Hearts of Iron IV" npm run test
const dir = process.env.HOI4_DIR

describe.skipIf(!dir)('importCountryFocuses (real game files)', () => {
  it('imports Romania', async () => {
    const focuses = await importCountryFocuses(
      {
        readText: (p) => readFile(join(dir!, p), 'utf8').catch(() => null),
        listFiles: (p) => readdir(join(dir!, p)).catch(() => []),
      },
      'common/national_focus/romania.txt',
    )
    expect(focuses.length).toBeGreaterThan(50)
    const first = focuses.find((f) => f.id === 'ROM_preserve_greater_romania')
    expect(first?.name).toBe('Preserve Greater Romania')
    expect(first?.days).toBe(70)
    expect(first?.mutuallyExclusive).toContain('ROM_balkans_dominance')
    const pos = Object.values(layoutFocuses(focuses))
    expect(pos.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true)
    console.log(`grid ${Math.max(...pos.map((p) => p.x))} x ${Math.max(...pos.map((p) => p.y))}`)
    const named = focuses.filter((f) => f.name !== f.id).length
    console.log(`${focuses.length} focuses, ${named} with names`)
  })
})
