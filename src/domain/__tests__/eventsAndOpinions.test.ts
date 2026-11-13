import { describe, expect, it } from 'vitest'
import { collapseEffects, effectTone, flattenEffects, formatEffect } from '../focusEffects'
import { parseOpinionModifiers } from '../parsers/opinionModifiers'
import { parseEventTitles } from '../parsers/events'
import { parseFactionTemplates } from '../parsers/factions'
import { resolveEventText } from '../parsers/localisation'
import { parseScript } from '../parsers/paradoxScript'

describe('wargoals', () => {
  it('collapses create_wargoal, dropping the generator states', () => {
    const [line] = collapseEffects(
      flattenEffects(
        parseScript(
          'create_wargoal = { type = take_state_focus target = SOV generator = { 834 } }',
        ),
      ),
    )
    expect(line).toEqual({
      depth: 0,
      key: 'create_wargoal',
      value: 'take_state_focus',
      subject: 'SOV',
    })
    expect(
      formatEffect({ ...line, valueName: 'Conquer (Focus)', subjectName: 'Soviet Union' }),
    ).toBe('Gain Conquer (Focus) wargoal on Soviet Union')
    expect(formatEffect({ ...line, value: 'annex_everything' })).toBe(
      'Gain annex everything wargoal on SOV',
    )
  })
})

describe('events', () => {
  it('collapses both country_event forms to the id, ignoring the delay', () => {
    const lines = collapseEffects(
      flattenEffects(
        parseScript('country_event = { id = A.1 hours = 12 random_hours = 6 } country_event = B.2'),
      ),
    )
    expect(lines).toEqual([
      { depth: 0, key: 'country_event', value: 'A.1' },
      { depth: 0, key: 'country_event', value: 'B.2' },
    ])
    expect(formatEffect({ ...lines[0], eventTitle: 'Hello' })).toBe('Event: Hello')
    expect(formatEffect(lines[0])).toBe('Event: A.1')
  })

  it('finds event titles, including conditional ones', () => {
    const titles = parseEventTitles(
      `namespace = x
       country_event = { id = x.1 title = x.1.t }
       country_event = { id = x.2 title = { text = x.2.t trigger = { always = yes } } }
       country_event = { id = x.3 title = x.3.t }`,
      new Set(['x.1', 'x.2']),
    )
    expect(titles).toEqual({ 'x.1': 'x.1.t', 'x.2': 'x.2.t' })
  })

  it('resolves From, Root and the faction name, falling back to "our faction"', () => {
    const raw = '[From.GetNameDefCap] seeks to join the [Root.GetFactionName]'
    expect(resolveEventText(raw, { from: 'Romania', root: 'Germany', rootFaction: 'Axis' })).toBe(
      'Romania seeks to join the Axis',
    )
    expect(resolveEventText(raw, { from: 'Romania', root: 'Germany' })).toBe(
      'Romania seeks to join our faction',
    )
  })

  it('reads faction template names', () => {
    expect(
      parseFactionTemplates('t = { name = Axis icon = X } u = { name = Y }', new Set(['t'])),
    ).toEqual({ t: 'Axis' })
  })
})

describe('opinion modifiers', () => {
  it('collapses add_opinion_modifier and reads definitions', () => {
    const effects = collapseEffects(
      flattenEffects(
        parseScript('add_opinion_modifier = { target = SOV modifier = X } SOV = { y = 1 }'),
      ),
    )
    expect(effects[0]).toEqual({
      depth: 0,
      key: 'add_opinion_modifier',
      value: 'X',
      subject: 'SOV',
    })
    const defs = parseOpinionModifiers(
      'opinion_modifiers = { X = { value = 40 years = 2 } Y = { value = -5 } }',
      new Set(['X', 'Y']),
    )
    expect(defs).toEqual({ X: { value: 40, months: 24 }, Y: { value: -5, months: undefined } })
  })

  it('formats and colours opinion lines', () => {
    const line = {
      depth: 0,
      key: 'add_opinion_modifier',
      value: 'X',
      valueName: 'Deal',
      subject: 'SOV',
      subjectName: 'Russia',
      opinion: { value: 40, months: 24 },
    }
    expect(formatEffect(line)).toBe('Opinion of Russia: +40 (Deal, 24 months)')
    expect(formatEffect({ ...line, opinion: { value: -5 } })).toBe('Opinion of Russia: -5 (Deal)')
    expect(effectTone({ ...line, opinion: { value: -5 } })).toBe('bad')
    expect(formatEffect({ ...line, subject: 'ROOT', subjectName: undefined })).toContain('of us')
    expect(effectTone(line)).toBe('good')
  })
})
