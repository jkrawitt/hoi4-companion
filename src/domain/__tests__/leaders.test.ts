import { describe, expect, it } from 'vitest'
import {
  parseIdeologyGroups,
  parseLeaderRoles,
  parseRecruited,
  pickStartingLeader,
} from '../parsers/leaders'

describe('starting leader', () => {
  const groups = parseIdeologyGroups(
    'ideologies = { democratic = { types = { conservatism = { } liberalism = { } } } fascism = { types = { fascism_ideology = { } } } }',
  )
  const roles = parseLeaderRoles(`characters = {
    A = { country_leader = { ideology = fascism_ideology } }
    B = { country_leader = { ideology = liberalism } country_leader = { ideology = despotism } }
    C = { country_leader = { ideology = conservatism } }
  }`)

  it('maps sub-ideologies to their group and reads each role', () => {
    expect(groups).toEqual({
      conservatism: 'democratic',
      liberalism: 'democratic',
      fascism_ideology: 'fascism',
    })
    expect(roles.B).toEqual(['liberalism', 'despotism'])
  })

  it('picks the first recruited character who leads the ruling party', () => {
    const recruited = parseRecruited(
      'recruit_character = A\nrecruit_character = B\nrecruit_character = C',
    )
    expect(pickStartingLeader(recruited, roles, groups, 'democratic')).toEqual({
      character: 'B',
      ideology: 'liberalism',
    })
    expect(pickStartingLeader(recruited, roles, groups, 'communism')).toBeUndefined()
  })
})
