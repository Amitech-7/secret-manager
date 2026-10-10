import { CryptoError } from './errors'

/**
 * Random password generator. Randomness comes from the browser's CSPRNG, and every pick uses
 * rejection sampling so no character is even slightly more likely than another (a plain
 * `random % n` favours the first few characters).
 */

export interface GeneratorOptions {
  length: number
  lower: boolean
  upper: boolean
  digits: boolean
  symbols: boolean
  /** Leave out characters that are easy to confuse when read or typed: 0 O o 1 l I | */
  avoidAmbiguous: boolean
}

export const GENERATOR_LIMITS = { minLength: 8, maxLength: 64 } as const

export const DEFAULT_GENERATOR: GeneratorOptions = {
  length: 20,
  lower: true,
  upper: true,
  digits: true,
  symbols: true,
  avoidAmbiguous: true,
}

const LOWER = 'abcdefghijklmnopqrstuvwxyz'
const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const DIGITS = '0123456789'
// No quotes, backslash, space or brackets: these break more login forms than they protect.
const SYMBOLS = '!#$%&*+-=?@^_'
const AMBIGUOUS = new Set('0Oo1lI|')

export type RandomBytes = (length: number) => Uint8Array

const browserRandom: RandomBytes = (length) => crypto.getRandomValues(new Uint8Array(length))

/** An unbiased integer in [0, max). */
export function randomInt(max: number, random: RandomBytes = browserRandom): number {
  if (!Number.isInteger(max) || max < 1 || max > 2 ** 32) {
    throw new CryptoError('INVALID_PARAMS', 'Range out of bounds')
  }
  const space = 2 ** 32
  const limit = space - (space % max) // values at or above this would skew the result
  for (;;) {
    const b = random(4)
    const value = ((b[0]! << 24) | (b[1]! << 16) | (b[2]! << 8) | b[3]!) >>> 0
    if (value < limit) return value % max
  }
}

function classes(options: GeneratorOptions): string[] {
  const keep = (s: string) =>
    options.avoidAmbiguous ? [...s].filter((c) => !AMBIGUOUS.has(c)).join('') : s
  const out: string[] = []
  if (options.lower) out.push(keep(LOWER))
  if (options.upper) out.push(keep(UPPER))
  if (options.digits) out.push(keep(DIGITS))
  if (options.symbols) out.push(keep(SYMBOLS))
  return out
}

function checked(options: GeneratorOptions): string[] {
  const sets = classes(options)
  if (sets.length === 0)
    throw new CryptoError('INVALID_PARAMS', 'Choose at least one kind of character')
  if (
    !Number.isInteger(options.length) ||
    options.length < Math.max(GENERATOR_LIMITS.minLength, sets.length) ||
    options.length > GENERATOR_LIMITS.maxLength
  ) {
    throw new CryptoError('INVALID_PARAMS', 'Password length is out of range')
  }
  return sets
}

/** Size of the character pool the password is drawn from. */
export function poolSize(options: GeneratorOptions): number {
  return classes(options).reduce((n, s) => n + s.length, 0)
}

/** A conservative strength figure in bits: length x log2(pool), ignoring the one-of-each rule. */
export function estimateBits(options: GeneratorOptions): number {
  checked(options)
  return Math.floor(options.length * Math.log2(poolSize(options)))
}

/**
 * Generates a password with at least one character from every chosen kind, in a random order.
 * Throws INVALID_PARAMS for an empty selection or a length outside 8..64.
 */
export function generatePassword(
  options: GeneratorOptions = DEFAULT_GENERATOR,
  random: RandomBytes = browserRandom,
): string {
  const sets = checked(options)
  const pool = sets.join('')
  const pick = (from: string) => from[randomInt(from.length, random)]!

  const chars = sets.map(pick) // one guaranteed from each chosen kind
  while (chars.length < options.length) chars.push(pick(pool))

  // Fisher-Yates, so the guaranteed characters do not sit at the front.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1, random)
    ;[chars[i], chars[j]] = [chars[j]!, chars[i]!]
  }
  return chars.join('')
}
