import { parseScript, type ScriptBlock } from './paradoxScript'

/** The scripted effects of `common/scripted_effects`, by name: `FIN_bop_low_effect = { ... }`. */
export type ScriptedEffects = Record<string, ScriptBlock>

/** Every top-level block of a `common/scripted_effects` file. */
export const parseScriptedEffects = (text: string): ScriptedEffects =>
  Object.fromEntries(
    parseScript(text).flatMap((e) =>
      e.key !== null && typeof e.value !== 'string' ? [[e.key, e.value]] : [],
    ),
  )

/** `$NAME$` in a scripted effect's body, replaced by the arguments of the call. */
const substitute = (text: string, args: Record<string, string>): string =>
  text.replace(/\$([A-Za-z0-9_]+)\$/g, (whole, name: string) => args[name] ?? whole)

const withArguments = (block: ScriptBlock, args: Record<string, string>): ScriptBlock =>
  block.map((e) => ({
    key: e.key === null ? null : substitute(e.key, args),
    operator: e.operator,
    value: typeof e.value === 'string' ? substitute(e.value, args) : withArguments(e.value, args),
  }))

const MAX_DEPTH = 8

/**
 * `block` with each scripted effect written out where it is called, so what it does shows up
 * like any other effect: `FIN_x_effect = yes` or `FIN_x_effect = { ARG = 3 }` becomes the lines
 * of its body (with `$ARG$` filled in). Calls nest, up to a depth that stops a loop.
 */
export const expandEffects = (
  block: ScriptBlock,
  effects: ScriptedEffects,
  depth = 0,
): ScriptBlock =>
  block.flatMap((e): ScriptBlock => {
    const body = e.key !== null && depth < MAX_DEPTH ? effects[e.key] : undefined
    if (body && (e.value === 'yes' || typeof e.value === 'object')) {
      const args =
        typeof e.value === 'object'
          ? Object.fromEntries(
              e.value.flatMap((a) =>
                a.key !== null && typeof a.value === 'string' ? [[a.key, a.value]] : [],
              ),
            )
          : {}
      return expandEffects(withArguments(body, args), effects, depth + 1)
    }
    if (typeof e.value === 'string') return [e]
    return [{ ...e, value: expandEffects(e.value, effects, depth) }]
  })
