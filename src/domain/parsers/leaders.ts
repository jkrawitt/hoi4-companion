/**
 * Who leads a country at the start of the game. The history file only recruits characters
 * (`recruit_character = X`); which of them leads is the first whose `country_leader` role has an
 * ideology belonging to the ruling party (`conservatism` belongs to `democratic`).
 */
import { getAll, getBlock, getString, getStrings, parseScript } from './paradoxScript'

/** The sub-ideology each ideology group holds, inverted: `conservatism` to `democratic`. */
export const parseIdeologyGroups = (text: string): Record<string, string> => {
  const groups: Record<string, string> = {}
  const root = getBlock(parseScript(text), 'ideologies') ?? []
  for (const group of root) {
    if (typeof group.value === 'string' || group.key === null) continue
    for (const type of getBlock(group.value, 'types') ?? []) {
      if (type.key !== null) groups[type.key] = group.key
    }
  }
  return groups
}

/** The ideology of each `country_leader` role of each character in a `common/characters` file. */
export const parseLeaderRoles = (text: string): Record<string, string[]> => {
  const roles: Record<string, string[]> = {}
  for (const character of getBlock(parseScript(text), 'characters') ?? []) {
    if (typeof character.value === 'string' || character.key === null) continue
    roles[character.key] = getAll(character.value, 'country_leader').flatMap((role) => {
      const ideology =
        typeof role.value === 'string' ? undefined : getString(role.value, 'ideology')
      return ideology ? [ideology] : []
    })
  }
  return roles
}

/** Characters a history file recruits at the start, in order (top level only). */
export const parseRecruited = (historyText: string): string[] =>
  getStrings(parseScript(historyText), 'recruit_character')

/** The first recruited character who can lead the ruling party, with the ideology they lead as. */
export const pickStartingLeader = (
  recruited: string[],
  roles: Record<string, string[]>,
  groups: Record<string, string>,
  rulingParty: string,
): { character: string; ideology: string } | undefined => {
  for (const character of recruited) {
    const ideology = (roles[character] ?? []).find(
      (i) => i === rulingParty || groups[i] === rulingParty,
    )
    if (ideology) return { character, ideology }
  }
  return undefined
}
