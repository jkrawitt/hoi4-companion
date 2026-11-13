/**
 * Minimal parser for Paradox script (the `key = value` / `key = { ... }` format used by HoI4
 * game files). It keeps duplicate keys and order, since e.g. a focus may have several
 * `prerequisite` blocks.
 */
export interface ScriptEntry {
  /** null for bare values inside a block, e.g. `{ a b c }`. */
  key: string | null
  operator: string
  value: string | ScriptBlock
}
export type ScriptBlock = ScriptEntry[]

type Token = { type: 'open' | 'close' | 'operator' | 'word'; text: string }

const OPERATORS = ['<=', '>=', '!=', '=', '<', '>']
const isSpace = (c: string) => c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '﻿'

const tokenize = (text: string): Token[] => {
  const tokens: Token[] = []
  let i = 0
  while (i < text.length) {
    const c = text[i]
    if (isSpace(c)) {
      i++
    } else if (c === '#') {
      while (i < text.length && text[i] !== '\n') i++
    } else if (c === '{') {
      tokens.push({ type: 'open', text: c })
      i++
    } else if (c === '}') {
      tokens.push({ type: 'close', text: c })
      i++
    } else if (c === '"') {
      let j = i + 1
      while (j < text.length && text[j] !== '"') j++
      tokens.push({ type: 'word', text: text.slice(i + 1, j) })
      i = j + 1
    } else {
      const op = OPERATORS.find((o) => text.startsWith(o, i))
      if (op) {
        tokens.push({ type: 'operator', text: op })
        i += op.length
      } else {
        let j = i
        while (j < text.length && !isSpace(text[j]) && !'{}#"=<>'.includes(text[j])) j++
        // Guard against a stray character that no rule above consumes.
        if (j === i) j++
        tokens.push({ type: 'word', text: text.slice(i, j) })
        i = j
      }
    }
  }
  return tokens
}

export const parseScript = (text: string): ScriptBlock => {
  const tokens = tokenize(text)
  let pos = 0

  const parseBlock = (topLevel: boolean): ScriptBlock => {
    const entries: ScriptBlock = []
    while (pos < tokens.length) {
      const token = tokens[pos]
      if (token.type === 'close') {
        pos++
        if (topLevel) continue // tolerate stray braces at the top level
        return entries
      }
      pos++
      if (token.type === 'open') {
        entries.push({ key: null, operator: '', value: parseBlock(false) })
      } else if (token.type === 'word' && tokens[pos]?.type === 'operator') {
        const operator = tokens[pos++].text
        const next = tokens[pos]
        if (next?.type === 'open') {
          pos++
          entries.push({ key: token.text, operator, value: parseBlock(false) })
        } else if (next?.type === 'word') {
          pos++
          entries.push({ key: token.text, operator, value: next.text })
        }
      } else if (token.type === 'word') {
        entries.push({ key: null, operator: '', value: token.text })
      }
    }
    return entries
  }

  return parseBlock(true)
}

/** All entries with the given key. */
export const getAll = (block: ScriptBlock, key: string): ScriptEntry[] =>
  block.filter((e) => e.key === key)

export const getBlock = (block: ScriptBlock, key: string): ScriptBlock | undefined => {
  const v = getAll(block, key)[0]?.value
  return typeof v === 'object' ? v : undefined
}

export const getString = (block: ScriptBlock, key: string): string | undefined => {
  const v = getAll(block, key)[0]?.value
  return typeof v === 'string' ? v : undefined
}

/** Values of every `key = value` entry inside a block, e.g. all `focus = X` in a prerequisite. */
export const getStrings = (block: ScriptBlock, key: string): string[] =>
  getAll(block, key).flatMap((e) => (typeof e.value === 'string' ? [e.value] : []))

/**
 * Finds the blocks whose key is one of `wanted`, at any depth (not looking inside a match). The
 * first definition of an id wins. Used for files like ideas and opinion modifiers, where
 * definitions sit under category blocks whose layout we do not want to depend on.
 */
export const findBlocks = (text: string, wanted: Set<string>): Record<string, ScriptBlock> => {
  const found: Record<string, ScriptBlock> = {}
  const visit = (block: ScriptBlock) => {
    for (const entry of block) {
      if (typeof entry.value !== 'object') continue
      if (entry.key !== null && wanted.has(entry.key)) found[entry.key] ??= entry.value
      else visit(entry.value)
    }
  }
  visit(parseScript(text))
  return found
}
