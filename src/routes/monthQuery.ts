import type { YearMonth } from '../types'

export function isYearMonth(value: string | null): value is YearMonth {
  return value !== null && /^\d{4}-(0[1-9]|1[0-2])$/.test(value)
}

export function currentLocalYearMonth(date = new Date()): YearMonth {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}
