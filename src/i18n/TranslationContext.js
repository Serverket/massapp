import { createContext } from 'react'

export const DEFAULT_LOCALE = 'en'

export const TranslationContext = createContext({
  locale: DEFAULT_LOCALE,
  setLocale: () => {},
  t: (key) => key,
})
