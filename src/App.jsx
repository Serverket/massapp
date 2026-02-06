import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from './i18n/useTranslation.js'
import {
  fetchTemplates,
  recordContactSends,
  recordSendMetrics,
  fetchFlaggedContacts,
  setContactFlag,
} from './lib/storage.js'
import { isSupabaseReady, supabase } from './lib/supabaseClient.js'
import { useSupabaseHealth } from './lib/useSupabaseHealth.js'
import { useSupabaseAuth } from './lib/useSupabaseAuth.js'
import { ContactsImport } from './components/ContactsImport.jsx'
import { ContactsPanel } from './components/ContactsPanel.jsx'
import { TemplatePicker } from './components/TemplatePicker.jsx'
import { LoginForm } from './components/LoginForm.jsx'
import { TemplateManagerModal } from './components/TemplateManagerModal.jsx'
import { ContactsModal } from './components/ContactsModal.jsx'
import { canSuggestPersonalization, suggestTemplatePersonalization } from './lib/templatePersonalizer.js'
import { MODAL_CLOSE_ICON_BUTTON, MODAL_CLOSE_PRIMARY_BUTTON, MODAL_CONTENT_BASE, MODAL_OVERLAY } from './lib/uiStyles.js'

const LIMIT_LOG = 120

const CARD_BASE =
  'flex flex-col rounded-2xl border border-slate-700/40 bg-slate-900/70 p-6 shadow-lg shadow-slate-950/50 backdrop-blur'

const BUTTON_PRIMARY =
  'inline-flex h-11 w-full items-center justify-center rounded-xl bg-gradient-to-r from-blue-600 to-blue-500 px-5 text-sm font-semibold text-slate-100 shadow-lg shadow-blue-900/40 transition hover:from-blue-500 hover:to-blue-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto'

const BUTTON_GHOST =
  'inline-flex h-10 w-full items-center justify-center rounded-xl border border-slate-600/60 bg-slate-900/60 px-4 text-sm font-semibold text-slate-200 transition hover:border-slate-400/60 hover:bg-slate-800/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-400'

const BUTTON_SECONDARY =
  'inline-flex h-10 w-full items-center justify-center rounded-xl border border-blue-400/40 bg-blue-500/10 px-4 text-sm font-semibold text-blue-200 transition hover:border-blue-300/70 hover:bg-blue-500/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400 sm:w-auto'

const BUTTON_DANGER =
  'inline-flex h-9 items-center justify-center rounded-lg border border-rose-500/60 px-3 text-xs font-semibold uppercase tracking-wide text-rose-200 transition hover:border-rose-400/70 hover:bg-rose-500/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-400 sm:text-sm disabled:cursor-not-allowed disabled:opacity-60'

const STATUS_PILL =
  'rounded-full border border-slate-700/60 bg-slate-900/60 px-3 py-1 text-[0.65rem] font-semibold uppercase tracking-wide text-slate-300 sm:text-xs'

const LANGUAGE_BUTTON =
  'inline-flex h-9 items-center justify-center rounded-lg border border-slate-600/60 bg-slate-900/60 px-2.5 text-xs font-semibold uppercase tracking-wide text-slate-200 transition hover:border-slate-400/60 hover:bg-slate-800/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-400 sm:px-4 sm:text-sm'

const LOG_LEVEL_STYLES = {
  info: 'border-l-sky-400/70',
  success: 'border-l-emerald-400/70',
  warning: 'border-l-amber-400/70',
  error: 'border-l-rose-500/80',
}

const LINK_MODES = {
  web: {
    baseUrl: 'https://web.whatsapp.com/send',
    labelKey: 'mode.web.label',
    shortLabelKey: 'mode.web.shortLabel',
    descriptionKey: 'mode.web.description',
    helperKey: 'mode.web.helper',
  },
  api: {
    baseUrl: 'https://api.whatsapp.com/send',
    labelKey: 'mode.api.label',
    shortLabelKey: 'mode.api.shortLabel',
    descriptionKey: 'mode.api.description',
    helperKey: 'mode.api.helper',
  },
}

const MODE_SEQUENCE = ['web', 'api']

const SUPABASE_INDICATOR_STYLES = {
  online: {
    dot: 'bg-emerald-400',
    ping: 'bg-emerald-400',
  },
  degraded: {
    dot: 'bg-amber-400',
    ping: 'bg-amber-400',
  },
  checking: {
    dot: 'bg-sky-400',
    ping: 'bg-sky-400',
  },
  offline: {
    dot: 'bg-slate-500',
    ping: 'bg-slate-600',
  },
}

const TEMPLATE_CACHE_KEY = 'massapp:templates-cache'
const TEMPLATE_CACHE_MAX_AGE_MS = 5 * 60 * 1000

function readTemplateCache() {
  if (typeof window === 'undefined' || !window?.localStorage) {
    return null
  }
  try {
    const raw = window.localStorage.getItem(TEMPLATE_CACHE_KEY)
    if (!raw) {
      return null
    }
    const payload = JSON.parse(raw)
    if (!Array.isArray(payload.items) || typeof payload.timestamp !== 'number') {
      return null
    }
    const age = Date.now() - payload.timestamp
    return {
      items: payload.items,
      timestamp: payload.timestamp,
      fresh: age <= TEMPLATE_CACHE_MAX_AGE_MS,
    }
  } catch (error) {
    console.warn('Failed to read template cache', error)
    return null
  }
}

function writeTemplateCache(items) {
  if (typeof window === 'undefined' || !window?.localStorage) {
    return
  }
  try {
    const payload = {
      items,
      timestamp: Date.now(),
    }
    window.localStorage.setItem(TEMPLATE_CACHE_KEY, JSON.stringify(payload))
  } catch (error) {
    console.warn('Failed to write template cache', error)
  }
}

function formatTime(iso) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).format(new Date(iso))
  } catch {
    return iso
  }
}

function parseRecipients(input) {
  return input
    .split(/[\n,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      if (entry.endsWith('@s.whatsapp.net')) {
        return entry
      }
      const digits = entry.replace(/[^0-9+]/g, '')
      if (!digits) {
        return null
      }
      return `${digits}@s.whatsapp.net`
    })
    .filter(Boolean)
}

const makeLogEntry = (level, message) => ({
  id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
  level,
  message,
  timestamp: new Date().toISOString(),
})

function jidToDigits(jid) {
  return jid.replace('@s.whatsapp.net', '').replace(/\D/g, '')
}

function formatPhone(phone) {
  return `+${phone}`
}

function normalizePhoneDigits(value) {
  if (!value) {
    return null
  }
  const digits = value.toString().replace(/\D/g, '')
  return digits.length >= 6 ? digits : null
}

function detectMessageLanguage(message, fallbackLocale = 'en') {
  if (!message || typeof message !== 'string') {
    return fallbackLocale ?? 'en'
  }

  const sample = message.trim().slice(0, 360).toLowerCase()

  if (!sample) {
    return fallbackLocale ?? 'en'
  }

  const spanishIndicators = /[áéíóúñü¡¿]|\b(hola|buenos días|buenas tardes|gracias|equipo|cliente|cotización|favor|adjunto|seguimiento|estimad[ao]|disculpa|por favor|mensaje)\b/
  if (spanishIndicators.test(sample)) {
    return 'es'
  }

  const englishIndicators = /\b(hello|thanks|thank you|team|follow up|please|update|message|kind regards|dear)\b/
  if (englishIndicators.test(sample)) {
    return 'en'
  }

  return fallbackLocale ?? 'en'
}

const PLACEHOLDER_NAME_KEYWORDS = [
  'client',
  'cliente',
  'contact',
  'contacto',
  'unknown',
  'desconocido',
  'desconocida',
  'placeholder',
  'test',
  'prueba',
  'demo',
  'sample',
  'usuario',
  'user',
  'nombre',
  'name',
  'company',
  'compania',
  'compañia',
  'empresa',
  'team',
  'equipo',
  'realtor',
  'agent',
  'agente',
  'asesor',
  'asesora',
  'asesoria',
  'broker',
  'buyer',
  'seller',
  'tenant',
  'landlord',
  'propietario',
  'propietaria',
  'arrendador',
  'arrendadora',
  'arrendatario',
  'arrendataria',
  'comprador',
  'compradora',
  'vendedor',
  'vendedora',
  'prospect',
  'prospecto',
  'vip',
  'sr',
  'sr.',
  'sra',
  'sra.',
  'srta',
  'srta.',
  'don',
  'doña',
  'dr',
  'dr.',
  'dra',
  'dra.',
  'mr',
  'mr.',
  'mrs',
  'mrs.',
  'ms',
  'ms.',
  'ing',
  'ing.',
  'lic',
  'lic.',
  'arq',
  'arq.',
  'prof',
  'prof.',
  'coach',
  'mentor',
]

const PLACEHOLDER_NAME_PHRASES = [
  'sin nombre',
  'no name',
  'without name',
  'no tiene nombre',
  'sin info',
  'sin información',
  'no especificado',
  'not provided',
]

const NAME_SEQUENCE_REGEX = /[A-Za-zÁÉÍÓÚÑÜ][A-Za-zÁÉÍÓÚÑÜ'`´’-]{1,}(?:\s+[A-Za-zÁÉÍÓÚÑÜ][A-Za-zÁÉÍÓÚÑÜ'`´’-]{1,})*/g
const NAME_TOKEN_STRIP_PATTERN = /[.'`´’_-]/g

