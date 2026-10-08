/** Small colour toolkit: WCAG contrast plus HSL adjustment. No dependencies. */

export interface Rgb {
  r: number
  g: number
  b: number
}

/** Accepts #rgb or #rrggbb (any case). Returns lowercase #rrggbb, or null if it is not a colour. */
export function normalizeHex(input: string): string | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(input.trim())
  if (!m) return null
  const raw = m[1]!.toLowerCase()
  const full = raw.length === 3 ? [...raw].map((c) => c + c).join('') : raw
  return `#${full}`
}

export function hexToRgb(hex: string): Rgb {
  const n = normalizeHex(hex)
  if (!n) throw new Error(`Not a colour: ${hex}`)
  return {
    r: parseInt(n.slice(1, 3), 16),
    g: parseInt(n.slice(3, 5), 16),
    b: parseInt(n.slice(5, 7), 16),
  }
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const c = (v: number) =>
    Math.round(Math.min(255, Math.max(0, v)))
      .toString(16)
      .padStart(2, '0')
  return `#${c(r)}${c(g)}${c(b)}`
}

export function luminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex)
  const lin = (v: number) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

/** WCAG 2 contrast ratio, from 1 to 21. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

export function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const { r, g, b } = hexToRgb(hex)
  const [rr, gg, bb] = [r / 255, g / 255, b / 255]
  const max = Math.max(rr, gg, bb)
  const min = Math.min(rr, gg, bb)
  const l = (max + min) / 2
  const d = max - min
  if (d === 0) return { h: 0, s: 0, l: l * 100 }
  const s = d / (1 - Math.abs(2 * l - 1))
  const h =
    max === rr
      ? (gg - bb) / d + (gg < bb ? 6 : 0)
      : max === gg
        ? (bb - rr) / d + 2
        : (rr - gg) / d + 4
  return { h: h * 60, s: s * 100, l: l * 100 }
}

export function hslToHex(h: number, s: number, l: number): string {
  const [ss, ll] = [s / 100, l / 100]
  const k = (n: number) => (n + h / 30) % 12
  const a = ss * Math.min(ll, 1 - ll)
  const f = (n: number) => ll - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return rgbToHex({ r: f(0) * 255, g: f(8) * 255, b: f(4) * 255 })
}

/** Linear blend: t=0 gives a, t=1 gives b. */
export function mix(a: string, b: string, t: number): string {
  const [x, y] = [hexToRgb(a), hexToRgb(b)]
  return rgbToHex({ r: x.r + (y.r - x.r) * t, g: x.g + (y.g - x.g) * t, b: x.b + (y.b - x.b) * t })
}

const MIN_TEXT_CONTRAST = 4.5

/** Walks lightness in one direction until `ok` passes. Always ends, at worst on black or white. */
function shiftLightness(
  hex: string,
  ok: (candidate: string) => boolean,
  direction: 1 | -1,
): string {
  const { h, s, l } = hexToHsl(hex)
  for (let step = 0; step <= 100; step++) {
    const lightness = l + direction * step
    if (lightness < 0 || lightness > 100) break
    const candidate = hslToHex(h, s, lightness)
    if (ok(candidate)) return candidate
  }
  return direction === 1 ? '#ffffff' : '#000000'
}

/**
 * The text colour for a button of this colour. Black or white always works: whichever contrasts
 * more is at least 4.58:1 for ANY background colour (the worst case, a mid-tone, is sqrt(21)),
 * so the accent itself never needs adjusting for button text.
 */
export function buttonColors(accent: string): { accent: string; onAccent: string } {
  const base = normalizeHex(accent) ?? '#4f46e5'
  return {
    accent: base,
    onAccent: contrast(base, '#ffffff') >= contrast(base, '#000000') ? '#ffffff' : '#000000',
  }
}

/** The accent as text or a focus ring: readable on every given background. */
export function linkColor(accent: string, backgrounds: string[]): string {
  const base = normalizeHex(accent) ?? '#4f46e5'
  const passes = (c: string) => backgrounds.every((bg) => contrast(c, bg) >= MIN_TEXT_CONTRAST)
  if (passes(base)) return base
  const avg = backgrounds.reduce((n, bg) => n + luminance(bg), 0) / backgrounds.length
  // Dark surfaces need a lighter accent, light surfaces a darker one.
  return shiftLightness(base, passes, avg < 0.18 ? 1 : -1)
}
