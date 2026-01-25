import { useCallback, useEffect, useMemo, useState } from 'react'
import en from './en.json'
import es from './es.json'
import { DEFAULT_LOCALE, TranslationContext } from './TranslationContext.js'

const TRANSLATIONS = { en, es }
const STORAGE_KEY = 'massapp.locale'

function normalizeLocale(value) {
  if (!value) {
    return DEFAULT_LOCALE
  }
  const language = value.toLowerCase().split('-')[0]
  return Object.prototype.hasOwnProperty.call(TRANSLATIONS, language) ? language : DEFAULT_LOCALE
}

function getInitialLocale() {
  if (typeof window === 'undefined') {
    return DEFAULT_LOCALE
  }
  const stored = window.localStorage.getItem(STORAGE_KEY)
  if (stored) {
    return normalizeLocale(stored)
  }
  const navigatorLanguages = window.navigator.languages || [window.navigator.language]
  for (const language of navigatorLanguages) {
    const normalized = normalizeLocale(language)
    if (normalized) {
      return normalized
    }
  }
  return DEFAULT_LOCALE
}

export function TranslationProvider({ children }) {
  const [locale, setLocaleState] = useState(getInitialLocale)
  const dictionary = TRANSLATIONS[locale] || TRANSLATIONS[DEFAULT_LOCALE]
  const fallbackDictionary = TRANSLATIONS[DEFAULT_LOCALE]

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }
    window.localStorage.setItem(STORAGE_KEY, locale)
  }, [locale])

  const translate = useCallback(
    (key, variables = {}) => {
      const template = dictionary[key] ?? fallbackDictionary[key] ?? key
      return template.replace(/\{(\w+)\}/g, (match, name) => {
        if (Object.prototype.hasOwnProperty.call(variables, name)) {
          return String(variables[name])
        }
        return match
      })
    },
    [dictionary, fallbackDictionary],
  )

  const updateLocale = useCallback((nextLocale) => {
    setLocaleState(normalizeLocale(nextLocale))
  }, [])

  const value = useMemo(
    () => ({
      locale,
      setLocale: updateLocale,
      t: translate,
    }),
    [locale, translate, updateLocale],
  )

  return <TranslationContext.Provider value={value}>{children}</TranslationContext.Provider>
}