function normalizeNameToken(token) {
  if (!token) {
    return ''
  }
  return token
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(NAME_TOKEN_STRIP_PATTERN, '')
}

function normalizeNamePhrase(value) {
  return value
    .split(/\s+/)
    .map((part) => normalizeNameToken(part))
    .filter(Boolean)
    .join(' ')
}

const PLACEHOLDER_NAME_LOOKUP = new Set(PLACEHOLDER_NAME_KEYWORDS.map((keyword) => normalizeNameToken(keyword)))
const PLACEHOLDER_NAME_PHRASES_NORMALIZED = PLACEHOLDER_NAME_PHRASES.map((phrase) => normalizeNamePhrase(phrase))

function cleanupNameTokens(tokens) {
  if (!Array.isArray(tokens) || tokens.length === 0) {
    return []
  }

  const cleaned = tokens.filter((token) => {
    const normalized = normalizeNameToken(token)
    if (!normalized) {
      return false
    }
    if (/^\d+$/.test(normalized)) {
      return false
    }
    return !PLACEHOLDER_NAME_LOOKUP.has(normalized)
  })

  if (cleaned.length > 0) {
    return cleaned
  }

  const letterTokens = tokens.filter((token) => /[A-Za-zÁÉÍÓÚÑÜáéíóúñü]/.test(token))
  if (letterTokens.length > 0) {
    return letterTokens
  }

  return tokens.filter(Boolean)
}

function buildNamePartsFromTokens(tokens) {
  const sequence = tokens.filter(Boolean)
  if (sequence.length === 0) {
    return {
      fullName: null,
      firstName: null,
      lastName: null,
    }
  }

  const fullName = sequence.join(' ')
  return {
    fullName,
    firstName: sequence[0] ?? null,
    lastName: sequence.length > 1 ? sequence.slice(1).join(' ') : null,
  }
}

function deriveContactNameParts(rawName, fallbackName) {
  const trimmed = typeof rawName === 'string' ? rawName.trim() : ''
  const candidate = extractPersonalName(trimmed)
  const baseSource = candidate || trimmed
  let baseTokens = baseSource.split(/\s+/).filter(Boolean)
  baseTokens = cleanupNameTokens(baseTokens)

  if (baseTokens.length === 0 && trimmed && trimmed !== baseSource) {
    baseTokens = cleanupNameTokens(trimmed.split(/\s+/).filter(Boolean))
  }

  if (baseTokens.length === 0 && trimmed) {
    const segments = trimmed
      .split(/\s*[-–—/|,;:]+\s*/)
      .map((segment) => segment.trim())
      .filter(Boolean)

    for (let index = segments.length - 1; index >= 0; index -= 1) {
      const segmentTokens = cleanupNameTokens(segments[index].split(/\s+/).filter(Boolean))
      if (segmentTokens.length > 0) {
        return buildNamePartsFromTokens(segmentTokens)
      }
    }
  }

  if (baseTokens.length > 0) {
    return buildNamePartsFromTokens(baseTokens)
  }

  if (fallbackName) {
    const fallbackTokens = fallbackName.split(/\s+/).filter(Boolean)
    if (fallbackTokens.length > 0) {
      return buildNamePartsFromTokens(fallbackTokens)
    }
    return buildNamePartsFromTokens([fallbackName])
  }

  return {
    fullName: null,
    firstName: null,
    lastName: null,
  }
}

