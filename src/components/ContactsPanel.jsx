import { useEffect, useMemo, useState } from 'react'
import { isSupabaseReady, supabase } from '../lib/supabaseClient.js'

const STATUS_FILTERS = [
  { value: 'all', label: 'contacts.filters.all' },
  { value: 'green', label: 'contacts.filters.green' },
  { value: 'red', label: 'contacts.filters.red' },
]

function useDebouncedValue(value, delayMs) {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const handle = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(handle)
  }, [value, delayMs])

  return debounced
}

export function ContactsPanel({ t, totalContacts, refreshToken, onOpenModal }) {
  const [statusFilter, setStatusFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [state, setState] = useState({ data: [], loading: true, error: null })
  const debouncedSearch = useDebouncedValue(search, 300)

  const isDisabled = !isSupabaseReady()

  useEffect(() => {
    if (isDisabled) {
      setState({ data: [], loading: false, error: new Error('Supabase is not configured') })
      return
    }

    let isCancelled = false
    setState((prev) => ({ ...prev, loading: true, error: null }))

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
          setState({ data: [], loading: false, error })
        } else {
          setState({ data: data ?? [], loading: false, error: null })
        }
      }
    }

    run()

    return () => {
      isCancelled = true
    }
  }, [debouncedSearch, statusFilter, isDisabled, refreshToken])

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
    <article className="flex flex-col gap-5 rounded-2xl border border-slate-700/40 bg-slate-900/70 p-6 shadow-lg shadow-slate-950/50">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-col gap-1.5">
          <h2 className="text-lg font-semibold text-slate-100">{t('contacts.title')}</h2>
          <p className="text-sm text-slate-400">{t('contacts.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">{statusSummary}</span>
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
        <div className="flex w-full items-center gap-2 rounded-xl border border-slate-700/60 bg-slate-900/60 px-3">
          <svg
            aria-hidden="true"
            className="h-4 w-4 text-slate-500"
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
            className="w-full bg-transparent py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none"
          />
        </div>
        <div className="flex flex-nowrap gap-2">
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

      <div className="overflow-hidden rounded-xl border border-slate-700/40">
        <div className="grid grid-cols-[1.15fr_1fr_1fr_0.9fr_0.6fr] bg-slate-800/60 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-300">
          <span>{t('contacts.columns.name')}</span>
          <span>{t('contacts.columns.company')}</span>
          <span>{t('contacts.columns.email')}</span>
          <span>{t('contacts.columns.phone')}</span>
          <span>{t('contacts.columns.status')}</span>
        </div>
        <div className="max-h-80 overflow-y-auto">
          {state.loading ? (
            <div className="px-4 py-6 text-sm text-slate-400">{t('contacts.loading')}</div>
          ) : state.error ? (
            <div className="px-4 py-6 text-sm text-rose-300">{t('contacts.error', { message: state.error.message })}</div>
          ) : state.data.length === 0 ? (
            <div className="px-4 py-6 text-sm text-slate-400">{t('contacts.empty')}</div>
          ) : (
            <ul className="divide-y divide-slate-800/60">
              {state.data.map((contact) => (
                <li key={contact.id} className="grid grid-cols-[1.15fr_1fr_1fr_0.9fr_0.6fr] items-center gap-3 px-4 py-3 text-sm text-slate-200">
                  <span className="truncate" title={contact.full_name}>{contact.full_name}</span>
                  <span className="truncate" title={contact.company || ''}>{contact.company || '—'}</span>
                  <span className="truncate" title={contact.email || ''}>{contact.email || '—'}</span>
                  <span className="truncate" title={contact.phone || ''}>{contact.phone || '—'}</span>
                  <span className="flex items-center gap-2">
                    <span
                      className={`h-2.5 w-2.5 rounded-full ${
                        contact.status === 'green' ? 'bg-emerald-400' : 'bg-rose-400'
                      }`}
                    />
                    <span className="text-xs uppercase tracking-wide text-slate-300">
                      {contact.status === 'green'
                        ? t('contacts.statusLabels.green')
                        : t('contacts.statusLabels.red')}
                    </span>
                  </span>
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
