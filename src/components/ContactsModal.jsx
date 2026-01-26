import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase, isSupabaseReady } from '../lib/supabaseClient.js'
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

async function fetchContacts({ statusFilter, search, showAll }) {
  const pageSize = showAll ? 1000 : 200
  let from = 0
  let to = pageSize - 1
  let allRows = []
  let total = null

  while (true) {
    let query = supabase
      .from('contacts')
      .select('id, full_name, phone, email, company, status, last_sent_at', { count: 'exact' })
      .order('full_name', { ascending: true })
      .range(from, to)

    if (statusFilter !== 'all') {
      query = query.eq('status', statusFilter)
    }

    if (search.trim()) {
      query = query.textSearch('search_vector', search.trim(), { type: 'websearch' })
    }

    const { data, error, count } = await query
    if (error) {
      return { data: [], error }
    }

    if (count !== null && total === null) {
      total = count
    }

    allRows = allRows.concat(data ?? [])

    if (!showAll) {
      break
    }

    if (!data || data.length < pageSize) {
      break
    }

    if (total !== null && allRows.length >= total) {
      break
    }

    from += pageSize
    to += pageSize
  }

  return { data: allRows, error: null, total }
}

export function ContactsModal({
  t,
  open,
  onClose,
  refreshToken,
  totalContacts,
  onSelectContact,
  selectedPhones = [],
  onSyncContacts,
  onStatusChange,
  flaggedPhones = [],
  onFlagToggle,
}) {
  const [statusFilter, setStatusFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [showAll, setShowAll] = useState(false)
  const [state, setState] = useState({ data: [], loading: false, error: null, total: null })
  const [localRefreshVersion, setLocalRefreshVersion] = useState(0)
  const debouncedSearch = useDebouncedValue(search, 300)
  const clickTimeoutRef = useRef(null)
  const togglingIdsRef = useRef(new Set())
  const hasPendingSyncRef = useRef(false)
  const wasOpenRef = useRef(open)
  const selectedSet = useMemo(() => {
    return new Set(
      (selectedPhones ?? [])
        .map((value) => extractDigits(value))
        .filter(Boolean),
    )
  }, [selectedPhones])
  const flaggedSet = useMemo(() => {
    return new Set(
      (flaggedPhones ?? [])
        .map((value) => extractDigits(value))
        .filter(Boolean),
    )
  }, [flaggedPhones])

  useEffect(() => {
    return () => {
      if (clickTimeoutRef.current) {
        clearTimeout(clickTimeoutRef.current)
        clickTimeoutRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    if (!open) {
      return
    }
    if (!isSupabaseReady()) {
      startTransition(() => {
        setState({ data: [], loading: false, error: new Error(t('contacts.modal.missingSupabase')), total: null })
      })
      return
    }

    let isCancelled = false
    startTransition(() => {
      setState((prev) => ({ ...prev, loading: true, error: null }))
    })

    const run = async () => {
      const result = await fetchContacts({ statusFilter, search: debouncedSearch, showAll })
      if (isCancelled) {
        return
      }
      if (result.error) {
        startTransition(() => {
          setState({ data: [], loading: false, error: result.error, total: null })
        })
      } else {
        startTransition(() => {
          setState({ data: result.data ?? [], loading: false, error: null, total: result.total })
        })
      }
    }

    run()

    return () => {
      isCancelled = true
    }
  }, [debouncedSearch, open, refreshToken, showAll, statusFilter, t, localRefreshVersion])

  useEffect(() => {
    if (!open) {
      startTransition(() => {
        setSearch('')
        setStatusFilter('all')
        setShowAll(false)
      })
    }
  }, [open])

  const visibleCount = state.data.length
  const effectiveTotal = typeof state.total === 'number' ? state.total : totalContacts ?? visibleCount

  const summaryLabel = useMemo(() => {
    if (state.loading) {
      return t('contacts.modal.loading')
    }
    if (state.error) {
      return t('contacts.modal.error', { message: state.error.message })
    }
    if (visibleCount === 0) {
      return t('contacts.modal.empty')
    }
    return t('contacts.modal.summary', { count: visibleCount, total: effectiveTotal })
  }, [effectiveTotal, state.error, state.loading, t, visibleCount])

  const interactive = typeof onSelectContact === 'function'
  const scheduleContactSelection = useCallback(
    (contact) => {
      if (!interactive) {
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
    [interactive, onSelectContact],
  )

  const handleToggleStatus = useCallback(
    async (contact) => {
      if (!contact?.id || !isSupabaseReady()) {
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

      const mergedContact = { ...contact, ...updatedContact }

      setState((prev) => ({
        ...prev,
        data: prev.data.map((item) => (item.id === contact.id ? { ...item, ...updatedContact } : item)),
      }))

      if (statusFilter !== 'all') {
        setLocalRefreshVersion((value) => value + 1)
      }

      hasPendingSyncRef.current = true

      if (typeof onStatusChange === 'function') {
        onStatusChange(mergedContact)
      }
    },
    [onStatusChange, statusFilter],
  )
  const handleFlagToggle = useCallback(
    (event, contact) => {
      event.preventDefault()
      event.stopPropagation()
      if (typeof onFlagToggle === 'function') {
        onFlagToggle(contact)
      }
    },
    [onFlagToggle],
  )
  useEffect(() => {
    const wasOpen = wasOpenRef.current
    wasOpenRef.current = open

    if (wasOpen && !open && hasPendingSyncRef.current) {
      hasPendingSyncRef.current = false
      if (typeof onSyncContacts === 'function') {
        onSyncContacts()
      }
    }
  }, [onSyncContacts, open])

  if (!open) {
    return null
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 px-4 py-8" role="dialog" aria-modal="true">
      <div className="relative flex w-full max-w-5xl flex-col gap-4 rounded-2xl border border-slate-700/60 bg-slate-900/95 p-6 shadow-2xl shadow-slate-950/60 backdrop-blur">
        <header className="flex flex-col gap-1">
          <h2 className="text-xl font-semibold text-slate-100">{t('contacts.modal.title')}</h2>
          <p className="text-sm text-slate-400">{t('contacts.modal.subtitle')}</p>
        </header>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex w-full items-center gap-2 rounded-xl border border-slate-700/60 bg-slate-900/60 px-3">
            <svg aria-hidden="true" className="h-4 w-4 text-slate-500" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M9 3.5a5.5 5.5 0 0 1 4.358 8.872l4.135 4.135a.75.75 0 0 1-1.061 1.06l-4.134-4.134A5.5 5.5 0 1 1 9 3.5Zm0 1.5a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z" fill="currentColor" />
            </svg>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t('contacts.searchPlaceholder')}
              className="w-full bg-transparent py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {STATUS_FILTERS.map((filter) => (
              <button
                key={filter.value}
                type="button"
                onClick={() => setStatusFilter(filter.value)}
                className={`rounded-lg px-3 py-1.5 text-[0.7rem] font-semibold uppercase tracking-wide transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${
                  statusFilter === filter.value
                    ? 'bg-blue-500/20 text-blue-200 focus-visible:outline-blue-400'
                    : 'border border-slate-700/60 bg-slate-900/60 text-slate-300 hover:border-slate-500/70 hover:text-slate-100 focus-visible:outline-slate-400'
                }`}
              >
                {t(filter.label)}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setShowAll((value) => !value)}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-700/60 px-3 py-1.5 text-[0.7rem] font-semibold uppercase tracking-wide text-slate-300 transition hover:border-slate-500/70 hover:text-slate-100"
            >
              <span className={`h-2 w-2 rounded-full ${showAll ? 'bg-emerald-400' : 'bg-slate-500'}`} />
              {showAll ? t('contacts.modal.showLimited') : t('contacts.modal.showAll')}
            </button>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">{summaryLabel}</span>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center justify-center rounded-lg border border-slate-700/60 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-300 transition hover:border-slate-500/70 hover:text-slate-100"
          >
            {t('contacts.modal.close')}
          </button>
        </div>
        <div className="max-h-[65vh] overflow-x-auto overflow-y-auto rounded-xl border border-slate-700/40">
          {state.loading ? (
            <div className="px-4 py-6 text-sm text-slate-400">{t('contacts.loading')}</div>
          ) : state.error ? (
            <div className="px-4 py-6 text-sm text-rose-300">{t('contacts.modal.error', { message: state.error.message })}</div>
          ) : state.data.length === 0 ? (
            <div className="px-4 py-6 text-sm text-slate-400">{t('contacts.modal.empty')}</div>
          ) : (
            <table className="min-w-full table-fixed divide-y divide-slate-800/60 text-left text-sm text-slate-100">
              <thead className="bg-slate-800/60 text-xs uppercase tracking-wide text-slate-300">
                <tr>
                  <th className="px-4 py-2 font-semibold">{t('contacts.columns.name')}</th>
                  <th className="px-4 py-2 font-semibold">{t('contacts.columns.company')}</th>
                  <th className="px-4 py-2 font-semibold">{t('contacts.columns.email')}</th>
                  <th className="px-4 py-2 font-semibold">{t('contacts.columns.phone')}</th>
                  <th className="px-4 py-2 font-semibold">{t('contacts.columns.status')}</th>
                  <th className="px-4 py-2 font-semibold text-right">{t('contacts.modal.lastSent')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50">
                {state.data.map((contact) => (
                  (() => {
                    const phoneDigits = extractDigits(contact.phone)
                    const isSelected = phoneDigits && selectedSet.has(phoneDigits)
                    const isFlagged = phoneDigits && flaggedSet.has(phoneDigits)
                    const rowClass = isSelected
                      ? 'bg-blue-500/10 ring-1 ring-inset ring-blue-400/50'
                      : 'bg-slate-900/60 hover:bg-slate-800/60'
                    return (
                      <tr
                        key={contact.id}
                        className={`transition-colors ${rowClass} ${interactive ? 'cursor-pointer' : ''}`}
                        onClick={() => {
                          scheduleContactSelection(contact)
                        }}
                        onDoubleClick={() => handleToggleStatus(contact)}
                        onKeyDown={(event) => {
                          if (!interactive) {
                            return
                          }
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault()
                            onSelectContact(contact)
                          }
                        }}
                        role={interactive ? 'button' : undefined}
                        tabIndex={interactive ? 0 : undefined}
                        aria-pressed={interactive ? isSelected : undefined}
                      >
                        <td className="px-4 py-2 font-semibold text-slate-100 break-words">{contact.full_name}</td>
                        <td className="px-4 py-2 text-slate-300 break-words">{contact.company || '—'}</td>
                        <td className="px-4 py-2 text-slate-300 break-words">{contact.email || '—'}</td>
                        <td className="px-4 py-2 text-slate-300">
                          <div className="group/phone flex items-center gap-2">
                            <span className="break-words">{contact.phone || '—'}</span>
                            {contact.phone ? (
                              <button
                                type="button"
                                onClick={(event) => handleFlagToggle(event, contact)}
                                aria-pressed={isFlagged}
                                aria-label={isFlagged ? t('contacts.flag.remove') : t('contacts.flag.add')}
                                className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[0.7rem] transition ${
                                  isFlagged
                                    ? 'border border-amber-300/60 bg-amber-400/10 text-amber-300 opacity-100 shadow-[0_0_6px_rgba(251,191,36,0.25)]'
                                    : 'border border-transparent text-slate-500/0 opacity-0 group-hover/phone:text-slate-400/90 group-hover/phone:opacity-100 hover:text-amber-300 hover:opacity-100'
                                }`}
                              >
                                🚩
                              </button>
                            ) : null}
                          </div>
                        </td>
                        <td className="px-4 py-2 text-slate-300 break-words">
                          <span className="inline-flex items-center gap-2">
                            <span className={`h-2.5 w-2.5 rounded-full ${contact.status === 'green' ? 'bg-emerald-400' : 'bg-rose-400'}`} />
                            <span className="text-xs uppercase tracking-wide text-slate-300">
                              {contact.status === 'green' ? t('contacts.statusLabels.green') : t('contacts.statusLabels.red')}
                            </span>
                          </span>
                        </td>
                        <td className="px-4 py-2 text-right text-slate-300">
                          {contact.last_sent_at ? new Date(contact.last_sent_at).toLocaleString() : '—'}
                        </td>
                      </tr>
                    )
                  })()
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
