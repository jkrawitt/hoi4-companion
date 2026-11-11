import type { Focus } from './focus'

export interface Position {
  x: number
  y: number
}

/**
 * Resolves every focus to an absolute grid position. A focus with `relativeTo` is placed relative
 * to that focus's resolved position; unknown or circular references fall back to the origin.
 * Positions are shifted so the top-left focus is at (0, 0).
 */
export const layoutFocuses = (focuses: Focus[]): Record<string, Position> => {
  const byId = new Map(focuses.map((f) => [f.id, f]))
  const resolved: Record<string, Position> = {}
  const visiting = new Set<string>()

  const resolve = (focus: Focus): Position => {
    const known = resolved[focus.id]
    if (known) return known
    let base: Position = { x: 0, y: 0 }
    const parent = focus.relativeTo ? byId.get(focus.relativeTo) : undefined
    if (parent && !visiting.has(focus.id)) {
      visiting.add(focus.id)
      base = resolve(parent)
      visiting.delete(focus.id)
    }
    return (resolved[focus.id] = { x: base.x + focus.x, y: base.y + focus.y })
  }
  focuses.forEach(resolve)

  const all = Object.values(resolved)
  const minX = Math.min(...all.map((p) => p.x))
  const minY = Math.min(...all.map((p) => p.y))
  for (const p of all) {
    p.x -= minX
    p.y -= minY
  }
  return resolved
}
