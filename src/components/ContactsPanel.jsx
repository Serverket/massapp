import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { isSupabaseReady, supabase } from '../lib/supabaseClient.js'
import { toggleContactDeliveryStatus } from '../lib/storage.js'

const STATUS_FILTERS = [
  { value: 'all', label: 'contacts.filters.all' },
  { value: 'green', label: 'contacts.filters.green' },
  { value: 'red', label: 'contacts.filters.red' },
]

function extractDigits(value) {
  if (!value) {
    return ''
  }
  return value.toString().replace(/\D/g, '')
}

function useDebouncedValue(value, delayMs) {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const handle = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(handle)
  }, [value, delayMs])

  return debounced
}

export function ContactsPanel({
  t,
  totalContacts,
  refreshToken,
  onOpenModal,
  onSelectContact,
  selectedPhones = [],
  className = '',
}) {
  const [statusFilter, setStatusFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [state, setState] = useState({ data: [], loading: true, error: null })
  const [localRefreshVersion, setLocalRefreshVersion] = useState(0)
  const debouncedSearch = useDebouncedValue(search, 300)
  const clickTimeoutRef = useRef(null)
  const togglingIdsRef = useRef(new Set())

  const isDisabled = !isSupabaseReady()
  const selectedSet = useMemo(() => {
    return new Set(
      (selectedPhones ?? [])
        .map((value) => extractDigits(value))
        .filter(Boolean),
    )
  }, [selectedPhones])

  useEffect(() => {
    return () => {
      if (clickTimeoutRef.current) {
        clearTimeout(clickTimeoutRef.current)
        clickTimeoutRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    if (isDisabled) {
      startTransition(() => {
        setState({ data: [], loading: false, error: new Error(t('contacts.missingSupabase')) })
      })
      return
    }

    let isCancelled = false
    startTransition(() => {
      setState((prev) => ({ ...prev, loading: true, error: null }))
    })

    const run = async () => {
      let query = supabase
        .from('contacts')
        .select('id, full_name, phone, email, company, status, last_sent_at')
        .order('full_name', { ascending: true })
        .limit(200)

      if (statusFilter !== 'all') {
        query = query.eq('status', statusFilter)
      }

      if (debouncedSearch.trim()) {
        query = query.textSearch('search_vector', debouncedSearch.trim(), { type: 'websearch' })
      }

      const { data, error } = await query

      if (!isCancelled) {
        if (error) {
          startTransition(() => {
            setState({ data: [], loading: false, error })
          })
        } else {
          startTransition(() => {
            setState({ data: data ?? [], loading: false, error: null })
          })
        }
      }
    }

    run()

    return () => {
      isCancelled = true
    }
  }, [debouncedSearch, statusFilter, isDisabled, refreshToken, t, localRefreshVersion])
  const scheduleContactSelection = useCallback(
    (contact) => {
      if (typeof onSelectContact !== 'function') {
        return
      }

      if (clickTimeoutRef.current) {
        clearTimeout(clickTimeoutRef.current)
      }

      clickTimeoutRef.current = setTimeout(() => {
        clickTimeoutRef.current = null
        onSelectContact(contact)
      }, 220)
    },
    [onSelectContact],
  )

  const handleToggleStatus = useCallback(
    async (contact) => {
      if (isDisabled || !contact?.id) {
        return
      }

      if (clickTimeoutRef.current) {
        clearTimeout(clickTimeoutRef.current)
        clickTimeoutRef.current = null
      }

      if (togglingIdsRef.current.has(contact.id)) {
        return
      }

      const previousStatus = contact.status
      const previousLastSentAt = contact.last_sent_at ?? null

      togglingIdsRef.current.add(contact.id)

      const optimisticStatus = previousStatus === 'green' ? 'red' : 'green'
      const optimisticLastSentAt = optimisticStatus === 'green' ? new Date().toISOString() : null

      setState((prev) => ({
        ...prev,
        data: prev.data.map((item) =>
          item.id === contact.id
            ? { ...item, status: optimisticStatus, last_sent_at: optimisticLastSentAt }
            : item,
        ),
      }))

      const { data: updatedContact, error } = await toggleContactDeliveryStatus({
        contactId: contact.id,
        currentStatus: previousStatus,
      })

      togglingIdsRef.current.delete(contact.id)

      if (error || !updatedContact) {
        setState((prev) => ({
          ...prev,
          data: prev.data.map((item) =>
            item.id === contact.id
              ? { ...item, status: previousStatus, last_sent_at: previousLastSentAt }
              : item,
          ),
        }))
        console.error('Failed to toggle contact status', error)
        return
      }

      setState((prev) => ({
        ...prev,
        data: prev.data.map((item) => (item.id === contact.id ? { ...item, ...updatedContact } : item)),
      }))

      if (statusFilter !== 'all') {
        setLocalRefreshVersion((value) => value + 1)
      }
    },
    [isDisabled, statusFilter],
  )

  const { data, loading, error } = state

  const statusSummary = useMemo(() => {
    if (loading) {
      return t('contacts.status.loading')
    }
    if (error) {
      return t('contacts.status.error')
    }
    const visibleCount = data.length
    const hasTotal = typeof totalContacts === 'number'

    if (visibleCount === 0) {
      if (hasTotal && totalContacts > 0) {
        return t('contacts.status.countWithTotal', { count: visibleCount, total: totalContacts })
      }
      return t('contacts.status.empty')
    }

    if (hasTotal) {
      return t('contacts.status.countWithTotal', { count: visibleCount, total: totalContacts })
    }

    return t('contacts.status.count', { count: visibleCount })
  }, [data.length, error, loading, t, totalContacts])

  return (
    <article className={`flex h-full min-h-0 flex-col gap-5 overflow-hidden rounded-2xl border border-slate-700/40 bg-slate-900/70 p-6 shadow-lg shadow-slate-950/50 ${className}`}>
      <header className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-col gap-1.5">
          <h2 className="text-lg font-semibold text-slate-100">{t('contacts.title')}</h2>
          <p className="text-sm text-slate-400">{t('contacts.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold tracking-wide uppercase text-slate-400">{statusSummary}</span>
          <button
            type="button"
            onClick={onOpenModal}
            disabled={!onOpenModal}
            className="inline-flex items-center justify-center rounded-lg border border-slate-700/60 px-2.5 py-1 text-[0.7rem] font-semibold uppercase tracking-wide text-slate-300 transition hover:border-slate-500/70 hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t('contacts.modal.openButton')}
          </button>
        </div>
      </header>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="flex items-center w-full gap-2 px-3 border rounded-xl border-slate-700/60 bg-slate-900/60">
          <svg
            aria-hidden="true"
            className="w-4 h-4 text-slate-500"
            viewBox="0 0 20 20"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M9 3.5a5.5 5.5 0 0 1 4.358 8.872l4.135 4.135a.75.75 0 0 1-1.061 1.06l-4.134-4.134A5.5 5.5 0 1 1 9 3.5Zm0 1.5a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z"
              fill="currentColor"
            />
          </svg>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('contacts.searchPlaceholder')}
            className="w-full py-2 text-sm bg-transparent text-slate-100 placeholder:text-slate-500 focus:outline-none"
          />
        </div>
        <div className="flex gap-2 flex-nowrap">
          {STATUS_FILTERS.map((filter) => (
            <button
              key={filter.value}
              type="button"
              onClick={() => setStatusFilter(filter.value)}
              className={`rounded-lg px-3 py-2 text-xs font-semibold uppercase tracking-wide transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${
                statusFilter === filter.value
                  ? 'bg-blue-500/20 text-blue-200 focus-visible:outline-blue-400'
                  : 'border border-slate-700/60 bg-slate-900/60 text-slate-300 hover:border-slate-500/70 hover:text-slate-100 focus-visible:outline-slate-400'
              }`}
            >
              {t(filter.label)}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col flex-1 min-h-0 overflow-hidden border rounded-xl border-slate-700/40">
        <div className="hidden bg-slate-800/60 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-300 md:grid md:grid-cols-[1.15fr_1fr_1fr_0.9fr_0.6fr]">
          <span>{t('contacts.columns.name')}</span>
          <span>{t('contacts.columns.company')}</span>
          <span>{t('contacts.columns.email')}</span>
          <span>{t('contacts.columns.phone')}</span>
          <span>{t('contacts.columns.status')}</span>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto pt-3 pb-2 max-h-[28rem] md:max-h-[32rem] md:py-0">
          {state.loading ? (
            <div className="px-4 py-6 text-sm text-slate-400">{t('contacts.loading')}</div>
          ) : state.error ? (
            <div className="px-4 py-6 text-sm text-rose-300">{t('contacts.error', { message: state.error.message })}</div>
          ) : state.data.length === 0 ? (
            <div className="px-4 py-6 text-sm text-slate-400">{t('contacts.empty')}</div>
          ) : (
            <ul className="divide-y divide-slate-800/60">
              {state.data.map((contact) => (
                <li key={contact.id} className="px-1 py-1">
                  {(() => {
                    const phoneDigits = extractDigits(contact.phone)
                    const isSelected = phoneDigits && selectedSet.has(phoneDigits)
                    const interactive = typeof onSelectContact === 'function'
                    return (
                      <button
                        type="button"
                        onClick={() => {
                          if (interactive) {
                            scheduleContactSelection(contact)
                          }
                        }}
                        onDoubleClick={() => handleToggleStatus(contact)}
                        className={`grid w-full gap-3 rounded-lg border px-4 py-3 text-left text-sm transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400 md:grid-cols-[1.15fr_1fr_1fr_0.9fr_0.6fr] ${
                          interactive ? 'cursor-pointer' : 'cursor-default'
                        } ${
                          isSelected
                            ? 'border-blue-400/60 bg-blue-500/10 text-slate-100'
                            : 'border-transparent bg-slate-900/60 text-slate-200 hover:border-slate-600/70 hover:bg-slate-800/60'
                        }`}
                        aria-pressed={interactive ? isSelected : undefined}
                      >
                        <span className="min-w-0 break-words md:truncate" title={contact.full_name}>
                          <span className="block text-xs font-semibold uppercase text-slate-400 md:hidden">{t('contacts.columns.name')}</span>
                          {contact.full_name}
                        </span>
                        <span className="min-w-0 break-words md:truncate" title={contact.company || ''}>
                          <span className="block text-xs font-semibold uppercase text-slate-400 md:hidden">{t('contacts.columns.company')}</span>
                          {contact.company || '—'}
                        </span>
                        <span className="min-w-0 break-words md:truncate" title={contact.email || ''}>
                          <span className="block text-xs font-semibold uppercase text-slate-400 md:hidden">{t('contacts.columns.email')}</span>
                          {contact.email || '—'}
                        </span>
                        <span className="min-w-0 break-words md:truncate" title={contact.phone || ''}>
                          <span className="block text-xs font-semibold uppercase text-slate-400 md:hidden">{t('contacts.columns.phone')}</span>
                          {contact.phone || '—'}
                        </span>
                        <span className="flex items-center gap-2">
                          <span className="block text-xs font-semibold uppercase text-slate-400 md:hidden">{t('contacts.columns.status')}</span>
                          <span
                            className={`h-2.5 w-2.5 rounded-full ${
                              contact.status === 'green' ? 'bg-emerald-400' : 'bg-rose-400'
                            }`}
                          />
                          <span className="text-xs tracking-wide uppercase text-slate-300">
                            {contact.status === 'green'
                              ? t('contacts.statusLabels.green')
                              : t('contacts.statusLabels.red')}
                          </span>
                        </span>
                      </button>
                    )
                  })()}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <p className="text-xs text-slate-500">{t('contacts.hint')}</p>
    </article>
  )
}
