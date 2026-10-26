export type Fortune = {
  tag: string; zhTag: string; main: string; sub: string
  level: { en: string; zh: string }
  color: { en: string; zh: string; hex: string }
  tip: string; midday: string; evening: string
}
export const FORTUNES: Fortune[]
export function fortuneForDigit(digit: number): Fortune
