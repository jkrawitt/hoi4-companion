import type { Focus } from '../focus'

type Focuses = Record<string, Focus>

const conflicts = (focus: Focus, taken: Set<string>, focuses: Focuses): boolean =>
  focus.mutuallyExclusive.some((id) => taken.has(id)) ||
  [...taken].some((id) => focuses[id]?.mutuallyExclusive.includes(focus.id))

/**
 * The focuses to append to `plan`, in order and ending with `id`, so that `id` becomes valid:
 * every missing prerequisite is queued first. Where a prerequisite group offers a choice, the
 * cheapest way to satisfy it (fewest total days) is used. Returns null if `id` cannot be
 * taken, because it (or a required prerequisite) conflicts with a planned focus.
 */
export const pathTo = (id: string, plan: string[], focuses: Focuses): string[] | null => {
  const resolve = (target: string, taken: Set<string>, visiting: Set<string>): string[] | null => {
    const focus = focuses[target]
    if (!focus || visiting.has(target) || conflicts(focus, taken, focuses)) return null
    const nextVisiting = new Set(visiting).add(target)

    const added: string[] = []
    const local = new Set(taken)
    for (const group of focus.prerequisites) {
      if (group.some((p) => local.has(p))) continue
      let best: string[] | null = null
      let bestDays = Infinity
      for (const option of group) {
        const path = resolve(option, local, nextVisiting)
        if (!path) continue
        const days = path.reduce((sum, p) => sum + focuses[p].days, 0)
        if (days < bestDays) {
          best = path
          bestDays = days
        }
      }
      if (!best) return null
      for (const p of best) {
        added.push(p)
        local.add(p)
      }
    }
    if (conflicts(focus, local, focuses)) return null
    return [...added, target]
  }

  if (plan.includes(id)) return []
  return resolve(id, new Set(plan), new Set())
}

/** Whether every prerequisite group of every planned focus is met by an earlier one. */
const isConsistent = (plan: string[], focuses: Focuses): boolean => {
  const done = new Set<string>()
  for (const id of plan) {
    if (focuses[id]?.prerequisites.some((g) => !g.some((p) => done.has(p)))) return false
    done.add(id)
  }
  return true
}

/** Plan after removing `id` and every planned focus that can no longer be reached without it. */
export const removeWithDependents = (id: string, plan: string[], focuses: Focuses): string[] => {
  let result = plan.filter((p) => p !== id)
  for (;;) {
    const done = new Set<string>()
    const next: string[] = []
    for (const p of result) {
      if (focuses[p]?.prerequisites.every((g) => g.some((q) => done.has(q)))) {
        next.push(p)
        done.add(p)
      }
    }
    if (next.length === result.length) return result
    result = next
  }
}

/** Whether a plan ordering is valid: prerequisites met in order, no exclusive pairs, no repeats. */
export const isValidPlan = (plan: string[], focuses: Focuses): boolean => {
  const taken = new Set<string>()
  for (const id of plan) {
    const focus = focuses[id]
    if (!focus || taken.has(id) || conflicts(focus, taken, focuses)) return false
    taken.add(id)
  }
  return isConsistent(plan, focuses)
}
