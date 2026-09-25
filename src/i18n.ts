import i18n, { type TFunction } from 'i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { initReactI18next } from 'react-i18next'
import en from './i18n/en'
import nl from './i18n/nl'

export const resources = {
  en: { translation: en },
  nl: { translation: nl },
} as const

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'en',
    supportedLngs: ['en', 'nl'],
    nonExplicitSupportedLngs: true,
    load: 'languageOnly',
    defaultNS: 'translation',
    keySeparator: false,
    nsSeparator: false,
    interpolation: { escapeValue: false },
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: 'rato.language',
      caches: ['localStorage'],
    },
  })

export function languageCode(language: string | undefined): 'en' | 'nl' {
  return language?.toLowerCase().startsWith('nl') ? 'nl' : 'en'
}

export function intlLocale(language: string | undefined): 'en-US' | 'nl-NL' {
  return languageCode(language) === 'nl' ? 'nl-NL' : 'en-US'
}

type Translate = TFunction<'translation'>

const dynamicErrorPatterns: Array<{
  pattern: RegExp
  key: string
  values: (match: RegExpMatchArray) => Record<string, string>
}> = [
  { pattern: /^Scenario "(.+)" does not exist\.$/, key: 'Scenario "{{name}}" does not exist.', values: ([, name]) => ({ name: name ?? '' }) },
  { pattern: /^Profile "(.+)" does not exist\.$/, key: 'Profile "{{name}}" does not exist.', values: ([, name]) => ({ name: name ?? '' }) },
  { pattern: /^Profile "(.+)" already exists\.$/, key: 'Profile "{{name}}" already exists.', values: ([, name]) => ({ name: name ?? '' }) },
  { pattern: /^Ledger item "(.+)" does not exist\.$/, key: 'Ledger item "{{name}}" does not exist.', values: ([, name]) => ({ name: name ?? '' }) },
  { pattern: /^Category "(.+)" contains an invalid amount\.$/, key: 'Category "{{name}}" contains an invalid amount.', values: ([, name]) => ({ name: name ?? '' }) },
  { pattern: /^Category "(.+)" exceeds the safe integer range\.$/, key: 'Category "{{name}}" exceeds the safe integer range.', values: ([, name]) => ({ name: name ?? '' }) },
  { pattern: /^Participant "(.+)" does not exist\.$/, key: 'Participant "{{name}}" does not exist.', values: ([, name]) => ({ name: name ?? '' }) },
  { pattern: /^Participant "(.+)" does not exist in this scenario\.$/, key: 'Participant "{{id}}" does not exist in this scenario', values: ([, id]) => ({ id: id ?? '' }) },
  { pattern: /^Duplicate item ID "(.+)" in (.+)$/, key: 'Duplicate item ID "{{id}}" in {{path}}', values: ([, id, path]) => ({ id: id ?? '', path: path ?? '' }) },
  { pattern: /^Saved data version (.+) is not supported by this app\.$/, key: 'Saved data version {{version}} is not supported by this app.', values: ([, version]) => ({ version: version ?? '' }) },
  { pattern: /^Unsupported backup schema version "(.+)"\.$/, key: 'Unsupported backup schema version "{{version}}".', values: ([, version]) => ({ version: version ?? '' }) },
]

const translatedErrorKeys = new Set<string>(Object.keys(en))

export function translateMessage(message: string, t: Translate): string {
  if (translatedErrorKeys.has(message)) return t(message)
  for (const { pattern, key, values } of dynamicErrorPatterns) {
    const match = message.match(pattern)
    if (match) return t(key, values(match))
  }

  const issueSeparator = message.indexOf(': ')
  if (issueSeparator >= 0) {
    const detail = message.slice(issueSeparator + 2)
    const translatedDetail = translateMessage(detail, t)
    if (translatedDetail !== t('Rato could not complete that action.')) {
      return `${message.slice(0, issueSeparator + 1)} ${translatedDetail}`
    }
    if (/does not match the Rato data format|Invalid input|invalid/i.test(detail)) return t('The backup does not match the Rato data format.')
  }

  return t('Rato could not complete that action.')
}

export default i18n
