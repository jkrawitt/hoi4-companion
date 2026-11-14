import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { layoutFocuses } from '../plan/focusLayout'
import { ownedDlc } from '../../data/dlc'
import { statOverrides } from '../../data/statOverrides'
import { effectTone, formatEffect } from '../focusEffects'
import { importCountryFocuses } from '../gameImport'
import { countryStateAt } from '../campaign/countryState'
import { industryAt } from '../campaign/industry'
import { planConstruction } from '../campaign/construction'
import { planResearch } from '../campaign/research'
import { isPowered } from '../plan/constructionPlan'

// Runs against a real install only when HOI4_DIR is set, e.g.
//   HOI4_DIR="/path/to/Hearts of Iron IV" npm run test
const dir = process.env.HOI4_DIR

const importRomania = () =>
  importCountryFocuses(
    {
      readText: (p) => readFile(join(dir!, p), 'utf8').catch(() => null),
      listFiles: (p) => readdir(join(dir!, p)).catch(() => []),
    },
    {
      tag: 'ROM',
      name: 'Romania',
      focusTreeFile: 'common/national_focus/romania.txt',
      ideasFile: 'common/ideas/romania.txt',
    },
    statOverrides,
    ownedDlc,
  )

describe.skipIf(!dir)('importCountryFocuses (real game files)', () => {
  it('imports the research tree', async () => {
    const { research, start } = await importRomania()
    const techs = Object.fromEntries(research.techs.map((t) => [t.id, t]))
    expect(research.techs.length).toBeGreaterThan(300)
    const folders = research.folders.map((f) => f.id)
    // The DLC variants of the owned DLCs, and not the one for a DLC that is not owned.
    expect(folders).toEqual(
      expect.arrayContaining(['bba_air_techs_folder', 'mtgnavalfolder', 'armour_folder']),
    )
    expect(folders).not.toContain('nsb_armour_folder')
    expect(folders).not.toContain('air_techs_folder')
    expect(research.folders.find((f) => f.id === 'industry_folder')?.name).toBe('Industry')
    expect(research.defines).toEqual({ baseCost: 110, aheadPenalty: 2, minSpeed: 0.1 })

    const unlocked = start.flatMap((l) => (l.research?.kind === 'unlock' ? l.research.targets : []))
    expect(unlocked).toEqual(expect.arrayContaining(['infantry_weapons', 'iw_small_airframe']))
    expect(unlocked).not.toContain('early_fighter')

    expect(techs.infantry_weapons1.researchable).toBe(true)
    // A tech with no name of its own goes by the equipment it unlocks.
    expect(techs.infantry_weapons1.name).toBe('Infantry Equipment I')
    expect(techs.basic_machine_tools.name).toBe('Basic Machine Tools')
    // Each folder is several trees, each placed by the research screen's own grid box.
    const at = (id: string) => techs[id].folders[0]
    expect(at('basic_machine_tools').id).toBe('industry_folder')
    expect(at('construction1').x).toBeGreaterThan(at('dispersed_industry').x + 2)
    expect(at('fuel_silos').x).toBeGreaterThan(at('excavation1').x + 2)
    // The army folders run sideways: a later tech is further right, not further down.
    expect(research.folders.find((f) => f.id === 'infantry_folder')?.sideways).toBe(true)
    expect(at('infantry_weapons2').x).toBeGreaterThan(at('infantry_weapons1').x)
    expect(at('infantry_weapons2').y).toBe(at('infantry_weapons1').y)
    expect(techs.infantry_weapons2.prerequisites).toEqual([['infantry_weapons1']])
    expect(techs.basic_machine_tools).toMatchObject({ cost: 1.5, startYear: 1936 })
    expect(techs.improved_small_airframe.name).toBeTruthy()
    expect(techs.improved_small_airframe.name).not.toContain('$')
    expect(techs.flexible_line.exclusiveWith).toEqual(['streamlined_line'])
    // Special projects cannot be researched in a slot.
    expect(techs.cavity_magnatron.researchable).toBe(false)
    expect(research.techs.every((t) => t.folders.every((f) => folders.includes(f.id)))).toBe(true)
    // Several parents are alternatives: the medium and heavy tank lines lead to each other.
    expect(techs.improved_medium_tank.prerequisites).toEqual([
      expect.arrayContaining(['basic_medium_tank', 'improved_heavy_tank']),
    ])
  })

  it('imports Romania', async () => {
    const { focuses, start } = await importRomania()
    expect(focuses.length).toBeGreaterThan(50)
    expect(start.map((e) => e.key)).toEqual(
      expect.arrayContaining(['add_stability', 'set_politics', 'add_popularity', 'add_ideas']),
    )
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

  it('imports the production data', async () => {
    const { production, start } = await importRomania()
    const sum = (type: string) =>
      production.states.reduce((n, s) => n + (s.buildings[type] ?? 0), 0)
    expect(production.states).toHaveLength(12)
    expect([sum('industrial_complex'), sum('arms_factory'), sum('dockyard')]).toEqual([11, 7, 2])
    expect(production.states.find((s) => s.id === 46)?.name).toBe('Muntenia')
    expect(production.categorySlots.city).toBe(6)
    expect(production.sharedSlotBuildings).toEqual(
      expect.arrayContaining(['arms_factory', 'industrial_complex', 'dockyard']),
    )
    // The default laws are added to the start, with their modifiers listed.
    const laws = start.filter((l) => l.key === 'add_ideas' && l.value).map((l) => l.value)
    expect(laws).toEqual(
      expect.arrayContaining(['civilian_economy', 'export_focus', 'volunteer_only']),
    )
    const economy = start.findIndex((l) => l.value === 'civilian_economy')
    expect(start[economy + 1].key).toBe('consumer_goods_expected_value')

    const industry = industryAt(
      production,
      countryStateAt(
        { items: [], finish: new Date(Date.UTC(1936, 0, 1)) } as never,
        new Date(Date.UTC(1936, 0, 1)),
        {
          start,
          startDate: new Date(Date.UTC(1936, 0, 1)),
          tag: 'ROM',
        },
      ),
      [],
    )
    console.log(
      `states ${production.states.length}, slots ${JSON.stringify(industry.slots)}, consumer ${JSON.stringify(industry.consumerGoods)}, available civs ${industry.availableCivs}, laws ${laws.join(',')}`,
    )
    // No consumer goods factor at the 1936 start: the king's penalty idea needs a DLC.
    expect(industry.consumerGoods).toEqual({ percent: 0.35, factories: 7 })
    expect(industry.availableCivs).toBe(4)
  })

  it('schedules a civilian factory in Muntenia at the 1936 start', async () => {
    const { production, start, research } = await importRomania()
    expect(production.buildings.map((b) => b.id)).toEqual(
      expect.arrayContaining(['industrial_complex', 'arms_factory', 'infrastructure']),
    )
    const civ = production.buildings.find((b) => b.id === 'industrial_complex')
    expect(civ).toMatchObject({ cost: 10800, stateMax: 20, sharesSlots: true, infraEffect: true })
    expect(production.defines).toMatchObject({
      maxCivsPerProject: 15,
      baseFactorySpeed: 4,
      poweredFactorySpeed: 5,
      energyResource: 'coal',
    })

    const startDate = new Date(Date.UTC(1936, 0, 1))
    const focusSchedule = { items: [], finish: startDate, totalDays: 0 }
    const options = { start, startDate, tag: 'ROM' }
    const finalState = countryStateAt(focusSchedule, startDate, options)
    const planned = planResearch({
      focusSchedule,
      options,
      queue: [],
      data: research,
      startDate,
      until: new Date(Date.UTC(1937, 0, 1)),
    })
    const muntenia = production.states.find((s) => s.id === 46)!
    const { schedule, environment } = planConstruction({
      production,
      finalState,
      research: planned.schedule,
      techs: research.techs,
      queue: [{ building: 'industrial_complex', state: muntenia.id, levels: 1 }],
      startDate,
      until: new Date(Date.UTC(1940, 0, 1)),
    })

    const factors = environment.factors[0]
    const civs = production.states.reduce((n, s) => n + (s.buildings.industrial_complex ?? 0), 0)
    const mils = production.states.reduce((n, s) => n + (s.buildings.arms_factory ?? 0), 0)
    const docks = production.states.reduce((n, s) => n + (s.buildings.dockyard ?? 0), 0)
    const coal = production.states.reduce((n, s) => n + (s.resources.coal ?? 0), 0)
    const power = isPowered(civs + mils + docks, coal, factors, production.defines)
    const level = schedule.items[0].levels[0]
    const perCiv = power.powered ? 5 : 4
    console.log(
      `civ output/day ${level.civs * perCiv} (${level.civs} civs x ${perCiv}), powered ${power.powered}, ` +
        `energy produced ${power.produced} used ${power.used.toFixed(2)}, coal ${coal}, factors ${JSON.stringify(factors)}, ` +
        `days for one civilian factory in ${muntenia.name} ${level.days}`,
    )
    expect(power.powered).toBe(true)
    // 11 civs, 35% consumer goods takes 7: 4 spare civs.
    expect(level.civs).toBe(4)
    expect(level.days).toBeGreaterThan(100)
    expect(level.days).toBeLessThan(1000)
  })
})
