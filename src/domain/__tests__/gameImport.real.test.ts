import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { layoutFocuses } from '../focusLayout'
import { ownedDlc } from '../../data/dlc'
import { statOverrides } from '../../data/statOverrides'
import { effectTone, formatEffect } from '../focusEffects'
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
      {
        name: 'Romania',
        focusTreeFile: 'common/national_focus/romania.txt',
        ideasFile: 'common/ideas/romania.txt',
      },
      statOverrides,
      ownedDlc,
    )
    expect(focuses.length).toBeGreaterThan(50)
    const first = focuses.find((f) => f.id === 'ROM_preserve_greater_romania')
    expect(first?.name).toBe('Preserve Greater Romania')
    expect(first?.days).toBe(70)
    expect(first?.description).toContain('Romanian')
    expect(first?.effects[0]).toMatchObject({
      key: 'add_ideas',
      value: 'ROM_preserve_greater_romania',
    })
    expect(first?.effects[0].valueName).toBeTruthy()
    expect(first?.effects.slice(0, 3)).toMatchObject([
      { key: 'add_ideas' },
      { depth: 1, key: 'guarantee_tension', isModifier: true },
      { depth: 1, key: 'guarantee_cost', isModifier: true },
    ])
    expect(first?.effects[2].stat).toMatchObject({ label: 'Guarantee Cost', kind: 'percent' })
    expect(first?.effects[1].stat).toMatchObject({ kind: 'percent', decimals: 0 })
    const militias = focuses.find((f) => f.id === 'ROM_form_peasant_militias')
    expect(militias?.effects.map((e) => formatEffect(e))).toEqual(
      expect.arrayContaining(['Daily Communism Support: 0.01', 'Recruitable Population: 1.00%']),
    )
    const volunteers = focuses.find((f) => f.id === 'ROM_romanian_volunteer_brigades')
    expect(volunteers?.effects.map((e) => formatEffect(e))).toEqual(
      expect.arrayContaining([
        'Divisions required for sending volunteer force: -100%',
        'Max volunteer force divisions: +1',
        'Can send volunteers: yes',
      ]),
    )
    expect(volunteers?.effects.map((e) => effectTone(e)).slice(1)).toEqual(['good', 'good', 'good'])
    const advisors = focuses.find((f) => f.id === 'ROM_invite_german_advisors')
    const advisorLines = advisors?.effects.map((e) => `${e.hidden ? '~' : ''}${formatEffect(e)}`)
    expect(advisorLines).toEqual(
      expect.arrayContaining([
        'Permit Germany to station troops on Romanian soil.',
        '~Hidden effect:',
        '~German Reich:',
        '~Military access with Romania: yes',
        '2x 35% cost reduction for: Land Doctrine',
      ]),
    )
    const license = focuses.find((f) => f.id === 'ROM_license_german_equipment')
    expect(license?.effects.map((e) => '  '.repeat(e.depth) + formatEffect(e))).toEqual([
      'Gains License German Equipment when dealing with German Reich',
      '  Acceptance when requesting to buy license: +20',
      '  License production speed: +25%',
      '  License production speed from technology difference: +25%',
    ])
    const lines = (id: string) =>
      focuses.find((f) => f.id === id)?.effects.map((e) => formatEffect(e)) ?? []
    expect(lines('ROM_army_maneuvers')).toContain('Army experience: +50')
    expect(lines('ROM_expand_the_university_of_bucharest')).toContain('Research slots: +1')
    expect(lines('ROM_his_majestys_loyal_government')).toContain('Political power: +120')
    expect(lines('ROM_balkans_dominance')).toContain('Can create factions: yes')
    expect(lines('ROM_appoint_german_friendly_government')).toEqual(
      expect.arrayContaining(['Stability: -5%', 'Unlocks decision: Join the Axis']),
    )
    expect(lines('ROM_force_abdication')).toEqual(
      expect.arrayContaining([
        'News: King Carol II Abdicates',
        'Add timed idea: King Carol Emptied Accounts (360 days)',
      ]),
    )
    await writeFile(
      process.env.PROBE_OUT ?? '/dev/null',
      [...new Set(focuses.flatMap((f) => f.effects.map((e) => formatEffect(e))))].sort().join('\n'),
    )
    expect(lines('ROM_national_defense_industry')).toEqual(
      expect.arrayContaining(['Building slots: +1', 'Build 1 Military Factory (instantly)']),
    )
    const everything = focuses.flatMap((f) => f.effects.map((e) => formatEffect(e)))
    expect(everything).toEqual(
      expect.arrayContaining([
        '2x 100% research bonus for: Industry',
        'Unlocks technology: Mountain Gun',
        'Create design: IAR 80',
        'Ruling party: Non-Aligned (no elections)',
        'Set Non-Aligned popularity: 65%',
        'Rename Fascist party: Garda de Fier',
        'Promote Michael I to country leader (Liberalism)',
        'Carol II Becomes Leader',
        'Autonomy of Romania: Personal Union',
        'Remove advisor role: Chief of Army',
        'Claim added for: Romania',
        'Create faction: Cordon Sanitaire',
      ]),
    )
    expect(
      focuses.flatMap((f) => f.effects.filter((e) => e.key === 'free_building_slots')),
    ).toEqual([])
    // Without Arms Against Tyranny the `else` branch is shown in place of the MIO.
    expect(lines('ROM_invest_in_the_iar')).toEqual(
      expect.arrayContaining(['Available as Design Company:', 'Idea: IAR']),
    )
    expect(everything.filter((l) => /\bmio\b/i.test(l))).toEqual([])
    const ploiesti = focuses.find((f) => f.id === 'ROM_expand_ploiesti_oil_production')
    expect(ploiesti?.effects.map((e) => '  '.repeat(e.depth) + formatEffect(e))).toEqual(
      expect.arrayContaining(['Muntenia:', '  Add production of 24 Oil']),
    )
    const tone = (text: string) => {
      const line = focuses.flatMap((f) => f.effects).find((e) => formatEffect(e) === text)
      return line && effectTone(line)
    }
    expect(tone('Consumer Goods Factories factor: -15%')).toBe('good')
    expect(tone('Consumer Goods Factories factor: +30%')).toBe('bad')
    expect(tone('Justify war goal time: -25%')).toBe('good')
    expect(tone('Nuclear Reactor Construction Speed: +25%')).toBe('good')
    const guards = focuses.find((f) => f.id === 'ROM_royal_guards_divisions')
    expect(guards?.effects.slice(1).map((e) => '  '.repeat(e.depth) + formatEffect(e))).toEqual([
      'Hidden effect:',
      '  Random owned and controlled state (prioritize Muntenia):',
      '    Create unit: Royal Guards Division',
    ])
    const yugoslavia = focuses.find((f) => f.id === 'ROM_divide_yugoslavia')
    expect(yugoslavia?.effects.map((e) => '  '.repeat(e.depth) + formatEffect(e))).toEqual([
      'If Yugoslavia (has war: yes or is subject: yes):',
      '  Gain Annex wargoal on Yugoslavia',
      'Otherwise:',
      '  Unlocks decision category: The Partition of Yugoslavia',
    ])
    const dominance = focuses.find((f) => f.id === 'ROM_balkans_dominance')
    expect(dominance?.effects.map((e) => formatEffect(e))).toEqual(
      expect.arrayContaining([
        'Every other country where has opinion modifier: The Balkan Pact:',
        'Opinion of Bulgaria: -30 (Incongruous Neighbors)',
      ]),
    )
    expect(everything.filter((l) => /^(if|limit|else|NOT|OR):?$/.test(l))).toEqual([])
    const dictatorship = focuses.find((f) => f.id === 'ROM_institute_royal_dictatorship')
    const hedonist = dictatorship?.effects.findIndex((e) => e.key === 'leader_trait') ?? -1
    expect(
      dictatorship?.effects
        .slice(hedonist - 1, hedonist + 3)
        .map((e) => '  '.repeat(e.depth) + formatEffect(e)),
    ).toEqual([
      'Carol II Becomes Leader',
      '  Leader trait: Hedonist',
      '    Stability: -5%',
      'Ruling party: Non-Aligned (no elections)',
    ])
    expect(tone('Stability: -5%')).toBe('bad')
    expect(tone('Economy Laws Cost: -25%')).toBe('good')
    const sentinels = focuses.find((f) => f.id === 'ROM_militarize_the_sentinels')
    expect(sentinels?.effects.map((e) => '  '.repeat(e.depth) + formatEffect(e))).toEqual(
      expect.arrayContaining([
        '  remove idea: The Sentinel of the Motherland',
        '    Recruitable Population: -1.00%',
      ]),
    )
    expect(tone('Recruitable Population: -1.00%')).toBe('bad')
    const crackDown = focuses.find((f) => f.id === 'ROM_crack_down_on_extremism')
    expect(
      crackDown?.effects.slice(0, 3).map((e) => '  '.repeat(e.depth) + formatEffect(e)),
    ).toEqual(['Ion Antonescu:', '  Becomes country leader', '    Leader trait: Conducător'])
    expect(everything).toContain('Nuclear Research breakthrough progress: +75%')
    // Texts built from other texts (`$key$`) are filled in, and shared idea names are found.
    expect(everything.filter((l) => /\$[\w.]+\$/.test(l) && !l.includes('airframe'))).toEqual([])
    expect(everything).toContain('add idea: King Carol II')
    expect(everything.filter((l) => l.includes('ROM_king_carol_ii_handled_2'))).toEqual([])
    const cordon = focuses.find((f) => f.id === 'ROM_the_cordon_sanitaire')
    expect(cordon?.effects.map((e) => '  '.repeat(e.depth) + formatEffect(e))).toEqual([
      'Can create factions: yes',
      'Create faction: Cordon Sanitaire',
      'Czechoslovak Republic:',
      '  Event: The Cordon Sanitaire',
      'Poland:',
      '  Event: The Cordon Sanitaire',
      'Poland:',
      '  Event: Romania seeks to join our faction',
      'Hidden effect:',
      '  News: The Cordon Sanitaire',
    ])
    const guarantee = focuses.flatMap((f) => f.effects.map((e) => formatEffect(e)))
    expect(guarantee).toContain('If France is in faction with: Britain:')
    const transnistria = focuses.find((f) => f.id === 'ROM_demand_transnistria')
    expect(transnistria?.effects.map((e) => formatEffect(e))).toEqual([
      'Gain Conquer (Focus) wargoal on Soviet Union',
    ])
    const joinAxis = focuses.find((f) => f.id === 'ROM_join_axis')
    expect(joinAxis?.effects.map((e) => '  '.repeat(e.depth) + formatEffect(e))).toEqual([
      'German Reich:',
      '  Event: Romania seeks to join the Axis',
    ])
    const oil = focuses.find((f) => f.id === 'ROM_german_romanian_oil_exploitation_company')
    expect(oil?.effects.map((e) => '  '.repeat(e.depth) + formatEffect(e))).toEqual([
      'Random owned and controlled state (prioritize Muntenia):',
      '  Add production of 8 Oil',
      'German Reich:',
      '  Random owned and controlled state:',
      '    Add production of 4 Oil',
    ])
    const deal = focuses.find((f) => f.id === 'ROM_a_deal_with_the_devil')
    expect(deal?.effects.map((e) => formatEffect(e))).toEqual(
      expect.arrayContaining([
        'Opinion of Soviet Union: +40 (A Deal with the Devil)',
        'Soviet Union:',
        'Opinion of Romania: +40 (A Deal with the Devil)',
      ]),
    )
    expect(first?.mutuallyExclusive).toContain('ROM_balkans_dominance')
    const pos = Object.values(layoutFocuses(focuses))
    expect(pos.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true)
    console.log(`grid ${Math.max(...pos.map((p) => p.x))} x ${Math.max(...pos.map((p) => p.y))}`)
    const named = focuses.filter((f) => f.name !== f.id).length
    console.log(`${focuses.length} focuses, ${named} with names`)
  })
})
