import { useMemo, useState } from 'react'
import { updateContact } from '../lib/storage.js'
import { MODAL_CLOSE_ICON_BUTTON, MODAL_CLOSE_PRIMARY_BUTTON } from '../lib/uiStyles.js'

const EMPTY_FORM = {
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

export function ContactEditModal({ t, open, contact, onClose, onSaved }) {
  const [form, setForm] = useState(() => {
    if (!contact) {
      return EMPTY_FORM
    }
    return {
      full_name: normalizeField(contact.full_name) || '',
      phone: normalizeField(contact.phone) || '',
      email: normalizeField(contact.email) || '',
      company: normalizeField(contact.company) || '',
    }
  })
  const [status, setStatus] = useState(null)
  const [saving, setSaving] = useState(false)

  const nameError = useMemo(() => {
    if (!open) {
      return null
    }
    return normalizeField(form.full_name).length === 0 ? t('contacts.edit.validation.name') : null
  }, [form.full_name, open, t])

  const contactError = useMemo(() => {
    if (!open) {
      return null
    }
    const hasPhone = normalizeField(form.phone).length > 0
    const hasEmail = normalizeField(form.email).length > 0
    return hasPhone || hasEmail ? null : t('contacts.edit.validation.contact')
  }, [form.email, form.phone, open, t])

  if (!open || !contact) {
    return null
  }

  const handleChange = (field) => (event) => {
    const { value } = event.target
    setForm((previous) => ({ ...previous, [field]: value }))
  }

  const handleSubmit = async (event) => {
    event.preventDefault()

    if (nameError || contactError) {
      setStatus({ type: 'error', message: nameError || contactError })
      return
    }

    const payload = {
      full_name: normalizeField(form.full_name),
      phone: persistable(form.phone),
      email: persistable(form.email),
      company: persistable(form.company),
    }

    setSaving(true)
    setStatus({ type: 'info', message: t('contacts.edit.saving') })

    const { data, error } = await updateContact(contact.id, payload)

    setSaving(false)

    if (error) {
      setStatus({ type: 'error', message: t('contacts.edit.error', { message: error.message }) })
      return
    }

    setStatus({ type: 'success', message: t('contacts.edit.success') })
    if (typeof onSaved === 'function') {
      onSaved(data ?? { ...contact, ...payload })
    }
  }

  const handleClose = () => {
    if (saving) {
      return
    }
    if (typeof onClose === 'function') {
      onClose()
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 px-4 py-8"
      role="dialog"
      aria-modal="true"
      onClick={handleClose}
    >
      <div
        className="relative w-full max-w-xl rounded-2xl border border-slate-700/60 bg-slate-900/90 p-6 shadow-2xl shadow-slate-950/60 backdrop-blur"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h2 className="text-xl font-semibold text-slate-100">{t('contacts.edit.title')}</h2>
            <p className="text-sm text-slate-400">{t('contacts.edit.subtitle')}</p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className={MODAL_CLOSE_ICON_BUTTON}
            aria-label={t('contacts.edit.cancel')}
          >
            ✕
          </button>
        </header>
        <form onSubmit={handleSubmit} className="mt-5 flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm text-slate-200">
            <span>{t('contacts.edit.nameLabel')}</span>
            <input
              type="text"
              value={form.full_name}
              onChange={handleChange('full_name')}
              className="w-full rounded-xl border border-slate-700/60 bg-slate-900/60 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/30"
              maxLength={180}
              required
            />
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm text-slate-200">
              <span>{t('contacts.edit.phoneLabel')}</span>
              <input
                type="text"
                value={form.phone}
                onChange={handleChange('phone')}
                className="w-full rounded-xl border border-slate-700/60 bg-slate-900/60 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/30"
                maxLength={64}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-slate-200">
              <span>{t('contacts.edit.emailLabel')}</span>
              <input
                type="email"
                value={form.email}
                onChange={handleChange('email')}
                className="w-full rounded-xl border border-slate-700/60 bg-slate-900/60 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/30"
                maxLength={320}
              />
            </label>
          </div>
          <label className="flex flex-col gap-1 text-sm text-slate-200">
            <span>{t('contacts.edit.companyLabel')}</span>
            <input
              type="text"
              value={form.company}
              onChange={handleChange('company')}
              className="w-full rounded-xl border border-slate-700/60 bg-slate-900/60 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/30"
              maxLength={180}
            />
          </label>
          {status ? (
            <p
              className={`text-sm ${
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
          {contactError && !status ? (
            <p className="text-sm text-rose-300">{contactError}</p>
          ) : null}
          <div className="flex flex-wrap items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={handleClose}
              className={MODAL_CLOSE_PRIMARY_BUTTON}
              disabled={saving}
            >
              {t('contacts.edit.cancel')}
            </button>
            <button
              type="submit"
              className="inline-flex items-center justify-center rounded-lg bg-blue-500/20 px-4 py-2 text-sm font-semibold uppercase tracking-wide text-blue-200 transition hover:bg-blue-500/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={saving}
            >
              {saving ? t('contacts.edit.saving') : t('contacts.edit.save')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
