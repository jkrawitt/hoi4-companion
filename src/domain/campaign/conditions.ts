/**
 * Settling the conditions the plan can answer. A focus reward may hold `if = { limit = { ... } ... }`
 * chains (with `else_if` and `else` branches, either nested in the `if` or following it). When the
 * limit only asks about things the campaign knows at that point (the country's ideas, the focuses it
 * has completed, its ruling party and popularity, and later its technologies), the branch that
 * applies replaces the whole chain, so its changes count like any other. A condition we cannot
 * answer leaves the chain from that branch on in place, to be listed as conditional.
 */
import type { Check, EffectLine } from '../focus'
import { blockEnd, isElseBranch, opensBlock, outdent } from '../effects/lines'

/** What the campaign knows when a focus completes. A missing answer is `undefined`. */
export interface ConditionContext {
  hasIdea: (id: string) => boolean
  hasFocus: (id: string) => boolean
  /** The tech tree is not planned yet, so this can stay out until it is. */
  hasTech?: (id: string) => boolean | undefined
  /** Who leads the country, once known; `undefined` when not known (or retired and not replaced). */
  leader: () => { id?: string; character?: string } | undefined
  /** The ruling ideology group (`democratic`, `communism`, ...), once known. */
  government: () => string | undefined
  /** An ideology's popularity as a fraction of 1, once known. */
  popularity: (ideology: string) => number | undefined
}

const compare = (a: number, op: string, b: number): boolean => {
  // Popularity is summed from fractions, so allow for rounding when asking about equality.
  const close = Math.abs(a - b) < 1e-9
  if (op === '>') return a > b && !close
  if (op === '<') return a < b && !close
  if (op === '>=') return a > b || close
  if (op === '<=') return a < b || close
  return close
}

/** Whether `check` holds: true, false, or undefined when the campaign cannot tell. */
export const evaluateCheck = (check: Check, ctx: ConditionContext): boolean | undefined => {
  switch (check.type) {
    case 'idea':
      return ctx.hasIdea(check.id)
    case 'focus':
      return ctx.hasFocus(check.id)
    case 'tech':
      return ctx.hasTech?.(check.id)
    case 'government': {
      const government = ctx.government()
      return government === undefined ? undefined : government === check.id
    }
    case 'leader': {
      const leader = ctx.leader()
      if (!leader) return undefined
      // A legacy leader (`create_country_leader`) has an id and no character, and the other way round.
      if (check.id !== undefined && leader.id !== check.id) return false
      if (check.character === undefined) return true
      if (leader.character !== undefined) return leader.character === check.character
      return leader.id !== undefined ? false : undefined
    }
    case 'popularity': {
      const left = ctx.popularity(check.ideology)
      const right = typeof check.than === 'number' ? check.than : ctx.popularity(check.than)
      return left === undefined || right === undefined ? undefined : compare(left, check.op, right)
    }
    case 'not': {
      const inner = evaluateCheck(check.of, ctx)
      return inner === undefined ? undefined : !inner
    }
    case 'all':
    case 'any': {
      // One decisive term settles it: a false term for `all`, a true one for `any`.
      const decisive = check.type === 'any'
      const results = check.of.map((c) => evaluateCheck(c, ctx))
      if (results.includes(decisive)) return decisive
      return results.includes(undefined) ? undefined : !decisive
    }
    default:
      return undefined
  }
}

/** One branch of an `if` chain: its header line, and where its lines sit in `effects`. */
interface Branch {
  /** `undefined` for an `else`, which always applies once reached. */
  check?: Check | null
  /** The lines the branch applies, at the depth of the chain's own lines. */
  body: EffectLine[]
  /** The branch exactly as written, to leave in place when it cannot be settled. */
  raw: EffectLine[]
}

/** `effects` with each `if` chain the plan can answer replaced by the branch that applies. */
export const resolveConditions = (effects: EffectLine[], ctx: ConditionContext): EffectLine[] => {
  const result: EffectLine[] = []
  for (let i = 0; i < effects.length; i++) {
    const line = effects[i]
    if (!opensBlock(line, 'if') || !line.check) {
      result.push(line)
      continue
    }
    const depth = line.depth
    const ifEnd = blockEnd(effects, i)
    const inside = effects.slice(i + 1, ifEnd)
    // An `else` can sit inside the `if`, one level in, after the lines it replaces.
    const elseAt = inside.findIndex((l) => opensBlock(l, 'else') && l.depth === depth + 1)
    const branches: Branch[] = [
      {
        check: line.check,
        body: outdent(elseAt === -1 ? inside : inside.slice(0, elseAt)),
        raw: effects.slice(i, ifEnd),
      },
    ]
    if (elseAt !== -1) {
      branches.push({
        body: outdent(outdent(inside.slice(elseAt + 1, blockEnd(inside, elseAt)))),
        raw: [],
      })
    }
    // ...or an `else_if` / `else` can follow it, at the same level.
    let end = ifEnd
    while (isElseBranch(effects[end], depth)) {
      const branchEnd = blockEnd(effects, end)
      branches.push({
        check: effects[end].key === 'else' ? undefined : (effects[end].check ?? null),
        body: outdent(effects.slice(end + 1, branchEnd)),
        raw: effects.slice(end, branchEnd),
      })
      end = branchEnd
    }

    let decided = false
    for (let b = 0; b < branches.length && !decided; b++) {
      const { check, body } = branches[b]
      const holds =
        check === undefined ? true : check === null ? undefined : evaluateCheck(check, ctx)
      if (holds === true) {
        result.push(...resolveConditions(body, ctx))
        decided = true
      } else if (holds === undefined) {
        // Not settled: keep this branch and the ones after it as they were. The ones before it
        // failed, so a leading `else_if` is the start of the chain now.
        const rest = branches.slice(b).flatMap((x) => x.raw)
        if (b === 0 || rest.length === 0) result.push(...effects.slice(i, end))
        else result.push({ ...rest[0], key: 'if' }, ...rest.slice(1))
        decided = true
      }
    }
    i = end - 1
  }
  return result
}
