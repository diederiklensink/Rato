import { describe, expect, it } from 'vitest'
import { intlLocale, languageCode, resources } from './i18n'

describe('localization configuration', () => {
  it('uses English for unsupported languages and maps supported languages to regional formats', () => {
    expect(languageCode('fr-FR')).toBe('en')
    expect(intlLocale('en')).toBe('en-US')
    expect(intlLocale('nl-NL')).toBe('nl-NL')
  })

  it('provides matching keys for English and Dutch', () => {
    expect(Object.keys(resources.nl.translation).sort())
      .toEqual(Object.keys(resources.en.translation).sort())
  })
})
