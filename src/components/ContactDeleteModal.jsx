import { useState } from 'react'
import { deleteContact } from '../lib/storage.js'
import { MODAL_CLOSE_ICON_BUTTON, MODAL_CLOSE_PRIMARY_BUTTON } from '../lib/uiStyles.js'

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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4 py-8 bg-slate-950/80"
      role="dialog"
      aria-modal="true"
      onClick={handleCancel}
    >
      <div
        className="relative w-full max-w-md p-6 border shadow-2xl rounded-2xl border-slate-700/60 bg-slate-900/90 shadow-slate-950/60 backdrop-blur"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          onClick={handleCancel}
          className={`${MODAL_CLOSE_ICON_BUTTON} absolute right-4 top-4`}
          aria-label={t('contacts.delete.cancel')}
        >
          ✕
        </button>
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
        <div className="flex flex-wrap items-center justify-end gap-3 mt-6">
          <button
            type="button"
            onClick={handleCancel}
            className={MODAL_CLOSE_PRIMARY_BUTTON}
            disabled={deleting}
          >
            {t('contacts.delete.cancel')}
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            className="inline-flex items-center justify-center px-4 py-2 text-sm font-semibold tracking-wide uppercase transition border rounded-lg border-rose-500/60 text-rose-200 hover:border-rose-400/70 hover:bg-rose-500/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-400 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={deleting}
          >
            {deleting ? t('contacts.delete.deleting') : t('contacts.delete.confirm')}
          </button>
        </div>
      </div>
    </div>
  )
}
