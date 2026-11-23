/**
 * The reward of a focus as the plan will actually play it, without the if/else scaffolding.
 *
 * Once the campaign has settled an `if` chain (`EffectLine.branch`), the branch that runs is just
 * its body: the header that explains why is noise. This drops the branches that do not run,
 * dissolves the header of the one that does (lifting its lines one level, however deeply the
 * chains nest) and drops block headers left with nothing under them. Chains the campaign could
 * not settle carry no marks and are left as written. A `swap_ideas` block becomes its plain
 * `add idea` and `remove idea` lines, or, when it takes an idea away and puts the same one back
 * (the game uses that to refresh an idea's modifiers), one `Replace idea X with X` line over the
 * net change.
 */
import type { EffectLine } from '../focus'
import { round } from '../numbers'
import { blockEnd, opensBlock, outdent } from './lines'

const nameOf = (line: EffectLine) => line.valueName ?? line.value

/** The stat lines under an idea line: what the idea adds, or, for a removed idea, takes away. */
const modifiersUnder = (group: EffectLine[]) =>
  group.filter((l) => l.isModifier && l.key !== null && l.value !== undefined && l.stat)

/** What a replaced idea changes: the modifiers of what is added plus those of what is removed. */
const netChange = (added: EffectLine[], removed: EffectLine[], depth: number): EffectLine[] => {
  const sums = new Map<string, EffectLine>()
  for (const m of [...modifiersUnder(removed), ...modifiersUnder(added)]) {
    const previous = sums.get(m.key!)
    if (m.isRule || Number.isNaN(Number(m.value))) {
      sums.set(m.key!, { ...m, depth })
    } else {
      const total = round(Number(previous?.value ?? 0) + Number(m.value))
      sums.set(m.key!, { ...m, depth, value: String(total) })
    }
  }
  // A modifier the new idea leaves as it was is not a change; a rule that stays `yes` neither.
  const unchanged = (m: EffectLine) => (m.isRule ? false : Number(m.value) === 0)
  return [...sums.values()].filter((m) => !unchanged(m))
}

/** The lines of a `swap_ideas` block, whose own header is gone. */
const swapLines = (swap: EffectLine, children: EffectLine[]): EffectLine[] => {
  const groups: EffectLine[][] = []
  for (const child of children) {
    if (child.depth === swap.depth + 1) groups.push([child])
    else groups[groups.length - 1]?.push(child)
  }
  const added = groups.find((g) => g[0].key === 'add_idea')
  const removed = groups.find((g) => g[0].key === 'remove_idea')
  if (!added || !removed || nameOf(added[0]) !== nameOf(removed[0])) return outdent(children)
  const net = netChange(added, removed, swap.depth + 2)
  return [
    {
      depth: swap.depth,
      key: 'replace_idea',
      valueName: nameOf(removed[0]),
      subjectName: nameOf(added[0]),
      hidden: swap.hidden,
    },
    {
      depth: swap.depth + 1,
      key: 'net_change',
      ...(net.length === 0 && { value: 'none' }),
      hidden: swap.hidden,
    },
    ...net.map((m) => ({ ...m, hidden: swap.hidden })),
  ]
}

export const onlyWhatHappens = (lines: EffectLine[]): EffectLine[] => {
  const out: EffectLine[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const end = blockEnd(lines, i)
    if (line.branch === 'skipped') {
      // The whole branch: its header is `skipped` too, and so is every line under it.
      i = end
    } else if (opensBlock(line) && line.branch === 'applies') {
      out.push(...onlyWhatHappens(outdent(lines.slice(i + 1, end))))
      i = end
    } else if (opensBlock(line, 'swap_ideas')) {
      out.push(...swapLines(line, lines.slice(i + 1, end)))
      i = end
    } else if (opensBlock(line) && end > i + 1) {
      const body = onlyWhatHappens(lines.slice(i + 1, end))
      // A block whose every line was a branch that does not run has nothing left to say.
      if (body.length > 0) out.push(line, ...body)
      i = end
    } else {
      out.push(line)
      i++
    }
  }
  return out
}
