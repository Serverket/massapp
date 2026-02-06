import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Papa from 'papaparse'
import { supabase, isSupabaseReady } from '../lib/supabaseClient.js'
import { toggleContactDeliveryStatus, updateContact } from '../lib/storage.js'
import { ContactDeleteModal } from './ContactDeleteModal.jsx'
import { MODAL_CLOSE_ICON_BUTTON, MODAL_CLOSE_PRIMARY_BUTTON, MODAL_CONTENT_BASE, MODAL_OVERLAY } from '../lib/uiStyles.js'

const STATUS_FILTERS = [
  { value: 'all', label: 'contacts.filters.all' },
  { value: 'green', label: 'contacts.filters.green' },
  { value: 'red', label: 'contacts.filters.red' },
]

const EMPTY_EDIT_DRAFT = {
  full_name: '',
  phone: '',
  email: '',
  company: '',
}

function normalizeField(value) {
  if (typeof value !== 'string') {
    return ''
  }
  return value.trim()
}

function persistable(value) {
  const trimmed = normalizeField(value)
  return trimmed.length > 0 ? trimmed : null
}

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
      .select('id, full_name, phone, email, company, status, last_sent_at, is_flagged', { count: 'exact' })
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
  const [exporting, setExporting] = useState(false)
  const [exportStatus, setExportStatus] = useState(null)
  const debouncedSearch = useDebouncedValue(search, 300)
  const clickTimeoutRef = useRef(null)
  const togglingIdsRef = useRef(new Set())
  const hasPendingSyncRef = useRef(false)
  const wasOpenRef = useRef(open)
  const menuRef = useRef(null)
  const menuLongPressRef = useRef(null)
  const skipClickRef = useRef(false)
  const [menuContactId, setMenuContactId] = useState(null)
  const [editingContact, setEditingContact] = useState(null)
  const [editingDraft, setEditingDraft] = useState(null)
  const [editingStatus, setEditingStatus] = useState(null)
  const [editingSaving, setEditingSaving] = useState(false)
  const [deleteContactTarget, setDeleteContactTarget] = useState(null)
  const [dateSortDirection, setDateSortDirection] = useState('desc')
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

  const sortedData = useMemo(() => {
    const contacts = state.data ?? []
    const parseTimestamp = (value) => {
      if (!value) {
        return null
      }
      const parsed = Date.parse(value)
      return Number.isFinite(parsed) ? parsed : null
    }

    return [...contacts].sort((a, b) => {
      const aTime = parseTimestamp(a.last_sent_at)
      const bTime = parseTimestamp(b.last_sent_at)

      if (aTime === bTime) {
        return 0
      }

      if (aTime === null) {
        return 1
      }
      if (bTime === null) {
        return -1
      }
      return dateSortDirection === 'asc' ? aTime - bTime : bTime - aTime
    })
  }, [dateSortDirection, state.data])

  const activeMenuContact = useMemo(() => {
    if (!menuContactId) {
      return null
    }
    return sortedData.find((item) => item.id === menuContactId) ?? null
  }, [menuContactId, sortedData])

  useEffect(() => {
    if (!menuContactId) {
      return
    }

    const handlePointerDown = (event) => {
      if (menuRef.current && menuRef.current.contains(event.target)) {
        return
      }
      setMenuContactId(null)
    }

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setMenuContactId(null)
      }
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [menuContactId])

  useEffect(() => {
    return () => {
      if (clickTimeoutRef.current) {
        clearTimeout(clickTimeoutRef.current)
        clickTimeoutRef.current = null
      }
      if (menuLongPressRef.current) {
        clearTimeout(menuLongPressRef.current)
        menuLongPressRef.current = null
      }
      skipClickRef.current = false
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
      setExportStatus(null)
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
        setExportStatus(null)
      })
    }
  }, [open])

  const visibleCount = sortedData.length
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

  const toggleDateSortDirection = useCallback(() => {
    setDateSortDirection((previous) => (previous === 'asc' ? 'desc' : 'asc'))
  }, [])

  const interactive = typeof onSelectContact === 'function'
  const scheduleContactSelection = useCallback(
    (contact) => {
      if (!interactive) {
        return
      }

      if (skipClickRef.current) {
        skipClickRef.current = false
        return
      }

      if (clickTimeoutRef.current) {
        clearTimeout(clickTimeoutRef.current)
        clickTimeoutRef.current = null
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
  const clearLongPressTimer = useCallback(() => {
    if (menuLongPressRef.current) {
      clearTimeout(menuLongPressRef.current)
      menuLongPressRef.current = null
    }
  }, [])

  const closeActionMenu = useCallback(() => {
    if (menuContactId) {
      setMenuContactId(null)
    }
    skipClickRef.current = false
  }, [menuContactId])

  const beginInlineEdit = useCallback((contact) => {
    if (!contact) {
      return
    }
    setEditingContact(contact)
    setEditingDraft({
      full_name: normalizeField(contact.full_name) || '',
      phone: normalizeField(contact.phone) || '',
      email: normalizeField(contact.email) || '',
      company: normalizeField(contact.company) || '',
    })
    setEditingStatus(null)
    setEditingSaving(false)
  }, [])

  const openActionMenu = useCallback(
    (contact) => {
      if (!contact) {
        return
      }
      clearLongPressTimer()
      if (clickTimeoutRef.current) {
        clearTimeout(clickTimeoutRef.current)
        clickTimeoutRef.current = null
      }
      skipClickRef.current = true
      setMenuContactId(contact.id)
    },
    [clearLongPressTimer],
  )

  const handleMenuTrigger = useCallback(
    (event, contact) => {
      event.preventDefault()
      event.stopPropagation()
      openActionMenu(contact)
    },
    [openActionMenu],
  )

  const handleContextMenu = useCallback(
    (event, contact) => {
      event.preventDefault()
      openActionMenu(contact)
    },
    [openActionMenu],
  )

  const handlePointerDownForMenu = useCallback(
    (event, contact) => {
      if (event.pointerType === 'mouse' && event.button !== 0) {
        return
      }
      clearLongPressTimer()
      menuLongPressRef.current = setTimeout(() => {
        openActionMenu(contact)
      }, 550)
    },
    [clearLongPressTimer, openActionMenu],
  )

  const handlePointerClear = useCallback(() => {
    clearLongPressTimer()
  }, [clearLongPressTimer])

  const handleMenuToggleStatus = useCallback(() => {
    if (!activeMenuContact) {
      return
    }
    closeActionMenu()
    handleToggleStatus(activeMenuContact)
  }, [activeMenuContact, closeActionMenu, handleToggleStatus])

  const handleMenuEdit = useCallback(() => {
    if (!activeMenuContact) {
      return
    }
    beginInlineEdit(activeMenuContact)
    closeActionMenu()
  }, [activeMenuContact, beginInlineEdit, closeActionMenu])

  const handleMenuDelete = useCallback(() => {
    if (!activeMenuContact) {
      return
    }
    setDeleteContactTarget(activeMenuContact)
    closeActionMenu()
  }, [activeMenuContact, closeActionMenu])

  const handleEditCancel = useCallback(() => {
    setEditingContact(null)
    setEditingDraft(null)
    setEditingStatus(null)
    setEditingSaving(false)
  }, [])

  const handleEditInputChange = useCallback((field) => (event) => {
    const { value } = event.target
    setEditingDraft((previous) => ({
      ...(previous ?? EMPTY_EDIT_DRAFT),
      [field]: value,
    }))
  }, [])

  const handleDeleteClose = useCallback(() => {
    setDeleteContactTarget(null)
  }, [])

  const applyContactPatch = useCallback(
    (contactId, patch) => {
      setState((previous) => ({
        ...previous,
        data: previous.data.map((item) => (item.id === contactId ? { ...item, ...patch } : item)),
      }))
      setLocalRefreshVersion((value) => value + 1)
      hasPendingSyncRef.current = true
      if (typeof onSyncContacts === 'function') {
        onSyncContacts()
        hasPendingSyncRef.current = false
      }
    },
    [onSyncContacts],
  )

  const handleEditSubmit = useCallback(async (event) => {
    event.preventDefault()
    if (!editingContact || !editingDraft) {
      return
    }

    const name = normalizeField(editingDraft.full_name)
    if (name.length === 0) {
      setEditingStatus({ type: 'error', message: t('contacts.edit.validation.name') })
      return
    }

    const phone = normalizeField(editingDraft.phone)
    const email = normalizeField(editingDraft.email)
    if (phone.length === 0 && email.length === 0) {
      setEditingStatus({ type: 'error', message: t('contacts.edit.validation.contact') })
      return
    }

    const payload = {
      full_name: name,
      phone: persistable(editingDraft.phone),
      email: persistable(editingDraft.email),
      company: persistable(editingDraft.company),
    }

    setEditingSaving(true)
    setEditingStatus({ type: 'info', message: t('contacts.edit.saving') })

    const { data: updatedContact, error } = await updateContact(editingContact.id, payload)

    if (error) {
      setEditingSaving(false)
      setEditingStatus({ type: 'error', message: t('contacts.edit.error', { message: error.message }) })
      return
    }

    const nextContact = updatedContact ?? { ...editingContact, ...payload }
    applyContactPatch(editingContact.id, nextContact)
    setEditingSaving(false)
    setEditingStatus(null)
    setEditingDraft(null)
    setEditingContact(null)
  }, [applyContactPatch, editingContact, editingDraft, t])

  const handleContactDeleted = useCallback(
    (removedContact) => {
      setDeleteContactTarget(null)
      if (!removedContact) {
        return
      }
      setState((previous) => ({
        ...previous,
        data: previous.data.filter((item) => item.id !== removedContact.id),
      }))
      setLocalRefreshVersion((value) => value + 1)
      hasPendingSyncRef.current = true
      if (typeof onSyncContacts === 'function') {
        onSyncContacts()
        hasPendingSyncRef.current = false
      }
    },
    [onSyncContacts],
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

  const handleExport = useCallback(async () => {
    if (!isSupabaseReady() || exporting) {
      return
    }

    setExportStatus(null)
    setExporting(true)

    try {
      const result = await fetchContacts({ statusFilter, search: debouncedSearch, showAll: true })
      if (result.error) {
        throw result.error
      }

      const rows = result.data ?? []

      if (rows.length === 0) {
        setExportStatus({ type: 'info', message: t('contacts.modal.export.empty') })
        return
      }

      const headers = [
        t('contacts.columns.name'),
        t('contacts.columns.company'),
        t('contacts.columns.email'),
        t('contacts.columns.phone'),
        t('contacts.columns.status'),
        t('contacts.modal.lastSent'),
      ]

      const dataRows = rows.map((contact) => [
        contact.full_name ?? '',
        contact.company ?? '',
        contact.email ?? '',
        contact.phone ?? '',
        contact.status === 'green' ? t('contacts.statusLabels.green') : t('contacts.statusLabels.red'),
        contact.last_sent_at ? new Date(contact.last_sent_at).toISOString() : '',
      ])

      const csv = Papa.unparse({ fields: headers, data: dataRows })
      const blob = new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      const link = document.createElement('a')
      link.href = url
      link.download = `massapp-contacts-${timestamp}.csv`
      document.body.append(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)

      setExportStatus({ type: 'success', message: t('contacts.modal.export.success', { count: rows.length }) })
    } catch (error) {
      const message = error && typeof error === 'object' && typeof error.message === 'string' && error.message.trim().length > 0
        ? error.message.trim()
        : typeof error === 'string'
          ? error
          : t('contacts.modal.export.unknownError')
      setExportStatus({ type: 'error', message: t('contacts.modal.export.error', { message }) })
    } finally {
      setExporting(false)
    }
  }, [debouncedSearch, exporting, statusFilter, t])
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
    <>
      <div
        className={MODAL_OVERLAY}
        role="dialog"
        aria-modal="true"
        onClick={() => {
          if (typeof onClose === 'function') {
            onClose()
          }
        }}
      >
        <div
          className={`${MODAL_CONTENT_BASE} max-w-5xl`}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            onClick={onClose}
            className={`${MODAL_CLOSE_ICON_BUTTON} absolute right-4 top-4`}
            aria-label={t('contacts.modal.close')}
          >
            ✕
          </button>
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
                <span className={`h-2 w-2 rounded-full ${showAll ? 'bg-slate-500' : 'bg-emerald-400'}`} />
                {showAll ? t('contacts.modal.showLimited') : t('contacts.modal.showAll')}
              </button>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">{summaryLabel}</span>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleExport}
                disabled={exporting || state.loading || !isSupabaseReady()}
                className="inline-flex items-center justify-center rounded-lg border border-emerald-400/40 bg-emerald-500/10 px-3 py-2 text-sm font-semibold uppercase tracking-wide text-emerald-200 transition hover:border-emerald-300/70 hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-60 sm:px-4"
              >
                {exporting ? t('contacts.modal.exporting') : t('contacts.modal.export')}
              </button>
              <button
                type="button"
                onClick={onClose}
                className={MODAL_CLOSE_PRIMARY_BUTTON}
              >
                {t('contacts.modal.close')}
              </button>
            </div>
          </div>
          {exportStatus ? (
            <p
              className={`text-xs ${
                exportStatus.type === 'error'
                  ? 'text-rose-300'
                  : exportStatus.type === 'success'
                    ? 'text-emerald-300'
                    : 'text-slate-300'
              }`}
            >
              {exportStatus.message}
            </p>
          ) : null}
          <div className="relative max-h-[65vh] overflow-x-auto overflow-y-auto rounded-xl border border-slate-700/40">
            {state.loading ? (
              <div className="px-4 py-6 text-sm text-slate-400">{t('contacts.loading')}</div>
            ) : state.error ? (
              <div className="px-4 py-6 text-sm text-rose-300">{t('contacts.modal.error', { message: state.error.message })}</div>
            ) : sortedData.length === 0 ? (
              <div className="px-4 py-6 text-sm text-slate-400">{t('contacts.modal.empty')}</div>
            ) : (
              <table className="min-w-full table-fixed divide-y divide-slate-800/60 text-left text-sm text-slate-100">
                <thead className="sticky top-0 z-20 bg-slate-900/80 text-xs uppercase tracking-wide text-slate-300 backdrop-blur">
                  <tr>
                    <th className="px-4 py-2 font-semibold">{t('contacts.columns.name')}</th>
                    <th className="px-4 py-2 font-semibold">{t('contacts.columns.company')}</th>
                    <th className="px-4 py-2 font-semibold">{t('contacts.columns.email')}</th>
                    <th className="px-4 py-2 font-semibold">{t('contacts.columns.phone')}</th>
                    <th className="px-4 py-2 font-semibold">{t('contacts.columns.status')}</th>
                    <th className="px-4 py-2 font-semibold text-right">
                      <button
                        type="button"
                        onClick={toggleDateSortDirection}
                        className="inline-flex items-center justify-end gap-1 rounded-md px-2 py-1 text-xs font-semibold uppercase tracking-wide text-right text-slate-300 transition hover:text-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-400"
                        title={t('contacts.sort.tooltip')}
                      >
                        <span>{t('contacts.modal.lastSent')}</span>
                        <span aria-hidden="true">{dateSortDirection === 'asc' ? '↑' : '↓'}</span>
                      </button>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/50">
                  {sortedData.map((contact) => {
                  const phoneDigits = extractDigits(contact.phone)
                  const isSelected = phoneDigits && selectedSet.has(phoneDigits)
                  const contactFlagged = typeof contact.is_flagged === 'boolean' ? contact.is_flagged : null
                  const isFlagged = Boolean(contactFlagged) || (phoneDigits && flaggedSet.has(phoneDigits))
                  const rowClass = isSelected
                    ? 'bg-blue-500/10 ring-1 ring-inset ring-blue-400/50'
                    : 'bg-slate-900/60 hover:bg-slate-800/60'
                  const isEditing = editingContact?.id === contact.id
                  const lastSentDisplay = contact.last_sent_at ? new Date(contact.last_sent_at).toLocaleString() : '—'

                  if (isEditing) {
                    return (
                      <tr key={contact.id} className="relative">
                        <td colSpan={6} className="px-0 py-0">
                          <form
                            onSubmit={handleEditSubmit}
                            className="grid gap-3 rounded-lg border border-sky-500/60 bg-slate-900/70 px-4 py-4 text-sm text-slate-100 md:grid-cols-[1.15fr_1fr_1fr_0.9fr_0.9fr_0.6fr]"
                          >
                            <label className="flex min-w-0 flex-col gap-1 md:truncate">
                              <span className="text-xs font-semibold uppercase text-slate-400">{t('contacts.columns.name')}</span>
                              <input
                                type="text"
                                value={editingDraft?.full_name ?? ''}
                                onChange={handleEditInputChange('full_name')}
                                className="w-full rounded-lg border border-slate-700/60 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
                                maxLength={180}
                                required
                              />
                            </label>
                            <label className="flex min-w-0 flex-col gap-1 md:truncate">
                              <span className="text-xs font-semibold uppercase text-slate-400">{t('contacts.columns.company')}</span>
                              <input
                                type="text"
                                value={editingDraft?.company ?? ''}
                                onChange={handleEditInputChange('company')}
                                className="w-full rounded-lg border border-slate-700/60 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
                                maxLength={180}
                              />
                            </label>
                            <label className="flex min-w-0 flex-col gap-1 md:truncate">
                              <span className="text-xs font-semibold uppercase text-slate-400">{t('contacts.columns.email')}</span>
                              <input
                                type="email"
                                value={editingDraft?.email ?? ''}
                                onChange={handleEditInputChange('email')}
                                className="w-full rounded-lg border border-slate-700/60 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
                                maxLength={320}
                              />
                            </label>
                            <label className="flex min-w-0 flex-col gap-1 md:truncate">
                              <span className="text-xs font-semibold uppercase text-slate-400">{t('contacts.columns.phone')}</span>
                              <input
                                type="text"
                                value={editingDraft?.phone ?? ''}
                                onChange={handleEditInputChange('phone')}
                                className="w-full rounded-lg border border-slate-700/60 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
                                maxLength={64}
                              />
                            </label>
                            <span className="flex min-w-0 flex-col gap-1 md:items-end">
                              <span className="text-xs font-semibold uppercase text-slate-400">{t('contacts.modal.lastSent')}</span>
                              <span className="text-xs text-slate-300">
                                {editingContact?.last_sent_at ? new Date(editingContact.last_sent_at).toLocaleString() : '—'}
                              </span>
                            </span>
                            <span className="flex flex-col gap-1">
                              <span className="text-xs font-semibold uppercase text-slate-400">{t('contacts.columns.status')}</span>
                              <span className="inline-flex items-center gap-2">
                                <span className={`h-2.5 w-2.5 rounded-full ${contact.status === 'green' ? 'bg-emerald-400' : 'bg-rose-400'}`} />
                                <span className="text-xs uppercase tracking-wide text-slate-300">
                                  {contact.status === 'green' ? t('contacts.statusLabels.green') : t('contacts.statusLabels.red')}
                                </span>
                              </span>
                            </span>
                            <div className="md:col-span-6 flex flex-wrap items-center justify-between gap-3 pt-2">
                              {editingStatus ? (
                                <span
                                  className={`text-xs ${
                                    editingStatus.type === 'error'
                                      ? 'text-rose-300'
                                      : editingStatus.type === 'info'
                                        ? 'text-slate-300'
                                        : 'text-emerald-300'
                                  }`}
                                >
                                  {editingStatus.message}
                                </span>
                              ) : (
                                <span />
                              )}
                              <div className="flex flex-wrap items-center gap-2">
                                <button
                                  type="button"
                                  onClick={handleEditCancel}
                                  className="inline-flex items-center justify-center rounded-lg border border-slate-700/60 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-300 transition hover:border-slate-500/70 hover:text-slate-100"
                                  disabled={editingSaving}
                                >
                                  {t('contacts.edit.cancel')}
                                </button>
                                <button
                                  type="submit"
                                  className="inline-flex items-center justify-center rounded-lg border border-sky-400/70 bg-sky-500/20 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-sky-100 transition hover:bg-sky-500/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400 disabled:cursor-not-allowed disabled:opacity-60"
                                  disabled={editingSaving}
                                >
                                  {editingSaving ? t('contacts.edit.saving') : t('contacts.edit.save')}
                                </button>
                              </div>
                            </div>
                          </form>
                        </td>
                      </tr>
                    )
                  }

                  return (
                    <tr
                      key={contact.id}
                      className={`relative transition-colors ${rowClass} ${interactive ? 'cursor-pointer' : ''}`}
                      onClick={() => {
                        if (interactive) {
                          scheduleContactSelection(contact)
                        }
                      }}
                      onDoubleClick={(event) => handleMenuTrigger(event, contact)}
                      onContextMenu={(event) => handleContextMenu(event, contact)}
                      onPointerDown={(event) => handlePointerDownForMenu(event, contact)}
                      onPointerUp={handlePointerClear}
                      onPointerLeave={handlePointerClear}
                      onPointerCancel={handlePointerClear}
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
                      <td className="relative px-4 py-2 font-semibold text-slate-100 break-words" title={contact.full_name || undefined}>
                        {menuContactId === contact.id ? (
                          <div
                            ref={menuRef}
                            role="menu"
                            aria-label={t('contacts.menu.title')}
                            className="absolute right-2 top-2 z-30 flex min-w-[12rem] flex-col gap-1 rounded-xl border border-slate-700/70 bg-slate-950/95 p-2 text-sm shadow-xl shadow-slate-950/60"
                            onClick={(event) => event.stopPropagation()}
                          >
                            <button
                              type="button"
                              onClick={handleMenuEdit}
                              className="flex items-center justify-between rounded-lg px-3 py-2 text-left text-slate-200 transition hover:bg-slate-800/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500"
                            >
                              {t('contacts.menu.edit')}
                            </button>
                            <button
                              type="button"
                              onClick={handleMenuToggleStatus}
                              className="flex items-center justify-between rounded-lg px-3 py-2 text-left text-slate-200 transition hover:bg-slate-800/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500"
                            >
                              {contact.status === 'green' ? t('contacts.menu.markPending') : t('contacts.menu.markSent')}
                            </button>
                            <button
                              type="button"
                              onClick={handleMenuDelete}
                              className="flex items-center justify-between rounded-lg px-3 py-2 text-left text-rose-200 transition hover:bg-rose-500/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-400"
                            >
                              {t('contacts.menu.delete')}
                            </button>
                            <button
                              type="button"
                              onClick={closeActionMenu}
                              className="flex items-center justify-between rounded-lg px-3 py-2 text-left text-slate-400 transition hover:bg-slate-800/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500"
                            >
                              {t('contacts.menu.close')}
                            </button>
                          </div>
                        ) : null}
                        {contact.full_name || '—'}
                      </td>
                      <td className="px-4 py-2 text-slate-300 break-words">{contact.company || '—'}</td>
                      <td className="px-4 py-2 text-slate-300 break-words">{contact.email || '—'}</td>
                      <td className="px-4 py-2 text-slate-300">
                        <div className="group/phone flex items-center gap-2">
                          <span className="break-words">{contact.phone || '—'}</span>
                          {contact.phone ? (
                            <span
                              role="button"
                              tabIndex={0}
                              onClick={(event) => handleFlagToggle(event, contact)}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter' || event.key === ' ') {
                                  event.preventDefault()
                                  handleFlagToggle(event, contact)
                                }
                              }}
                              aria-pressed={isFlagged}
                              aria-label={isFlagged ? t('contacts.flag.remove') : t('contacts.flag.add')}
                              className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[0.7rem] transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300 ${
                                isFlagged
                                  ? 'border border-amber-300/60 bg-amber-400/10 text-amber-300 opacity-100 shadow-[0_0_6px_rgba(251,191,36,0.25)]'
                                  : 'border border-transparent text-slate-500/0 opacity-0 group-hover/phone:text-slate-400/90 group-hover/phone:opacity-100 hover:text-amber-300 hover:opacity-100'
                              }`}
                            >
                              🚩
                            </span>
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
                      <td className="px-4 py-2 text-right text-slate-300" title={lastSentDisplay === '—' ? undefined : lastSentDisplay}>
                        {lastSentDisplay}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
          </div>
        </div>
      </div>
      <ContactDeleteModal
        key={deleteContactTarget ? `modal-delete-${deleteContactTarget.id}` : 'modal-delete-closed'}
        t={t}
        open={Boolean(deleteContactTarget)}
        contact={deleteContactTarget}
        onClose={handleDeleteClose}
        onDeleted={handleContactDeleted}
      />
    </>
  )
}
