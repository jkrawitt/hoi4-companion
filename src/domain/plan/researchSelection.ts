/**
 * Choosing techs for the queue, so that it stays valid: the counterpart of `focusSelection.ts`.
 * `known` is what the country has before the queue starts (its start techs), which satisfies
 * prerequisites without being queued.
 */
import type { ResearchItem, Technology } from '../research'

type Techs = Record<string, Technology>

const conflicts = (tech: Technology, taken: Set<string>, techs: Techs): boolean =>
  tech.exclusiveWith.some((id) => taken.has(id)) ||
  [...taken].some((id) => techs[id]?.exclusiveWith.includes(tech.id))

/**
 * The techs to append to `queue`, in order and ending with `id`, so that `id` becomes valid:
 * every missing prerequisite is queued first. Where a prerequisite group offers a choice, the
 * cheapest way to satisfy it (lowest total cost) is used. Returns null if `id` cannot be taken,
 * because it, or a required prerequisite, cannot be researched or excludes a tech already taken.
 */
export const pathToTech = (
  id: string,
  queue: ResearchItem[],
  techs: Techs,
  known: ReadonlySet<string> = new Set(),
): string[] | null => {
  const resolve = (target: string, taken: Set<string>, visiting: Set<string>): string[] | null => {
    const tech = techs[target]
    if (!tech?.researchable || visiting.has(target) || conflicts(tech, taken, techs)) return null
    const nextVisiting = new Set(visiting).add(target)

    const added: string[] = []
    const local = new Set(taken)
    for (const group of tech.prerequisites) {
      if (group.some((p) => local.has(p))) continue
      let best: string[] | null = null
      let bestCost = Infinity
      for (const option of group) {
        const path = resolve(option, local, nextVisiting)
        if (!path) continue
        const cost = path.reduce((sum, p) => sum + techs[p].cost, 0)
        if (cost < bestCost) {
          best = path
          bestCost = cost
        }
      }
      if (!best) return null
      for (const p of best) {
        added.push(p)
        local.add(p)
      }
    }
    if (conflicts(tech, local, techs)) return null
    return [...added, target]
  }

  const queued = new Set(queue.map((item) => item.techId))
  if (queued.has(id) || known.has(id)) return []
  return resolve(id, new Set([...known, ...queued]), new Set())
}

/** Queue after removing `id` and every queued tech that can no longer be reached without it. */
export const removeWithDependents = (
  id: string,
  queue: ResearchItem[],
  techs: Techs,
  known: ReadonlySet<string> = new Set(),
): ResearchItem[] => {
  let result = queue.filter((item) => item.techId !== id)
  for (;;) {
    const done = new Set(known)
    const next: ResearchItem[] = []
    for (const item of result) {
      const tech = techs[item.techId]
      if (tech?.prerequisites.every((g) => g.some((p) => done.has(p)))) {
        next.push(item)
        done.add(item.techId)
      }
    }
    if (next.length === result.length) return result
    result = next
  }
}

/**
 * Whether a queue ordering is valid: every tech can be researched, prerequisites come earlier
 * (or are known), no tech repeats and no two excluded techs are both queued.
 */
export const isValidResearchPlan = (
  queue: ResearchItem[],
  techs: Techs,
  known: ReadonlySet<string> = new Set(),
): boolean => {
  const taken = new Set(known)
  const done = new Set(known)
  for (const { techId } of queue) {
    const tech = techs[techId]
    if (!tech?.researchable || taken.has(techId) || conflicts(tech, taken, techs)) return false
    if (!tech.prerequisites.every((g) => g.some((p) => done.has(p)))) return false
    taken.add(techId)
    done.add(techId)
  }
  return true
}
