export const SUPPORTED_CURRENCIES = [
  { code: 'EUR', label: 'Euro' },
  { code: 'USD', label: 'US dollar' },
  { code: 'GBP', label: 'Pound sterling' },
  { code: 'CHF', label: 'Swiss franc' },
  { code: 'CAD', label: 'Canadian dollar' },
  { code: 'AUD', label: 'Australian dollar' },
  { code: 'NZD', label: 'New Zealand dollar' },
] as const

export const SUPPORTED_CURRENCY_CODES = SUPPORTED_CURRENCIES.map(({ code }) => code) as [
  string,
  ...string[],
]
