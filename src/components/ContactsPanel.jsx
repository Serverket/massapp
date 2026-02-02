import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { isSupabaseReady, supabase } from '../lib/supabaseClient.js'
import { toggleContactDeliveryStatus, updateContact } from '../lib/storage.js'
import { ContactDeleteModal } from './ContactDeleteModal.jsx'

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

export function ContactsPanel({
  t,
  totalContacts,
  refreshToken,
  onOpenModal,
  onSelectContact,
  selectedPhones = [],
  className = '',
  onStatusChange,
  flaggedPhones = [],
  onFlagToggle,
  onSyncContacts,
}) {
  const [statusFilter, setStatusFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [state, setState] = useState({ data: [], loading: true, error: null })
  const [localRefreshVersion, setLocalRefreshVersion] = useState(0)
  const debouncedSearch = useDebouncedValue(search, 300)
  const clickTimeoutRef = useRef(null)
  const togglingIdsRef = useRef(new Set())
  const menuRef = useRef(null)
  const menuLongPressRef = useRef(null)
  const skipClickRef = useRef(false)
  const [menuContactId, setMenuContactId] = useState(null)
  const [editingContact, setEditingContact] = useState(null)
  const [editingDraft, setEditingDraft] = useState(null)
  const [editingStatus, setEditingStatus] = useState(null)
  const [editingSaving, setEditingSaving] = useState(false)
  const [deleteContactTarget, setDeleteContactTarget] = useState(null)

  const isDisabled = !isSupabaseReady()
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

  const sortedData = useMemo(() => state.data ?? [], [state.data])

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
        .select('id, full_name, phone, email, company, status, last_sent_at, is_flagged')
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

      const mergedContact = { ...contact, ...updatedContact }

      setState((prev) => ({
        ...prev,
        data: prev.data.map((item) => (item.id === contact.id ? { ...item, ...updatedContact } : item)),
      }))

      if (statusFilter !== 'all') {
        setLocalRefreshVersion((value) => value + 1)
      }

      if (typeof onStatusChange === 'function') {
        onStatusChange(mergedContact)
      }
    },
    [isDisabled, onStatusChange, statusFilter],
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
      if (typeof onSyncContacts === 'function') {
        onSyncContacts()
      }
    },
    [onSyncContacts],
  )

  const handleDeleteClose = useCallback(() => {
    setDeleteContactTarget(null)
  }, [])

  const applyContactPatch = useCallback((contactId, patch) => {
    setState((previous) => ({
      ...previous,
      data: previous.data.map((item) => (item.id === contactId ? { ...item, ...patch } : item)),
    }))
    setLocalRefreshVersion((value) => value + 1)
    if (typeof onSyncContacts === 'function') {
      onSyncContacts()
    }
  }, [onSyncContacts])

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

  const { loading, error } = state

  const statusSummary = useMemo(() => {
    if (loading) {
      return t('contacts.status.loading')
    }
    if (error) {
      return t('contacts.status.error')
    }
    const visibleCount = sortedData.length
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
  }, [error, loading, sortedData.length, t, totalContacts])

  return (
    <>
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
        <div className="hidden bg-slate-800/60 px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-300 md:grid md:grid-cols-[1.15fr_1fr_1fr_0.9fr_0.6fr]">
          <span className="text-left">{t('contacts.columns.name')}</span>
          <span className="text-left">{t('contacts.columns.company')}</span>
          <span className="text-left">{t('contacts.columns.email')}</span>
          <span className="text-left">{t('contacts.columns.phone')}</span>
          <span className="text-left">{t('contacts.columns.status')}</span>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto pt-3 pb-2 max-h-[28rem] md:max-h-[32rem] md:py-0">
          {state.loading ? (
            <div className="px-4 py-6 text-sm text-slate-400">{t('contacts.loading')}</div>
          ) : state.error ? (
            <div className="px-4 py-6 text-sm text-rose-300">{t('contacts.error', { message: state.error.message })}</div>
          ) : sortedData.length === 0 ? (
            <div className="px-4 py-6 text-sm text-slate-400">{t('contacts.empty')}</div>
          ) : (
            <ul className="divide-y divide-slate-800/60">
              {sortedData.map((contact) => (
                <li key={contact.id} className="px-1 py-1">
                  {(() => {
                    const phoneDigits = extractDigits(contact.phone)
                    const isSelected = phoneDigits && selectedSet.has(phoneDigits)
                    const contactFlagged = typeof contact.is_flagged === 'boolean' ? contact.is_flagged : null
                    const isFlagged = Boolean(contactFlagged) || (phoneDigits && flaggedSet.has(phoneDigits))
                    const interactive = typeof onSelectContact === 'function'
                    const isEditing = editingContact?.id === contact.id
                    return (
                      <>
                        {isEditing ? (
                          <form
                            onSubmit={handleEditSubmit}
                            className={`relative grid w-full gap-3 rounded-lg border px-4 py-3 text-left text-sm md:grid-cols-[1.15fr_1fr_1fr_0.9fr_0.6fr] ${
                              'border-sky-500/60 bg-slate-900/70 text-slate-100'
                            }`}
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
                            <span className="flex flex-col gap-1">
                              <span className="text-xs font-semibold uppercase text-slate-400">{t('contacts.columns.status')}</span>
                              <span className="inline-flex items-center gap-2">
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
                            </span>
                            <div className="md:col-span-5 flex flex-wrap items-center justify-between gap-3 pt-2">
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
                              ) : <span />}
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
                        ) : (
                          <button
                            type="button"
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
                            className={`relative grid w-full gap-3 rounded-lg border px-4 py-3 text-left text-sm transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400 md:grid-cols-[1.15fr_1fr_1fr_0.9fr_0.6fr] ${
                              interactive ? 'cursor-pointer' : 'cursor-default'
                            } ${
                              isSelected
                                ? 'border-blue-400/60 bg-blue-500/10 text-slate-100'
                                : 'border-transparent bg-slate-900/60 text-slate-200 hover:border-slate-600/70 hover:bg-slate-800/60'
                            }`}
                            aria-pressed={interactive ? isSelected : undefined}
                          >
                            {menuContactId === contact.id ? (
                              <div
                                ref={menuRef}
                                role="menu"
                                aria-label={t('contacts.menu.title')}
                                className="absolute right-3 top-2 z-30 flex min-w-[12rem] flex-col gap-1 rounded-xl border border-slate-700/70 bg-slate-950/95 p-2 text-sm shadow-xl shadow-slate-950/60"
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
                            <div className="min-w-0 md:truncate" title={contact.phone || ''}>
                              <span className="block text-xs font-semibold uppercase text-slate-400 md:hidden">{t('contacts.columns.phone')}</span>
                              <div className="group/phone flex min-w-0 items-center gap-2">
                                <span className="min-w-0 break-words md:truncate">{contact.phone || '—'}</span>
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
                            </div>
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
                        )}
                      </>
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
    <ContactDeleteModal
      key={deleteContactTarget ? `panel-delete-${deleteContactTarget.id}` : 'panel-delete-closed'}
      t={t}
      open={Boolean(deleteContactTarget)}
      contact={deleteContactTarget}
      onClose={handleDeleteClose}
      onDeleted={handleContactDeleted}
    />
  </>
)
}
