/**
 * Settling the conditions the plan can answer. A focus reward may hold `if = { limit = { ... } ... }`
 * chains (with `else_if` and `else` branches, either nested in the `if` or following it). When the
 * limit only asks about things the campaign knows at that point (the country's ideas, the focuses it
 * has completed, its ruling party and popularity, and later its technologies), the branch that
 * applies replaces the whole chain, so its changes count like any other. A condition we cannot
 * answer leaves the chain from that branch on in place, to be listed as conditional. What a check
 * says is in `../checks.ts`.
 */
import type { Check, EffectLine } from '../focus'
import { evaluateCheck, type ConditionContext } from '../checks'
import { blockEnd, isElseBranch, opensBlock, outdent } from '../effects/lines'

/** One branch of an `if` chain, as index ranges into the lines it was read from. */
interface Branch {
  /** `undefined` for an `else`, which always applies once reached. */
  check?: Check | null
  /** The branch from its header line to the end of its lines. */
  span: [number, number]
  /** The lines the branch applies, and how many levels deeper than the chain they sit. */
  body: [number, number]
  drop: number
}

/** An `if` chain: its branches in order, and the index just past its last line. */
interface Chain {
  branches: Branch[]
  end: number
}

/** Reads the chain starting at the `if` on `effects[i]`, in either layout. */
const readChain = (effects: EffectLine[], i: number): Chain => {
  const depth = effects[i].depth
  const ifEnd = blockEnd(effects, i)
  // An `else` can sit inside the `if`, one level in, after the lines it replaces. One that follows
  // an `if` or `else_if` of that level belongs to it instead.
  let elseAt = -1
  let previous: string | null = null
  for (let j = i + 1; j < ifEnd; j++) {
    const inner = effects[j]
    if (inner.depth !== depth + 1 || !opensBlock(inner)) continue
    if (inner.key === 'else' && previous !== 'if' && previous !== 'else_if') {
      elseAt = j
      break
    }
    previous = inner.key
  }
  const ifBodyEnd = elseAt === -1 ? ifEnd : elseAt
  const branches: Branch[] = [
    { check: effects[i].check, span: [i, ifBodyEnd], body: [i + 1, ifBodyEnd], drop: 1 },
  ]
  if (elseAt !== -1) {
    const elseEnd = blockEnd(effects, elseAt)
    branches.push({ span: [elseAt, elseEnd], body: [elseAt + 1, elseEnd], drop: 2 })
  }
  // ...or an `else_if` / `else` can follow it, at the same level.
  let end = ifEnd
  while (isElseBranch(effects[end], depth)) {
    const branchEnd = blockEnd(effects, end)
    branches.push({
      check: effects[end].key === 'else' ? undefined : (effects[end].check ?? null),
      span: [end, branchEnd],
      body: [end + 1, branchEnd],
      drop: 1,
    })
    end = branchEnd
  }
  return { branches, end }
}

/**
 * Which branch applies: the first whose limit holds. When a limit cannot be answered first,
 * `unsettled` is that branch, and nothing from it on is decided.
 */
const decideChain = (
  branches: Branch[],
  ctx: ConditionContext,
): { applies?: number; unsettled?: number } => {
  for (let b = 0; b < branches.length; b++) {
    const { check } = branches[b]
    const holds =
      check === undefined ? true : check === null ? undefined : evaluateCheck(check, ctx)
    if (holds === true) return { applies: b }
    if (holds === undefined) return { unsettled: b }
  }
  return {}
}

/**
 * Whether each line sits where its limit is about this country: every block around it is the top
 * level, a `hidden_effect`, the country's own scope or a branch of a chain that is itself there.
 * Inside any other block (another country, a state, a character, `every_other_country`, ...) a
 * limit asks about something else, so the campaign cannot answer it.
 */
const ownScopeFlags = (effects: EffectLine[], tag: string | undefined): boolean[] => {
  const stack: { depth: number; own: boolean }[] = []
  return effects.map((line) => {
    while (stack.length > 0 && stack[stack.length - 1].depth >= line.depth) stack.pop()
    const own = stack.length === 0 || stack[stack.length - 1].own
    if (opensBlock(line)) {
      const key = line.key
      const ownBlock =
        key === 'hidden_effect' ||
        key === 'ROOT' ||
        key === 'THIS' ||
        key === 'if' ||
        key === 'else' ||
        key === 'else_if' ||
        (tag !== undefined && key === tag)
      stack.push({ depth: line.depth, own: own && ownBlock })
    }
    return own
  })
}

/** `effects` with each `if` chain the plan can answer replaced by the branch that applies. */
export const resolveConditions = (effects: EffectLine[], ctx: ConditionContext): EffectLine[] => {
  const own = ownScopeFlags(effects, ctx.tag)
  const result: EffectLine[] = []
  for (let i = 0; i < effects.length; i++) {
    const line = effects[i]
    if (!own[i] || !opensBlock(line, 'if') || !line.check) {
      result.push(line)
      continue
    }
    const { branches, end } = readChain(effects, i)
    const { applies, unsettled } = decideChain(branches, ctx)
    if (applies !== undefined) {
      const { body, drop } = branches[applies]
      let lines = effects.slice(body[0], body[1])
      for (let d = 0; d < drop; d++) lines = outdent(lines)
      result.push(...resolveConditions(lines, ctx))
    } else if (unsettled === 0) {
      result.push(...effects.slice(i, end))
    } else if (unsettled !== undefined) {
      // Not settled: keep this branch and the ones after it as they were. The ones before it
      // failed, so a leading `else_if` is the start of the chain now.
      const rest = branches.slice(unsettled).flatMap((b) => effects.slice(...b.span))
      result.push({ ...rest[0], key: 'if' }, ...rest.slice(1))
    }
    // Otherwise every branch failed and there was no `else`: nothing applies.
    i = end - 1
  }
  return result
}

/**
 * The same lines as `effects`, in the same order, with the branches marked: `branch: 'applies'` on
 * the header of the branch that applies, `'skipped'` on every line of a branch that does not
 * (including the branches after the one that applies). A chain that cannot be settled stays
 * unmarked from the unanswered branch on. Chains inside the branch that applies are marked in turn.
 */
export const annotateConditions = (effects: EffectLine[], ctx: ConditionContext): EffectLine[] => {
  const marks: (EffectLine['branch'] | undefined)[] = new Array(effects.length).fill(undefined)
  const own = ownScopeFlags(effects, ctx.tag)
  const walk = (from: number, to: number) => {
    for (let i = from; i < to; i++) {
      const line = effects[i]
      if (!own[i] || !opensBlock(line, 'if') || !line.check) continue
      const { branches, end } = readChain(effects, i)
      const { applies, unsettled } = decideChain(branches, ctx)
      branches.forEach(({ span, body }, b) => {
        if (b === applies) {
          marks[span[0]] = 'applies'
          walk(body[0], body[1])
        } else if (applies !== undefined || unsettled === undefined || b < unsettled) {
          marks.fill('skipped', span[0], span[1])
        }
      })
      i = end - 1
    }
  }
  walk(0, effects.length)
  return effects.map((line, i) => (marks[i] ? { ...line, branch: marks[i] } : line))
}
