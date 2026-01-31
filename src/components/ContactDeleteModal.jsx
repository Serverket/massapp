import { useState } from 'react'
import { deleteContact } from '../lib/storage.js'

export function ContactDeleteModal({ t, open, contact, onClose, onDeleted }) {
  const [status, setStatus] = useState(null)
  const [deleting, setDeleting] = useState(false)

  if (!open || !contact) {
    return null
  }

  const displayName = contact.full_name?.trim().length ? contact.full_name.trim() : t('contacts.delete.unnamed')

  const handleCancel = () => {
    if (deleting) {
      return
    }
    if (typeof onClose === 'function') {
      onClose()
    }
  }

  const handleConfirm = async () => {
    if (deleting) {
      return
    }

    setDeleting(true)
    setStatus({ type: 'info', message: t('contacts.delete.deleting') })

    const { error } = await deleteContact(contact.id)

    setDeleting(false)

    if (error) {
      setStatus({ type: 'error', message: t('contacts.delete.error', { message: error.message }) })
      return
    }

    setStatus({ type: 'success', message: t('contacts.delete.success') })
    if (typeof onDeleted === 'function') {
      onDeleted(contact)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 px-4 py-8" role="dialog" aria-modal="true">
      <div className="w-full max-w-md rounded-2xl border border-slate-700/60 bg-slate-900/90 p-6 shadow-2xl shadow-slate-950/60 backdrop-blur">
        <header className="flex flex-col gap-2">
          <h2 className="text-xl font-semibold text-slate-100">{t('contacts.delete.title')}</h2>
          <p className="text-sm text-slate-400">{t('contacts.delete.message', { name: displayName })}</p>
        </header>
        {status ? (
          <p
            className={`mt-4 text-sm ${
              status.type === 'error'
                ? 'text-rose-300'
                : status.type === 'success'
                  ? 'text-emerald-300'
                  : 'text-slate-300'
            }`}
          >
            {status.message}
          </p>
        ) : null}
        <div className="mt-6 flex flex-wrap items-center justify-end gap-3">
          <button
            type="button"
            onClick={handleCancel}
            className="inline-flex items-center justify-center rounded-lg border border-slate-700/60 px-4 py-2 text-sm font-semibold uppercase tracking-wide text-slate-300 transition hover:border-slate-500/70 hover:text-slate-100"
            disabled={deleting}
          >
            {t('contacts.delete.cancel')}
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            className="inline-flex items-center justify-center rounded-lg border border-rose-500/60 px-4 py-2 text-sm font-semibold uppercase tracking-wide text-rose-200 transition hover:border-rose-400/70 hover:bg-rose-500/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-400 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={deleting}
          >
            {deleting ? t('contacts.delete.deleting') : t('contacts.delete.confirm')}
          </button>
        </div>
      </div>
    </div>
  )
}
