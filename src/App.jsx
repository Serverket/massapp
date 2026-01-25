import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from './i18n/useTranslation.js'
import { fetchTemplates, recordContactSends, recordSendMetrics } from './lib/storage.js'
import { isSupabaseReady, supabase } from './lib/supabaseClient.js'
import { useSupabaseHealth } from './lib/useSupabaseHealth.js'
import { useSupabaseAuth } from './lib/useSupabaseAuth.js'
import { ContactsImport } from './components/ContactsImport.jsx'
import { ContactsPanel } from './components/ContactsPanel.jsx'
import { TemplatePicker } from './components/TemplatePicker.jsx'
import { LoginForm } from './components/LoginForm.jsx'
import { TemplateManagerModal } from './components/TemplateManagerModal.jsx'
import { ContactsModal } from './components/ContactsModal.jsx'

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
  'inline-flex h-9 items-center justify-center rounded-lg border border-slate-600/60 bg-slate-900/60 px-3 text-xs font-semibold uppercase tracking-wide text-slate-200 transition hover:border-slate-400/60 hover:bg-slate-800/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-400 sm:text-sm'

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

  const recipientCount = preparedRecipients.length

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

  const languageTarget = locale === 'en' ? 'es' : 'en'
  const languageButtonLabel = languageTarget === 'es' ? t('actions.switchToSpanish') : t('actions.switchToEnglish')
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
      <header className="flex flex-col gap-6 pb-6 border-b border-slate-800/60">
        <div className="flex items-center gap-3 sm:gap-4">
          <img
            src="/massapp-logo.svg"
            alt={appTitle}
            className="w-12 h-12 p-2 border shadow-lg rounded-2xl border-slate-700/60 bg-slate-900/70 shadow-slate-950/50"
          />
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{appTitle}</h1>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              className={`${LANGUAGE_BUTTON} w-full max-w-xs sm:w-auto sm:max-w-none`}
              onClick={handleToggleLocale}
            >
              {languageButtonLabel}
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

      <main className="mt-8 flex flex-col gap-8">
        <div className="grid gap-6 lg:grid-cols-2 xl:grid-cols-4 xl:items-stretch">
          <article className={`${CARD_BASE} gap-6 xl:col-span-2 xl:self-start`}>
            <div className="flex flex-col gap-1.5">
              <h2 className="text-xl font-semibold text-slate-100">{launcherTitle}</h2>
              <p className="text-sm text-slate-400">{launcherDescription}</p>
            </div>
            <label className="flex flex-col gap-2 text-sm">
              <span className="font-semibold text-slate-200">{recipientsLabel}</span>
              <textarea
                value={recipientInput}
                onChange={(event) => setRecipientInput(event.target.value)}
                placeholder={recipientsPlaceholder}
                rows={4}
                className="w-full min-h-[6.5rem] max-h-60 resize-none overflow-y-auto rounded-xl border border-slate-700/60 bg-slate-900/60 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/30"
              />
            </label>
            <label className="flex flex-col gap-2 text-sm">
              <span className="font-semibold text-slate-200">{messageLabel}</span>
              <textarea
                value={messageBody}
                onChange={(event) => {
                  const nextValue = event.target.value
                  setMessageBody(nextValue)
                  if (selectedTemplateId) {
                    const template = templateMap.get(selectedTemplateId)
                    if (!template || template.body !== nextValue) {
                      setSelectedTemplateId(null)
                    }
                  }
                }}
                placeholder={messagePlaceholder}
                rows={6}
                className="min-h-[9rem] rounded-xl border border-slate-700/60 bg-slate-900/60 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/30"
              />
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
              <button type="button" className={BUTTON_PRIMARY} onClick={handleLaunch}>
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
                              className="block max-w-full overflow-hidden text-ellipsis whitespace-nowrap text-xs text-blue-300 underline"
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

        <ContactsImport t={t} onImportComplete={handleContactsImported} />

        <article className={`${CARD_BASE} gap-5`}>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-baseline sm:justify-between">
            <h2 className="text-lg font-semibold text-slate-100">{logTitle}</h2>
          </div>
          <ul className="flex flex-col gap-2 p-0 overflow-y-auto list-none max-h-72 md:max-h-80">
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
        </article>
      </main>
      <ContactsModal
        t={t}
        open={contactsModalOpen}
        onClose={handleCloseContactsModal}
        refreshToken={contactsRefreshToken}
        totalContacts={contactTotal}
        onSelectContact={handleAddContact}
        selectedPhones={preparedRecipients}
        onSyncContacts={() => {
          setContactsRefreshToken((token) => token + 1)
        }}
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