function extractPersonalName(rawName) {
  if (!rawName || typeof rawName !== 'string') {
    return null
  }

  let bestCandidate = null
  let bestScore = -Infinity
  let bestNonPlaceholderCount = -1
  let bestWordCount = -1
  let bestCapitalizedCount = -1
  let bestLength = -1
  let bestIndex = -1

  for (const match of rawName.matchAll(NAME_SEQUENCE_REGEX)) {
    const candidate = match[0]?.trim()
    if (!candidate || candidate.length < 2) {
      continue
    }

    const tokens = candidate.split(/\s+/).filter(Boolean)
    if (tokens.length === 0) {
      continue
    }

    const normalizedTokens = tokens.map((token) => normalizeNameToken(token))
    const nonPlaceholderTokens = normalizedTokens.filter((token) => token && !PLACEHOLDER_NAME_LOOKUP.has(token))

    if (nonPlaceholderTokens.length === 0) {
      continue
    }

    const normalizedPhrase = normalizedTokens.filter(Boolean).join(' ')
    if (PLACEHOLDER_NAME_PHRASES_NORMALIZED.some((placeholder) => normalizedPhrase.includes(placeholder))) {
      continue
    }

    const hasDigit = /\d/.test(candidate)
    const wordCount = tokens.length
    const capitalizedCount = tokens.filter((token) => /^[A-ZÁÉÍÓÚÑÜ][a-záéíóúñü'`´’-]+$/.test(token)).length
    const allUppercase = tokens.every((token) => token.length > 1 && token === token.toUpperCase())
    const referenceTokens = nonPlaceholderTokens.length > 0 ? nonPlaceholderTokens : normalizedTokens.filter(Boolean)
    const uniqueTokenCount = new Set(referenceTokens).size

    let score = wordCount * 2
    score += nonPlaceholderTokens.length
    if (!hasDigit) {
      score += 1
    }
    if (capitalizedCount > 0) {
      score += capitalizedCount
    }
    if (!allUppercase) {
      score += 0.5
    }
    score += uniqueTokenCount * 0.25

    const candidateLength = candidate.length
    const candidateIndex = typeof match.index === 'number' ? match.index : rawName.indexOf(candidate)

    const isBetter =
      score > bestScore ||
      (score === bestScore &&
        (nonPlaceholderTokens.length > bestNonPlaceholderCount ||
          (nonPlaceholderTokens.length === bestNonPlaceholderCount && wordCount > bestWordCount) ||
          (nonPlaceholderTokens.length === bestNonPlaceholderCount &&
            wordCount === bestWordCount &&
            capitalizedCount > bestCapitalizedCount) ||
          (nonPlaceholderTokens.length === bestNonPlaceholderCount &&
            wordCount === bestWordCount &&
            capitalizedCount === bestCapitalizedCount &&
            candidateLength > bestLength) ||
          (nonPlaceholderTokens.length === bestNonPlaceholderCount &&
            wordCount === bestWordCount &&
            capitalizedCount === bestCapitalizedCount &&
            candidateLength === bestLength &&
            candidateIndex > bestIndex)))

    if (isBetter) {
      bestScore = score
      bestCandidate = candidate.replace(/\s+/g, ' ')
      bestNonPlaceholderCount = nonPlaceholderTokens.length
      bestWordCount = wordCount
      bestCapitalizedCount = capitalizedCount
      bestLength = candidateLength
      bestIndex = candidateIndex
    }
  }

  return bestCandidate ?? null
}

function resolveFallbackContactName(languageHint, locale = 'en') {
  const hint = (languageHint ?? locale ?? 'en').toLowerCase()
  if (hint.startsWith('es')) {
    return 'Colega'
  }
  return 'Partner'
}

function truncateLogMessage(message, limit = 96) {
  if (!message) {
    return ''
  }
  const normalized = message.replace(/\s+/g, ' ').trim()
  if (normalized.length <= limit) {
    return normalized
  }
  return `${normalized.slice(0, Math.max(0, limit - 1))}…`
}

function buildWhatsAppUrl(phone, message, mode) {
  const config = LINK_MODES[mode] ?? LINK_MODES.web
  const params = new URLSearchParams()
  params.set('phone', phone)
  if (message) {
    params.set('text', message)
  }
  if (config.baseUrl.includes('web.whatsapp.com')) {
    params.set('type', 'phone_number')
    params.set('app_absent', '0')
  }
  return `${config.baseUrl}?${params.toString()}`
}

function App() {
  const [recipientInput, setRecipientInput] = useState('')
  const [messageBody, setMessageBody] = useState('')
  const [statusLog, setStatusLog] = useState([])
  const [linkMode, setLinkMode] = useState('web')
  const [templates, setTemplates] = useState([])
  const [templatesLoading, setTemplatesLoading] = useState(false)
  const [templatesError, setTemplatesError] = useState(null)
  const [selectedTemplateId, setSelectedTemplateId] = useState(null)
  const [lastLaunchReport, setLastLaunchReport] = useState(null)
  const [contactIdMap, setContactIdMap] = useState({})
  const { session, loading: authLoading } = useSupabaseAuth()
  const [signOutLoading, setSignOutLoading] = useState(false)
  const supabaseHealth = useSupabaseHealth()
  const { locale, setLocale, t } = useTranslation()
  const [contactTotal, setContactTotal] = useState(null)
  const [contactsRefreshToken, setContactsRefreshToken] = useState(0)
  const [contactsModalOpen, setContactsModalOpen] = useState(false)
  const [templateManagerOpen, setTemplateManagerOpen] = useState(false)
  const [flaggedPhones, setFlaggedPhones] = useState([])
  const [aiSuggestion, setAiSuggestion] = useState(null)
  const [aiSuggestionLoading, setAiSuggestionLoading] = useState(false)
  const [aiSuggestionError, setAiSuggestionError] = useState(null)
  const [aiSuggestionVisible, setAiSuggestionVisible] = useState(false)
  const [aiContactPreview, setAiContactPreview] = useState(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [importModalOpen, setImportModalOpen] = useState(false)
  const [logModalOpen, setLogModalOpen] = useState(false)
  const aiSuggestionAnchorRef = useRef(null)
  const menuContainerRef = useRef(null)
  const [aiSuggestionPosition, setAiSuggestionPosition] = useState(null)
  const aiConfigured = canSuggestPersonalization()
  const portalTarget = typeof document !== 'undefined' ? document.body : null
  const [anchorInView, setAnchorInView] = useState(true)
  const renderModal = (content) => (portalTarget ? createPortal(content, portalTarget) : content)

  const syncSuggestionMetrics = useCallback(() => {
    if (typeof window === 'undefined') {
      return
    }
    const anchor = aiSuggestionAnchorRef.current
    if (!anchor) {
      setAnchorInView(true)
      setAiSuggestionPosition(null)
      return
    }

    const rect = anchor.getBoundingClientRect()
    const fullyVisible = rect.top >= 0 && rect.bottom <= window.innerHeight
    setAnchorInView(fullyVisible)

    if (!aiSuggestionVisible) {
      setAiSuggestionPosition(null)
      return
    }

    if (fullyVisible) {
      setAiSuggestionPosition({
        top: Math.min(rect.bottom + 8, window.innerHeight - 24),
        right: Math.max(window.innerWidth - rect.right, 12),
        width: Math.min(rect.width, 384),
      })
    } else {
      setAiSuggestionPosition(null)
    }
  }, [aiSuggestionVisible])

  useEffect(() => {
    syncSuggestionMetrics()
    if (typeof window === 'undefined') {
      return
    }
    const handle = () => syncSuggestionMetrics()
    window.addEventListener('scroll', handle, true)
    window.addEventListener('resize', handle)

    return () => {
      window.removeEventListener('scroll', handle, true)
      window.removeEventListener('resize', handle)
    }
  }, [syncSuggestionMetrics])

  useEffect(() => {
    if (!menuOpen) {
      return undefined
    }

    const handlePointerDown = (event) => {
      if (menuContainerRef.current && menuContainerRef.current.contains(event.target)) {
        return
      }
      setMenuOpen(false)
    }

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setMenuOpen(false)
      }
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [menuOpen])

  useEffect(() => {
    if (!importModalOpen && !logModalOpen) {
      return undefined
    }

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        if (logModalOpen) {
          setLogModalOpen(false)
          return
        }
        if (importModalOpen) {
          setImportModalOpen(false)
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [importModalOpen, logModalOpen])


  const modeDetails = useMemo(() => {
    const config = LINK_MODES[linkMode] ?? LINK_MODES.web
    return {
      ...config,
      label: t(config.labelKey),
      shortLabel: t(config.shortLabelKey),
      description: t(config.descriptionKey),
      helper: t(config.helperKey),
    }
  }, [linkMode, t])

  const appendStatus = useCallback((level, message) => {
    if (!message) {
      return
    }
    setStatusLog((prev) => {
      const next = [...prev, makeLogEntry(level, message)]
      if (next.length > LIMIT_LOG) {
        return next.slice(next.length - LIMIT_LOG)
      }
      return next
    })
  }, [])

  const loadTemplates = useCallback(async ({ force = false } = {}) => {
    if (!isSupabaseReady()) {
      setTemplates([])
      setTemplatesError(new Error(t('templates.missingSupabase')))
      setTemplatesLoading(false)
      return
    }

    const cached = readTemplateCache()
    if (cached) {
      setTemplates(cached.items)
      setTemplatesError(null)
      if (!force && cached.fresh) {
        setTemplatesLoading(false)
        return
      }
    }

    setTemplatesLoading(true)
    setTemplatesError(null)
    try {
      const { data, error } = await fetchTemplates()
      if (error) {
        if (!cached) {
          setTemplates([])
        }
        setTemplatesError(error)
      } else {
        const resolved = data ?? []
        setTemplates(resolved)
        setTemplatesError(null)
        writeTemplateCache(resolved)
      }
    } finally {
      setTemplatesLoading(false)
    }
  }, [t])

  useEffect(() => {
    if (!session || !isSupabaseReady()) {
      setTemplates([])
      setTemplatesError(null)
      setSelectedTemplateId(null)
      setTemplatesLoading(false)
      return
    }
    loadTemplates()
  }, [loadTemplates, session])

  useEffect(() => {
    if (!session || !isSupabaseReady()) {
      return undefined
    }

    const channel = supabase
      .channel('templates-live-sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'templates' }, () => {
        loadTemplates({ force: true })
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [loadTemplates, session])

  const refreshContactMetrics = useCallback(async () => {
    if (!isSupabaseReady()) {
      setContactTotal(null)
      return
    }
    try {
      const { data, error } = await supabase
        .from('contact_metrics')
        .select('total_contacts')
        .eq('id', 1)
        .maybeSingle()
      if (error) {
        throw error
      }
      setContactTotal(data?.total_contacts ?? 0)
    } catch (error) {
      console.error('Failed to load contact metrics', error)
    }
  }, [])

  useEffect(() => {
    if (session && isSupabaseReady()) {
      refreshContactMetrics()
    } else {
      setContactTotal(null)
    }
  }, [refreshContactMetrics, session])

  const handleContactsImported = useCallback(
    () => {
      refreshContactMetrics()
      setContactsRefreshToken((token) => token + 1)
    },
    [refreshContactMetrics],
  )

  const handleOpenContactsModal = useCallback(() => {
    setContactsModalOpen(true)
  }, [])

  const handleCloseContactsModal = useCallback(() => {
    setContactsModalOpen(false)
  }, [])

  const handleOpenTemplateManager = useCallback(() => {
    setTemplateManagerOpen(true)
  }, [])

  const handleCloseTemplateManager = useCallback(() => {
    setTemplateManagerOpen(false)
  }, [])

  const handleMenuToggle = useCallback(() => {
    setMenuOpen((state) => !state)
  }, [])

  const handleMenuOpenContacts = useCallback(() => {
    setMenuOpen(false)
    handleOpenContactsModal()
  }, [handleOpenContactsModal])

  const handleMenuManageTemplates = useCallback(() => {
    setMenuOpen(false)
    handleOpenTemplateManager()
  }, [handleOpenTemplateManager])

  const handleMenuOpenImport = useCallback(() => {
    setMenuOpen(false)
    setImportModalOpen(true)
  }, [])

  const handleMenuOpenLog = useCallback(() => {
    setMenuOpen(false)
    setLogModalOpen(true)
  }, [])

  const handleCloseImportModal = useCallback(() => {
    setImportModalOpen(false)
  }, [])

  const handleCloseLogModal = useCallback(() => {
    setLogModalOpen(false)
  }, [])

  const loadFlaggedContacts = useCallback(async () => {
    if (!session || !isSupabaseReady()) {
      setFlaggedPhones([])
      return
    }

    try {
      const { data, error } = await fetchFlaggedContacts()
      if (error) {
        throw error
      }

      const digits = Array.from(
        new Set(
          (data ?? [])
            .map((item) => normalizePhoneDigits(item?.phone))
            .filter(Boolean),
        ),
      )

      setFlaggedPhones(digits)
    } catch (error) {
      console.error('Failed to load flagged contacts', error)
    }
  }, [session])

  useEffect(() => {
    void loadFlaggedContacts()
  }, [loadFlaggedContacts, contactsRefreshToken])

  useEffect(() => {
    if (!session || !isSupabaseReady()) {
      return undefined
    }

    const channel = supabase
      .channel('contacts-flag-sync')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'contacts' }, (payload) => {
        if (payload?.old?.is_flagged !== payload?.new?.is_flagged) {
          void loadFlaggedContacts()
        }
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [loadFlaggedContacts, session])

  const handleToggleContactFlag = useCallback(
    async (contact) => {
      if (!contact || !isSupabaseReady()) {
        return
      }

      const digits = normalizePhoneDigits(contact?.phone ?? contact)
      const contactId = contact?.id ?? null

      if (!digits || !contactId) {
        return
      }

      const currentlyFlagged = flaggedPhones.includes(digits)
      const nextFlag = !currentlyFlagged

      setFlaggedPhones((prev) => {
        const next = new Set(prev)
        if (nextFlag) {
          next.add(digits)
        } else {
          next.delete(digits)
        }
        return Array.from(next)
      })

      appendStatus(
        nextFlag ? 'warning' : 'info',
        t(nextFlag ? 'contacts.flag.logAdded' : 'contacts.flag.logRemoved', {
          phone: formatPhone(digits),
        }),
      )

      const { data, error } = await setContactFlag({
        contactId,
        flag: nextFlag,
        flaggedBy: session?.user?.id ?? null,
      })

      if (error) {
        console.error('Failed to update contact flag', error)
        setFlaggedPhones((prev) => {
          const next = new Set(prev)
          if (nextFlag) {
            next.delete(digits)
          } else {
            next.add(digits)
          }
          return Array.from(next)
        })
        appendStatus('error', t('contacts.flag.logError', { phone: formatPhone(digits) }))
        return
      }

      if (data) {
        const normalized = normalizePhoneDigits(data.phone)
        const finalFlag = Boolean(data.is_flagged)
        const targetDigits = normalized || digits
        setFlaggedPhones((prev) => {
          const next = new Set(prev)
          if (finalFlag) {
            next.add(targetDigits)
          } else {
            next.delete(targetDigits)
          }
          return Array.from(next)
        })
      }
    },
    [appendStatus, flaggedPhones, session, t],
  )

  useEffect(() => {
    if (templateManagerOpen && session && isSupabaseReady()) {
      loadTemplates({ force: true })
    }
  }, [loadTemplates, session, templateManagerOpen])

  const handleTemplateSaved = useCallback(
    (template, { isUpdate } = {}) => {
      loadTemplates({ force: true })
      const templateName = template?.name ?? t('templates.manage.unnamed')
      appendStatus('success', isUpdate ? t('templates.manage.updateLog', { name: templateName }) : t('templates.manage.createLog', { name: templateName }))
    },
    [appendStatus, loadTemplates, t],
  )

  const handleTemplateDeleted = useCallback(
    (_templateId, template) => {
      loadTemplates({ force: true })
      const templateName = template?.name ?? t('templates.manage.unnamed')
      appendStatus('success', t('templates.manage.deleteLog', { name: templateName }))
    },
    [appendStatus, loadTemplates, t],
  )

  const trimmedMessage = messageBody.trim()

  const preparedRecipients = useMemo(() => {
    const raw = parseRecipients(recipientInput)
    const seen = new Set()
    const mapped = []
    raw.forEach((jid) => {
      const phone = jidToDigits(jid)
      if (phone && !seen.has(phone)) {
        seen.add(phone)
        mapped.push(phone)
      }
    })
    return mapped
  }, [recipientInput])

  const resolveContactIds = useCallback(
    async (phones) => {
      if (!isSupabaseReady() || phones.length === 0) {
        return new Map()
      }

      const resolved = new Map()
      phones.forEach((digits) => {
        const knownId = contactIdMap[digits]
        if (knownId) {
          resolved.set(digits, knownId)
        }
      })

      const unresolved = phones.filter((digits) => !resolved.has(digits))
      if (unresolved.length === 0) {
        return resolved
      }

      const phoneCandidates = Array.from(
        new Set(
          unresolved.flatMap((digits) => [digits, `+${digits}`]),
        ),
      )

      if (phoneCandidates.length === 0) {
        return resolved
      }

      try {
        const { data, error } = await supabase
          .from('contacts')
          .select('id, phone')
          .in('phone', phoneCandidates)

        if (error) {
          throw error
        }

        const updates = {}
        for (const row of data ?? []) {
          const digits = normalizePhoneDigits(row.phone)
          if (!digits) {
            continue
          }
          resolved.set(digits, row.id)
          updates[digits] = row.id
        }

        if (Object.keys(updates).length > 0) {
          setContactIdMap((previous) => ({ ...previous, ...updates }))
        }
      } catch (error) {
        console.error('Failed to resolve contact ids', error)
      }

      return resolved
    },
    [contactIdMap],
  )
  const handleRequestAiSuggestion = useCallback(async () => {
    if (!isSupabaseReady()) {
      setAiSuggestionVisible(true)
      setAiSuggestionError(new Error(t('ai.suggest.missingSupabase')))
      return
    }

    if (!aiConfigured) {
      setAiSuggestionVisible(true)
      setAiSuggestionError(new Error(t('ai.suggest.configure')))
      return
    }

    if (!messageBody.trim()) {
      setAiSuggestionVisible(true)
      setAiSuggestionError(new Error(t('ai.suggest.noMessage')))
      return
    }

    if (preparedRecipients.length === 0) {
      setAiSuggestionVisible(true)
      setAiSuggestionError(new Error(t('ai.suggest.noRecipients')))
      return
    }

    setAiSuggestionVisible(true)
    setAiSuggestion(null)
    setAiContactPreview(null)
    setAiSuggestionError(null)
    setAiSuggestionLoading(true)

    try {
      const formatInFilter = (values) => `(${values.map((value) => `"${value}"`).join(',')})`
      const languageHint = detectMessageLanguage(messageBody, locale)
      const targetDigits = preparedRecipients.slice(0, 3)
      const resolved = await resolveContactIds(targetDigits)

      const ordered = targetDigits.map((digits) => ({
        digits,
        id: resolved.get(digits) ?? null,
      }))

      const contactIds = Array.from(new Set(ordered.map((entry) => entry.id).filter(Boolean)))

      let contactRows = []

      if (contactIds.length > 0) {
        const inList = formatInFilter(contactIds)
        const { data, error } = await supabase
          .from('contacts')
          .select('id, full_name, phone, email, company')
          .filter('id', 'in', inList)

        if (error) {
          throw error
        }

        contactRows = data ?? []
      } else {
        const phoneCandidates = Array.from(
          new Set(
            targetDigits.flatMap((digits) => [digits, `+${digits}`]),
          ),
        )

        if (phoneCandidates.length > 0) {
          const inList = formatInFilter(phoneCandidates)
          const { data, error } = await supabase
            .from('contacts')
            .select('id, full_name, phone, email, company')
            .filter('phone', 'in', inList)

          if (error) {
            throw error
          }

          contactRows = data ?? []
        }
      }

      const contactMap = new Map(contactRows.map((row) => [row.id, row]))
      const fallbackContactName = resolveFallbackContactName(languageHint, locale)

      const contactsForAi = ordered
        .map(({ digits, id }) => {
          const base = id ? contactMap.get(id) : contactRows.find((row) => normalizePhoneDigits(row?.phone) === digits)
          if (!base) {
            return null
          }
          const rawFullName = (base.full_name ?? '').trim()
          const { fullName, firstName, lastName } = deriveContactNameParts(rawFullName, fallbackContactName)
          return {
            ...base,
            digits,
            full_name: fullName,
            first_name: firstName,
            last_name: lastName,
          }
        })
        .filter(Boolean)

      if (contactsForAi.length === 0) {
        setAiSuggestionError(new Error(t('ai.suggest.noContacts')))
        setAiSuggestionLoading(false)
        return
      }

      setAiContactPreview(contactsForAi[0])

      const { data, error, warning } = await suggestTemplatePersonalization({
        templateBody: messageBody,
        contacts: contactsForAi.map((contact) => {
          const clone = { ...contact }
          delete clone.digits
          return clone
        }),
        languageHint,
      })

      if (warning) {
        console.warn('Z AI personalization warning:', warning)
      }

      if (error) {
        throw error
      }

      setAiSuggestion(data)
    } catch (error) {
      console.error('Failed to generate AI suggestion', error)
      setAiSuggestion(null)
      setAiSuggestionError(error instanceof Error ? error : new Error(String(error)))
    } finally {
      setAiSuggestionLoading(false)
    }
  }, [aiConfigured, locale, messageBody, preparedRecipients, resolveContactIds, t])

  const handleApplyAiSuggestion = useCallback(() => {
    if (!aiSuggestion?.message) {
      return
    }
    setMessageBody(aiSuggestion.message)
    setSelectedTemplateId(null)
    setAiSuggestionVisible(false)
    setAiSuggestion(null)
    setAiSuggestionError(null)
    setAiContactPreview(null)
    appendStatus('success', t('ai.suggest.appliedLog'))
  }, [aiSuggestion, appendStatus, t])

  const handleDismissAiSuggestion = useCallback(() => {
    setAiSuggestionVisible(false)
    setAiSuggestionPosition(null)
  }, [])

  const handleDockedSuggestionFocus = useCallback(() => {
    const anchor = aiSuggestionAnchorRef.current
    if (!anchor) {
      return
    }
    anchor.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [])

  const templateMap = useMemo(() => {
    const map = new Map()
    templates.forEach((template) => map.set(template.id, template))
    return map
  }, [templates])

  useEffect(() => {
    if (selectedTemplateId && !templateMap.has(selectedTemplateId)) {
      setSelectedTemplateId(null)
    }
  }, [selectedTemplateId, templateMap])

  useEffect(() => {
    if (preparedRecipients.length === 0) {
      setAiSuggestion(null)
      setAiSuggestionError(null)
      setAiSuggestionVisible(false)
      setAiContactPreview(null)
    }
  }, [preparedRecipients])

  const recipientCount = preparedRecipients.length
  const aiEligible = trimmedMessage.length > 0 && recipientCount > 0
  const aiButtonDisabled = aiSuggestionLoading
  const showAiButton = trimmedMessage.length > 0
  const aiButtonActive = aiEligible && aiConfigured
  const suggestionReady = Boolean(aiSuggestion) && !aiSuggestionLoading && !aiSuggestionError
  const suggestionFailed = Boolean(aiSuggestionError) && !aiSuggestionLoading && !aiSuggestion
  const showAnchoredSuggestion = aiSuggestionVisible && anchorInView
  const showDockedSuggestion = aiSuggestionVisible && !anchorInView

  const statusMeta = useMemo(() => {
    const meta = [
      t('header.numbers', { count: recipientCount }),
      t('header.mode', { mode: modeDetails.shortLabel }),
    ]
    if (typeof contactTotal === 'number') {
      meta.push(t('header.contactsTotal', { count: contactTotal }))
    }
    return meta
  }, [contactTotal, modeDetails.shortLabel, recipientCount, t])

  const urlPayloads = useMemo(() => {
    return preparedRecipients.map((phone) => ({
      phone,
      url: buildWhatsAppUrl(phone, trimmedMessage, linkMode),
    }))
  }, [linkMode, preparedRecipients, trimmedMessage])

  const previewLinks = useMemo(() => urlPayloads.slice(0, 10), [urlPayloads])
  const previewOverflow = Math.max(urlPayloads.length - previewLinks.length, 0)
  const messagePreview = trimmedMessage
    ? `${trimmedMessage.slice(0, 160)}${trimmedMessage.length > 160 ? '…' : ''}`
    : t('preview.emptyMessage')

  const previewSummary = t('preview.summary', { visible: previewLinks.length, total: urlPayloads.length })
  const previewMoreLabel = previewOverflow > 0 ? t('preview.more', { count: previewOverflow }) : null

  const supabaseStatusState = useMemo(() => {
    if (!supabaseHealth) {
      return 'checking'
    }
    if (supabaseHealth.state === 'idle') {
      return 'checking'
    }
    if (supabaseHealth.state === 'online' && supabaseHealth.fallback) {
      return 'degraded'
    }
    return supabaseHealth.state ?? 'checking'
  }, [supabaseHealth])

  const supabaseStyles = SUPABASE_INDICATOR_STYLES[supabaseStatusState] ?? SUPABASE_INDICATOR_STYLES.checking

  const supabaseStatusLabel = useMemo(() => {
    switch (supabaseStatusState) {
      case 'online':
        return t('status.supabase.online')
      case 'degraded':
        return t('status.supabase.degraded')
      case 'error':
        return t('status.supabase.error')
      case 'offline':
        return t('status.supabase.offline')
      default:
        return t('status.supabase.checking')
    }
  }, [supabaseStatusState, t])

  const supabaseUpdatedLabel = useMemo(() => {
    if (!supabaseHealth?.updatedAt) {
      return null
    }
    return t('status.supabase.updatedAt', {
      timestamp: formatTime(supabaseHealth.updatedAt),
    })
  }, [supabaseHealth?.updatedAt, t])

  const appTitle = t('app.title')
  const menuLabel = t('menu.toggle')
  const menuContactsLabel = t('menu.goToContacts')
  const menuTemplatesLabel = t('menu.openTemplates')
  const menuImportLabel = t('menu.openImport')
  const menuLogLabel = t('menu.openLog')
  const menuCloseLabel = t('menu.close')
  const launcherTitle = t('launcher.title')
  const launcherDescription = t('launcher.description')
  const recipientsLabel = t('launcher.recipientsLabel')
  const recipientsPlaceholder = t('launcher.recipientsPlaceholder')
  const messageLabel = t('launcher.messageLabel')
  const messagePlaceholder = t('launcher.messagePlaceholder')
  const linkTypeLabel = t('launcher.linkType')
  const openTabsLabel = t('actions.openTabs')
  const previewTitle = t('preview.title')
  const messagePreviewLabel = t('preview.messageLabel')
  const emptyStateText = t('preview.emptyState')
  const openTabLabel = t('preview.openTab')
  const copyLinkLabel = t('preview.copyLink')
  const logTitle = t('log.title')
  const aiButtonLabel = '⚡'
  const aiTooltipLabel = aiConfigured ? t('ai.suggest.tooltip') : t('ai.suggest.configure')
  const aiPreviewTitle = t('ai.suggest.previewTitle')
  const aiApplyLabel = t('ai.suggest.apply')
  const aiDismissLabel = t('ai.suggest.dismiss')
  const aiLoadingLabel = t('ai.suggest.loading')
  const aiSummaryLabel = t('ai.suggest.summaryLabel')
  const aiHighlightsLabel = t('ai.suggest.highlightsLabel')
  const aiContactLabel = aiContactPreview?.full_name
    ? t('ai.suggest.previewContact', { name: aiContactPreview.full_name })
    : null

  const languageTarget = locale === 'en' ? 'es' : 'en'
  const languageButtonLabel = languageTarget === 'es' ? t('actions.switchToSpanish') : t('actions.switchToEnglish')
  const languageButtonShortLabel = languageTarget.toUpperCase()
  const signedInEmail = session?.user?.email ?? ''
  const signedInLabel = signedInEmail ? t('status.auth.signedInAs', { email: signedInEmail }) : t('status.auth.signedInUnknown')
  const signOutLabel = signOutLoading ? t('login.signingOut') : t('login.signOut')

  const handleToggleLocale = useCallback(() => {
    setLocale(languageTarget)
  }, [languageTarget, setLocale])

  const handleSignOut = useCallback(async () => {
    if (!session || !isSupabaseReady()) {
      return
    }
    setSignOutLoading(true)
    try {
      const { error } = await supabase.auth.signOut()
      if (error) {
        appendStatus('error', t('login.signOutError', { message: error.message }))
      }
    } catch (error) {
      appendStatus('error', t('login.signOutError', { message: error.message }))
    } finally {
      setSignOutLoading(false)
    }
  }, [appendStatus, session, t])

  const handleCopyLink = useCallback(
    async (url) => {
      if (typeof navigator === 'undefined' || !navigator.clipboard) {
        appendStatus('error', t('status.clipboardUnavailable'))
        return
      }
      try {
        await navigator.clipboard.writeText(url)
        appendStatus('success', t('status.copySuccess'))
      } catch (error) {
        appendStatus('error', t('status.copyFail', { error: error?.message ?? String(error) }))
      }
    },
    [appendStatus, t],
  )

  const openWhatsAppLink = useCallback((url) => {
    if (typeof window === 'undefined') {
      return false
    }

    const popup = window.open(url, '_blank', 'noopener=yes,noreferrer=yes')
    if (popup) {
      try {
        popup.opener = null
      } catch (error) {
        console.warn('Unable to detach popup opener:', error)
      }
      return true
    }

    return false
  }, [])

  const runLaunch = useCallback(async () => {
    if (preparedRecipients.length === 0) {
      appendStatus('warning', t('status.needsRecipients'))
      return
    }

    if (!trimmedMessage) {
      appendStatus('warning', t('status.needsMessage'))
      return
    }

    const summary = t('status.summary', {
      count: preparedRecipients.length,
      mode: modeDetails.shortLabel,
    })

    let openedCount = 0

    const attempts = urlPayloads.map(({ phone, url }) => {
      const opened = openWhatsAppLink(url)
      if (opened) {
        openedCount += 1
      }
      return { phone, url, opened }
    })

    const launchReport = {
      attempts,
      mode: linkMode,
      message: trimmedMessage,
      templateId: selectedTemplateId,
      timestamp: new Date().toISOString(),
    }

    setLastLaunchReport(launchReport)

    if (openedCount === 0) {
      appendStatus('error', t('status.popupsNone', { summary }))
    } else if (openedCount === preparedRecipients.length) {
      appendStatus('success', t('status.popupsAll', { summary }))
    } else {
      appendStatus('warning', t('status.popupsSome', { summary }))
    }

    const { data: metricRecord, error: metricsError } = await recordSendMetrics({
      recipientCount: preparedRecipients.length,
      messageBody: trimmedMessage,
      templateId: selectedTemplateId,
      mode: linkMode,
    })

    if (metricsError) {
      console.warn('Failed to persist send metrics:', metricsError)
    }

    if (preparedRecipients.length > 0) {
      const resolved = await resolveContactIds(preparedRecipients)
      const contactIds = Array.from(
        new Set(
          preparedRecipients
            .map((digits) => resolved.get(digits))
            .filter(Boolean),
        ),
      )

      if (contactIds.length > 0) {
        const { error: contactSendsError } = await recordContactSends({
          contactIds,
          sendMetricId: metricRecord?.id ?? null,
          sentAt: metricRecord?.sent_at ?? new Date().toISOString(),
        })

        if (contactSendsError) {
          console.warn('Failed to persist contact sends:', contactSendsError)
        }
      }
    }
    return { attempts }
  }, [appendStatus, linkMode, modeDetails.shortLabel, openWhatsAppLink, preparedRecipients, resolveContactIds, selectedTemplateId, t, trimmedMessage, urlPayloads])

  const handleLaunch = useCallback(async () => {
    await runLaunch()
  }, [runLaunch])

  const handleReplayLaunch = useCallback(() => {
    setLastLaunchReport((previous) => {
      if (!previous || !previous.attempts?.length) {
        return previous
      }

      const refreshedAttempts = previous.attempts.map((attempt) => {
        const opened = openWhatsAppLink(attempt.url)
        if (opened) {
          return { ...attempt, opened: true }
        }
        return attempt
      })

      return {
        ...previous,
        attempts: refreshedAttempts,
        timestamp: new Date().toISOString(),
      }
    })
  }, [openWhatsAppLink])

  const handleOpenSingle = useCallback(
    (url) => {
      const opened = openWhatsAppLink(url)
      if (!opened) {
        return
      }

      setLastLaunchReport((previous) => {
        if (!previous) {
          return previous
        }

        return {
          ...previous,
          attempts: previous.attempts.map((attempt) => (attempt.url === url ? { ...attempt, opened: true } : attempt)),
          timestamp: new Date().toISOString(),
        }
      })
    },
    [openWhatsAppLink],
  )

  const handleClearLaunchReport = useCallback(() => {
    setLastLaunchReport(null)
  }, [])

  const handleAddContact = useCallback(
    (contact) => {
      if (!contact) {
        return
      }
      const digits = normalizePhoneDigits(contact.phone)
      const contactLabel = contact.full_name?.trim() || t('contacts.select.unnamed')
      if (!digits) {
        appendStatus('warning', t('contacts.select.missingPhone', { name: contactLabel }))
        return
      }
      const selectedSet = new Set(preparedRecipients)
      if (selectedSet.has(digits)) {
        selectedSet.delete(digits)
        setContactIdMap((previous) => {
          if (!previous || !(digits in previous)) {
            return previous
          }
          const next = { ...previous }
          delete next[digits]
          return next
        })
        const nextInput = Array.from(selectedSet)
          .map((value) => formatPhone(value))
          .join('\n')
        setRecipientInput(nextInput)
        appendStatus('info', t('contacts.select.removed', { phone: formatPhone(digits), name: contactLabel }))
        return
      }
      selectedSet.add(digits)
      if (contact.id) {
        setContactIdMap((previous) => {
          if (previous[digits] === contact.id) {
            return previous
          }
          return { ...previous, [digits]: contact.id }
        })
      }
      const nextInput = Array.from(selectedSet)
        .map((value) => formatPhone(value))
        .join('\n')
      setRecipientInput(nextInput)
      appendStatus('success', t('contacts.select.added', { phone: formatPhone(digits), name: contactLabel }))
    },
    [appendStatus, preparedRecipients, t],
  )

  const handleContactStatusChange = useCallback(
    (contact) => {
      if (!contact || contact.status !== 'green') {
        return
      }

      const digits = normalizePhoneDigits(contact.phone)
      if (!digits) {
        return
      }

      let removed = false
      setRecipientInput((previous) => {
        const raw = parseRecipients(previous)
        const digitsList = raw
          .map((jid) => jidToDigits(jid))
          .filter(Boolean)

        if (!digitsList.includes(digits)) {
          return previous
        }

        removed = true
        const nextDigits = digitsList.filter((value) => value !== digits)
        return nextDigits.map((value) => formatPhone(value)).join('\n')
      })

      if (!removed) {
        return
      }

      setContactIdMap((previous) => {
        if (!previous || !(digits in previous)) {
          return previous
        }
        const next = { ...previous }
        delete next[digits]
        return next
      })

      appendStatus('info', t('contacts.select.removed', { phone: formatPhone(digits) }))
    },
    [appendStatus, t],
  )


  if (!isSupabaseReady()) {
    return (
      <div className="flex items-center justify-center min-h-screen px-6 py-10 bg-slate-950 text-slate-100">
        <div className="max-w-lg text-center">
          <h1 className="text-2xl font-semibold">{t('login.missingSupabaseTitle')}</h1>
          <p className="mt-3 text-sm text-slate-400">{t('login.missingSupabaseDescription')}</p>
        </div>
      </div>
    )
  }

  if (authLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen px-6 py-10 bg-slate-950 text-slate-100">
        <div className="flex flex-col items-center gap-3">
          <span className="w-10 h-10 border-4 rounded-full animate-spin border-slate-700 border-t-blue-400" aria-hidden="true" />
          <p className="text-sm text-slate-400">{t('login.loading')}</p>
        </div>
      </div>
    )
  }

  if (!session) {
    return (
      <div className="flex items-center justify-center min-h-screen px-6 py-10 bg-slate-950">
        <LoginForm t={t} />
      </div>
    )
  }
  return (
    <div className="w-full px-4 py-10 mx-auto max-w-7xl text-slate-100 sm:px-6 lg:px-8">
      <header className="flex flex-col gap-6 border-b border-slate-800/60">
        <div className="flex items-center gap-3 sm:gap-4">
          <img
            src="/massapp-logo.svg"
            alt={appTitle}
            className="w-12 h-12 p-2 border shadow-lg rounded-2xl border-slate-700/60 bg-slate-900/70 shadow-slate-950/50"
          />
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{appTitle}</h1>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <div ref={menuContainerRef} className="relative">
              <button
                type="button"
                onClick={handleMenuToggle}
                className={`${LANGUAGE_BUTTON} min-w-[2.5rem]`}
                title={menuLabel}
                aria-label={menuLabel}
                aria-haspopup="true"
                aria-expanded={menuOpen}
              >
                <span aria-hidden="true">☰</span>
              </button>
              {menuOpen ? (
                <div className="absolute left-0 z-30 w-56 p-2 mt-2 border shadow-xl rounded-xl border-slate-700/70 bg-slate-950/95 shadow-slate-950/60">
                  <button
                    type="button"
                    onClick={handleMenuOpenContacts}
                    className="flex items-center justify-between w-full px-3 py-2 text-sm transition rounded-lg text-slate-200 hover:bg-slate-800/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500"
                  >
                    {menuContactsLabel}
                    <span aria-hidden="true">👥</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleMenuManageTemplates}
                    className="flex items-center justify-between w-full px-3 py-2 text-sm transition rounded-lg text-slate-200 hover:bg-slate-800/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500"
                  >
                    {menuTemplatesLabel}
                    <span aria-hidden="true">📝</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleMenuOpenImport}
                    className="flex items-center justify-between w-full px-3 py-2 text-sm transition rounded-lg text-slate-200 hover:bg-slate-800/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500"
                  >
                    {menuImportLabel}
                    <span aria-hidden="true">📥</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleMenuOpenLog}
                    className="flex items-center justify-between w-full px-3 py-2 text-sm transition rounded-lg text-slate-200 hover:bg-slate-800/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500"
                  >
                    {menuLogLabel}
                    <span aria-hidden="true">📜</span>
                  </button>
                  <div className="h-px my-1 bg-slate-700/60" />
                  <button
                    type="button"
                    onClick={() => setMenuOpen(false)}
                    className="flex items-center justify-between w-full px-3 py-2 text-sm transition rounded-lg text-slate-400 hover:bg-slate-800/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500"
                  >
                    {menuCloseLabel}
                    <span aria-hidden="true">✕</span>
                  </button>
                </div>
              ) : null}
            </div>
            <button
              type="button"
              className={LANGUAGE_BUTTON}
              onClick={handleToggleLocale}
              title={languageButtonLabel}
              aria-label={languageButtonLabel}
            >
              <span className="sm:hidden">{languageButtonShortLabel}</span>
              <span className="hidden sm:inline">{languageButtonLabel}</span>
            </button>
            <button type="button" onClick={handleSignOut} className={BUTTON_DANGER} disabled={signOutLoading}>
              {signOutLabel}
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[0.68rem] sm:text-xs">
            {statusMeta.map((item, index) => (
              <span key={index} className={STATUS_PILL}>
                {item}
              </span>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs text-slate-300">
          <span className="relative flex items-center justify-center w-4 h-4">
            {supabaseStatusState !== 'offline' ? (
              <span className={`absolute inline-flex h-3.5 w-3.5 rounded-full opacity-60 ${supabaseStyles.ping} animate-ping`} />
            ) : null}
            <span className={`relative inline-flex h-3 w-3 rounded-full ${supabaseStyles.dot}`} />
          </span>
          <span>{supabaseStatusLabel}</span>
          {supabaseUpdatedLabel ? <span className="text-[0.65rem] text-slate-500">{supabaseUpdatedLabel}</span> : null}
          <span className="text-[0.65rem] text-slate-500">{signedInLabel}</span>
        </div>
      </header>

      <main className="flex flex-col gap-8 mt-8">
        <div className="grid gap-6 lg:grid-cols-2 xl:grid-cols-4 xl:items-stretch">
          <article className={`${CARD_BASE} gap-6 xl:col-span-2 xl:self-start`}>
            <div className="flex flex-col gap-1.5">
              <h2 className="text-xl font-semibold text-slate-100">{launcherTitle}</h2>
              <p className="text-sm text-slate-400">{launcherDescription}</p>
            </div>
            <div className="flex flex-col gap-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <label htmlFor="recipients-input" className="font-semibold text-slate-200">
                  {recipientsLabel}
                </label>
                {recipientCount > 0 ? (
                  <button
                    type="button"
                    className={`${BUTTON_SECONDARY} w-auto h-9 px-3 text-xs sm:text-sm`}
                    onClick={handleLaunch}
                  >
                    {openTabsLabel}
                  </button>
                ) : null}
              </div>
              <textarea
                id="recipients-input"
                value={recipientInput}
                onChange={(event) => setRecipientInput(event.target.value)}
                placeholder={recipientsPlaceholder}
                rows={4}
                className="w-full min-h-[6.5rem] max-h-60 resize-none overflow-y-auto rounded-xl border border-slate-700/60 bg-slate-900/60 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/30"
              />
            </div>
            <label className="flex flex-col gap-2 text-sm">
              <span className="font-semibold text-slate-200">{messageLabel}</span>
              <div ref={aiSuggestionAnchorRef} className="relative">
                <textarea
                  value={messageBody}
                  onChange={(event) => {
                    const nextValue = event.target.value
                    setMessageBody(nextValue)
                    setAiSuggestion(null)
                    setAiSuggestionError(null)
                    setAiSuggestionVisible(false)
                    setAiContactPreview(null)
                    if (selectedTemplateId) {
                      const template = templateMap.get(selectedTemplateId)
                      if (!template || template.body !== nextValue) {
                        setSelectedTemplateId(null)
                      }
                    }
                  }}
                  placeholder={messagePlaceholder}
                  rows={6}
                  className="min-h-[9rem] w-full rounded-xl border border-slate-700/60 bg-slate-900/60 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/30"
                />
                {showAiButton ? (
                  <div className="absolute flex items-center gap-2 top-2 right-2">
                    <button
                      type="button"
                      onClick={handleRequestAiSuggestion}
                      disabled={aiButtonDisabled}
                      title={aiTooltipLabel}
                      className={`inline-flex items-center gap-2 rounded-lg border px-2.5 py-1 text-xs font-semibold uppercase tracking-wide transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${
                        aiButtonActive
                          ? 'border-amber-400/40 bg-amber-500/10 text-amber-200 hover:border-amber-300/70 hover:bg-amber-500/20 focus-visible:outline-amber-300'
                          : 'border-slate-700/60 bg-slate-900/60 text-slate-500 focus-visible:outline-slate-500'
                      } ${aiButtonDisabled ? 'opacity-60 cursor-not-allowed' : ''}`}
                    >
                      <span className="text-base" aria-hidden="true">{aiButtonLabel}</span>
                      <span className="sr-only">{aiTooltipLabel}</span>
                    </button>
                  </div>
                ) : null}
              </div>
                {showAnchoredSuggestion && aiSuggestionPosition && portalTarget
                ? createPortal(
                    <div
                      className="fixed z-[4000] space-y-3 rounded-xl border border-slate-700/70 bg-slate-950/95 p-4 shadow-2xl shadow-slate-950/60"
                      style={{
                        top: aiSuggestionPosition.top,
                        right: aiSuggestionPosition.right,
                        width: aiSuggestionPosition.width,
                      }}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex flex-col">
                          <span className="text-sm font-semibold text-slate-100">{aiPreviewTitle}</span>
                          {aiContactLabel ? <span className="text-xs text-slate-400">{aiContactLabel}</span> : null}
                        </div>
                        <button
                          type="button"
                          onClick={handleDismissAiSuggestion}
                          className="inline-flex items-center justify-center w-6 h-6 text-xs transition border rounded-full border-slate-700/60 text-slate-400 hover:border-slate-500/70 hover:text-slate-200"
                          aria-label={aiDismissLabel}
                        >
                          ✕
                        </button>
                      </div>
                      {aiSuggestionLoading ? (
                        <p className="flex items-center gap-2 text-xs text-slate-400">
                          <span className="inline-flex w-3 h-3 border rounded-full animate-spin border-slate-600 border-t-amber-300" aria-hidden="true" />
                          {aiLoadingLabel}
                        </p>
                      ) : aiSuggestionError ? (
                        <div className="space-y-3">
                          <p className="text-xs text-rose-300">{t('ai.suggest.error', { message: aiSuggestionError.message })}</p>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={handleRequestAiSuggestion}
                              className="inline-flex items-center gap-2 rounded-lg border border-amber-400/40 bg-amber-500/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-amber-200 transition hover:border-amber-300/70 hover:bg-amber-500/20"
                            >
                              {t('ai.suggest.retry')}
                            </button>
                            <button
                              type="button"
                              onClick={handleDismissAiSuggestion}
                              className="inline-flex items-center gap-2 rounded-lg border border-slate-700/60 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-300 transition hover:border-slate-500/70 hover:text-slate-100"
                            >
                              {aiDismissLabel}
                            </button>
                          </div>
                        </div>
                      ) : aiSuggestion ? (
                        <div className="space-y-3">
                          {aiSuggestion.summary ? (
                            <p className="text-xs text-slate-300">{aiSummaryLabel}: {aiSuggestion.summary}</p>
                          ) : null}
                          {aiSuggestion.highlights && aiSuggestion.highlights.length > 0 ? (
                            <div className="space-y-1">
                              <span className="text-[0.7rem] font-semibold uppercase tracking-wide text-amber-300">{aiHighlightsLabel}</span>
                              <ul className="space-y-1 text-xs text-amber-200">
                                {aiSuggestion.highlights.slice(0, 4).map((item) => (
                                  <li key={item}>{item}</li>
                                ))}
                              </ul>
                            </div>
                          ) : null}
                          <div className="p-3 text-sm whitespace-pre-wrap border rounded-lg border-slate-700/70 bg-slate-900/60 text-slate-100">
                            {aiSuggestion.message}
                          </div>
                          <div className="flex flex-wrap items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={handleApplyAiSuggestion}
                              className="inline-flex items-center gap-2 rounded-lg border border-emerald-400/40 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-emerald-200 transition hover:border-emerald-300/70 hover:bg-emerald-500/20"
                            >
                              {aiApplyLabel}
                            </button>
                            <button
                              type="button"
                              onClick={handleDismissAiSuggestion}
                              className="inline-flex items-center gap-2 rounded-lg border border-slate-700/60 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-300 transition hover:border-slate-500/70 hover:text-slate-100"
                            >
                              {aiDismissLabel}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={handleRequestAiSuggestion}
                          className="inline-flex items-center gap-2 rounded-lg border border-amber-400/40 bg-amber-500/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-amber-200 transition hover:border-amber-300/70 hover:bg-amber-500/20"
                        >
                          {t('ai.suggest.generate')}
                        </button>
                      )}
                    </div>,
                    portalTarget,
                  )
                : null}
                {showDockedSuggestion && portalTarget
                  ? createPortal(
                      <div className="fixed bottom-6 right-6 z-[4000] flex flex-col items-end gap-2">
                        <button
                          type="button"
                          onClick={handleDockedSuggestionFocus}
                          className="inline-flex items-center gap-2 px-3 py-2 text-xs font-semibold tracking-wide uppercase transition border rounded-lg shadow-lg border-slate-700/70 bg-slate-950/90 text-slate-100 shadow-slate-950/50 hover:border-slate-500/70 hover:text-slate-50"
                          aria-label={aiPreviewTitle}
                        >
                          {aiSuggestionLoading ? (
                            <>
                              <span
                                className="inline-flex w-3 h-3 border rounded-full animate-spin border-slate-600 border-t-amber-300"
                                aria-hidden="true"
                              />
                              <span>{aiLoadingLabel}</span>
                            </>
                          ) : suggestionFailed ? (
                            <>
                              <span className="inline-flex h-2.5 w-2.5 rounded-full bg-rose-400" aria-hidden="true" />
                              <span>{aiPreviewTitle}</span>
                            </>
                          ) : suggestionReady ? (
                            <>
                              <span className="relative inline-flex h-2.5 w-2.5" aria-hidden="true">
                                <span className="absolute inline-flex w-full h-full rounded-full animate-ping bg-emerald-400/60" />
                                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-400" />
                              </span>
                              <span>{aiApplyLabel}</span>
                            </>
                          ) : (
                            <>
                              <span className="inline-flex h-2.5 w-2.5 rounded-full bg-amber-300/80" aria-hidden="true" />
                              <span>{aiPreviewTitle}</span>
                            </>
                          )}
                        </button>
                        {suggestionReady && aiSuggestion?.summary ? (
                          <div className="max-w-xs px-3 py-2 text-xs border rounded-lg shadow border-slate-700/60 bg-slate-900/85 text-slate-300 shadow-slate-950/40">
                            <span className="font-semibold text-slate-100">{aiSummaryLabel}:</span>{' '}
                            <span className="block break-words text-slate-200">{aiSuggestion.summary}</span>
                          </div>
                        ) : null}
                        {suggestionFailed && aiSuggestionError ? (
                          <div className="max-w-xs px-3 py-2 text-xs border rounded-lg shadow border-rose-500/60 bg-rose-500/10 text-rose-200 shadow-rose-900/40">
                            {t('ai.suggest.error', { message: aiSuggestionError.message })}
                          </div>
                        ) : null}
                      </div>,
                      portalTarget,
                    )
                  : null}
            </label>
            <TemplatePicker
              t={t}
              templates={templates}
              loading={templatesLoading}
              error={templatesError}
              selectedTemplateId={selectedTemplateId}
              onSelect={(templateId) => {
                setSelectedTemplateId(templateId)
              }}
              onApply={(templateId) => {
                const template = templateMap.get(templateId)
                if (!template) {
                  return
                }
                setMessageBody(template.body)
                setSelectedTemplateId(templateId)
              }}
              onClear={() => setSelectedTemplateId(null)}
              onManage={handleOpenTemplateManager}
            />
            <div className="flex flex-col gap-2">
              <label className="flex flex-col gap-2 text-sm">
                <span className="font-semibold text-slate-200">{linkTypeLabel}</span>
                <div className="relative">
                  <select
                    value={linkMode}
                    onChange={(event) => setLinkMode(event.target.value)}
                    className="w-full px-3 py-2 pr-10 text-sm font-semibold transition border shadow-inner appearance-none rounded-xl border-slate-700/60 bg-slate-900/60 text-slate-100 shadow-slate-950/40 hover:border-slate-500/70 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/30"
                  >
                    {MODE_SEQUENCE.map((value) => (
                      <option key={value} value={value} className="bg-slate-900 text-slate-100">
                        {t(LINK_MODES[value].labelKey)}
                      </option>
                    ))}
                  </select>
                  <span className="absolute inset-y-0 flex items-center pointer-events-none right-3 text-slate-400">
                    <svg
                      aria-hidden="true"
                      className="w-3 h-3"
                      viewBox="0 0 12 8"
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <path d="M11 1.5 6 6.5 1 1.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                </div>
              </label>
              <p className="text-xs text-slate-400">{modeDetails.description}</p>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-3">
              <button
                type="button"
                className={BUTTON_PRIMARY}
                onClick={handleLaunch}
                disabled={recipientCount === 0}
              >
                {openTabsLabel}
              </button>
            </div>
            {lastLaunchReport ? (
              <div className="p-4 border rounded-xl border-slate-700/60 bg-slate-900/60">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-col">
                    <span className="text-sm font-semibold text-slate-100">{t('launcher.report.heading')}</span>
                    <span className="text-xs text-slate-400">
                      {t('launcher.report.timestamp', {
                        timestamp: formatTime(lastLaunchReport.timestamp),
                      })}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={handleReplayLaunch}
                      className="inline-flex items-center gap-1 rounded-lg border border-blue-400/40 bg-blue-500/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-blue-200 transition hover:border-blue-300/70 hover:bg-blue-500/20"
                    >
                      {t('launcher.report.openAll')}
                    </button>
                    <button
                      type="button"
                      onClick={handleClearLaunchReport}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-700/60 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-300 transition hover:border-slate-500/70 hover:text-slate-100"
                    >
                      {t('launcher.report.clear')}
                    </button>
                  </div>
                </div>
                <ul className="flex flex-col gap-2 mt-3">
                  {lastLaunchReport.attempts.map((attempt) => (
                    <li
                      key={`${attempt.phone}-${attempt.url}`}
                      className="flex flex-wrap items-center justify-between gap-3 px-3 py-2 border rounded-lg border-slate-700/50 bg-slate-900/50"
                    >
                      <div className="flex flex-col min-w-0 gap-1">
                        <span className="text-sm font-semibold text-slate-100">{formatPhone(attempt.phone)}</span>
                        {(() => {
                          const linkLabel = truncateLogMessage(attempt.url, 96)
                          return (
                            <a
                              href={attempt.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="block max-w-full overflow-hidden text-xs text-blue-300 underline text-ellipsis whitespace-nowrap"
                              title={attempt.url}
                            >
                              {linkLabel}
                            </a>
                          )
                        })()}
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`text-xs font-semibold uppercase tracking-wide ${
                            attempt.opened ? 'text-emerald-300' : 'text-rose-300'
                          }`}
                        >
                          {attempt.opened ? t('launcher.report.opened') : t('launcher.report.blocked')}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleOpenSingle(attempt.url)}
                          className="inline-flex items-center justify-center px-2 py-1 text-xs font-semibold tracking-wide uppercase transition border rounded-lg border-slate-700/60 text-slate-300 hover:border-slate-500/70 hover:text-slate-100"
                        >
                          {t('launcher.report.openOne')}
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </article>

          <ContactsPanel
            t={t}
            totalContacts={contactTotal}
            refreshToken={contactsRefreshToken}
            onOpenModal={handleOpenContactsModal}
            onSelectContact={handleAddContact}
            selectedPhones={preparedRecipients}
            className="xl:col-span-2 xl:self-stretch"
            onStatusChange={handleContactStatusChange}
            flaggedPhones={flaggedPhones}
            onFlagToggle={handleToggleContactFlag}
          />
        </div>

        <article className={`${CARD_BASE} gap-6`}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-100">{previewTitle}</h2>
              <p className="max-w-sm mt-2 text-sm text-slate-400">{modeDetails.helper}</p>
            </div>
            <span className="text-xs font-semibold tracking-wide uppercase text-slate-400">{previewSummary}</span>
          </div>

          <div className="p-4 border border-dashed rounded-2xl border-slate-600/50 bg-slate-900/60">
            <span className="text-[0.65rem] font-semibold uppercase tracking-[0.25em] text-slate-500">{messagePreviewLabel}</span>
            <p className="mt-2 text-sm whitespace-pre-wrap text-slate-100">{messagePreview}</p>
          </div>

          {previewLinks.length === 0 ? (
            <p className="text-sm text-slate-400">{emptyStateText}</p>
          ) : (
            <ul className="grid gap-4 p-0 list-none sm:grid-cols-2">
              {previewLinks.map(({ phone, url }) => (
                <li key={phone} className="flex flex-col gap-3 p-4 border rounded-xl border-slate-700/40 bg-slate-900/60">
                  <div className="flex flex-col gap-1">
                    <span className="text-base font-semibold text-slate-100">{formatPhone(phone)}</span>
                    <p className="text-xs break-all text-slate-400">{url}</p>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <a className={BUTTON_GHOST} href={url} target="_blank" rel="noopener noreferrer">
                      {openTabLabel}
                    </a>
                    <button type="button" className={BUTTON_SECONDARY} onClick={() => handleCopyLink(url)}>
                      {copyLinkLabel}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {previewMoreLabel ? <p className="text-xs text-slate-500">{previewMoreLabel}</p> : null}
        </article>
      </main>
      {importModalOpen
        ? renderModal(
            <div
              className={MODAL_OVERLAY}
              role="dialog"
              aria-modal="true"
              aria-label={t('contacts.import.title')}
              onClick={handleCloseImportModal}
            >
              <div
                className={`${MODAL_CONTENT_BASE} max-w-3xl`}
                onClick={(event) => event.stopPropagation()}
              >
                <button
                  type="button"
                  onClick={handleCloseImportModal}
                  className={`${MODAL_CLOSE_ICON_BUTTON} absolute right-4 top-4`}
                  aria-label={menuCloseLabel}
                >
                  ✕
                </button>
                <div className="-mr-1 max-h-[70vh] overflow-y-auto pr-1">
                  <ContactsImport t={t} onImportComplete={handleContactsImported} />
                </div>
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={handleCloseImportModal}
                    className={MODAL_CLOSE_PRIMARY_BUTTON}
                  >
                    {t('contacts.modal.close')}
                  </button>
                </div>
              </div>
            </div>,
          )
        : null}
      {logModalOpen
        ? renderModal(
            <div
              className={MODAL_OVERLAY}
              role="dialog"
              aria-modal="true"
              aria-label={logTitle}
              onClick={handleCloseLogModal}
            >
              <div
                className={`${MODAL_CONTENT_BASE} max-w-3xl`}
                onClick={(event) => event.stopPropagation()}
              >
                <button
                  type="button"
                  onClick={handleCloseLogModal}
                  className={`${MODAL_CLOSE_ICON_BUTTON} absolute right-4 top-4 z-10`}
                  aria-label={menuCloseLabel}
                >
                  ✕
                </button>
                <div className="flex flex-col gap-4 -mr-1 max-h-[70vh] overflow-y-auto pr-1">
                  <article className={`${CARD_BASE} gap-5`}>
                    <div className="flex flex-col">
                      <h2 className="text-lg font-semibold text-slate-100">{logTitle}</h2>
                    </div>
                    {statusLog.length === 0 ? (
                      <p className="text-sm text-slate-400">{t('log.empty')}</p>
                    ) : (
                      <ul className="flex flex-col gap-2 p-0 list-none">
                        {statusLog.map((entry) => (
                          <li
                            key={entry.id}
                            className={`grid grid-cols-[auto_1fr] items-start gap-3 rounded-xl border border-slate-700/40 bg-slate-900/60 px-3 py-2 text-sm shadow-sm border-l-4 ${LOG_LEVEL_STYLES[entry.level] || LOG_LEVEL_STYLES.info}`}
                          >
                            <span className="font-mono text-xs text-slate-400">{formatTime(entry.timestamp)}</span>
                            {(() => {
                              const fullMessage = (entry.message ?? '').replace(/\s+/g, ' ').trim()
                              const displayMessage = truncateLogMessage(fullMessage)
                              return (
                                <span className="min-w-0 text-sm text-slate-100">
                                  <span className="block break-words sm:overflow-hidden sm:text-ellipsis sm:whitespace-nowrap" title={fullMessage}>
                                    {displayMessage}
                                  </span>
                                </span>
                              )
                            })()}
                          </li>
                        ))}
                      </ul>
                    )}
                  </article>
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={handleCloseLogModal}
                      className={MODAL_CLOSE_PRIMARY_BUTTON}
                    >
                      {t('contacts.modal.close')}
                    </button>
                  </div>
                </div>
              </div>
            </div>,
          )
        : null}
      <ContactsModal
        t={t}
        open={contactsModalOpen}
        onClose={handleCloseContactsModal}
        refreshToken={contactsRefreshToken}
        totalContacts={contactTotal}
        onSelectContact={handleAddContact}
        selectedPhones={preparedRecipients}
        onStatusChange={handleContactStatusChange}
        onSyncContacts={() => {
          setContactsRefreshToken((token) => token + 1)
        }}
        flaggedPhones={flaggedPhones}
        onFlagToggle={handleToggleContactFlag}
      />
      <TemplateManagerModal
        t={t}
        open={templateManagerOpen}
        templates={templates}
        onClose={handleCloseTemplateManager}
        onSaved={handleTemplateSaved}
        onDeleted={handleTemplateDeleted}
      />
    </div>
  )
}

export default App
