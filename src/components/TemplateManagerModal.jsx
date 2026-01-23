import { useEffect, useMemo, useState } from 'react'
import { upsertTemplate, removeTemplate } from '../lib/storage.js'

function normalizeLocale(value) {
  return value ? value.trim().toLowerCase() : null
}

export function TemplateManagerModal({ t, open, templates, onClose, onSaved, onDeleted }) {
  const [selectedId, setSelectedId] = useState(null)
  const [name, setName] = useState('')
  const [locale, setLocale] = useState('')
  const [body, setBody] = useState('')
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [status, setStatus] = useState(null)

  const templateMap = useMemo(() => {
    const map = new Map()
    templates.forEach((template) => map.set(template.id, template))
    return map
  }, [templates])

  useEffect(() => {
    if (!open) {
      setSelectedId(null)
      setName('')
      setLocale('')
      setBody('')
      setStatus(null)
    }
  }, [open])

  useEffect(() => {
    if (!open) {
      return
    }
    if (!selectedId) {
      setName('')
      setLocale('')
      setBody('')
      return
    }
    const template = templateMap.get(selectedId)
    if (!template) {
      return
    }
    setName(template.name ?? '')
    setLocale(template.locale ?? '')
    setBody(template.body ?? '')
    setStatus(null)
  }, [open, selectedId, templateMap])

  if (!open) {
    return null
  }

  const resetForm = () => {
    setSelectedId(null)
    setName('')
    setLocale('')
    setBody('')
    setStatus(null)
  }

  const handleSelectTemplate = (id) => {
    setSelectedId(id)
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (!name.trim() || !body.trim()) {
      setStatus({ type: 'error', message: t('templates.modal.validation') })
      return
    }
    setSaving(true)
    setStatus({ type: 'info', message: t('templates.modal.saving') })
    const payload = {
      id: selectedId,
      name: name.trim(),
      body: body.trim(),
      locale: normalizeLocale(locale) || null,
    }
    const { data, error } = await upsertTemplate(payload)
    setSaving(false)
    if (error) {
      setStatus({ type: 'error', message: t('templates.manage.error', { message: error.message }) })
      return
    }
    setStatus({ type: 'success', message: selectedId ? t('templates.manage.updateSuccess') : t('templates.manage.createSuccess') })
    if (onSaved) {
      onSaved(data, { isUpdate: Boolean(selectedId) })
    }
    setSelectedId(data?.id ?? null)
  }

  const handleDelete = async () => {
    if (!selectedId) {
      return
    }
    const template = templateMap.get(selectedId) ?? null
    setDeleting(true)
    setStatus({ type: 'info', message: t('templates.modal.deleting') })
    const { error } = await removeTemplate(selectedId)
    setDeleting(false)
    if (error) {
      setStatus({ type: 'error', message: t('templates.manage.error', { message: error.message }) })
      return
    }
    setStatus({ type: 'success', message: t('templates.manage.deleteSuccess') })
    if (onDeleted) {
      onDeleted(selectedId, template)
    }
    resetForm()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 px-4 py-8" role="dialog" aria-modal="true">
      <div className="relative flex w-full max-w-3xl flex-col gap-4 rounded-2xl border border-slate-700/60 bg-slate-900/90 p-6 shadow-2xl shadow-slate-950/60 backdrop-blur">
        <header className="flex flex-col gap-1">
          <h2 className="text-xl font-semibold text-slate-100">{t('templates.modal.title')}</h2>
          <p className="text-sm text-slate-400">{t('templates.modal.subtitle')}</p>
        </header>
        <div className="flex flex-col gap-4 lg:flex-row">
          <aside className="flex w-full max-w-xs flex-col gap-3 rounded-xl border border-slate-700/60 bg-slate-900/60 p-3">
            <button
              type="button"
              onClick={resetForm}
              className={`rounded-lg px-3 py-2 text-sm font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${
                selectedId
                  ? 'border border-slate-700/60 bg-slate-900/60 text-slate-200 hover:border-slate-500/70'
                  : 'bg-blue-500/20 text-blue-200 focus-visible:outline-blue-400'
              }`}
            >
              {t('templates.modal.create')}
            </button>
            <div className="h-px bg-slate-700/60" />
            {templates.length === 0 ? (
              <p className="text-xs text-slate-400">{t('templates.modal.empty')}</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {templates.map((template) => (
                  <li key={template.id}>
                    <button
                      type="button"
                      onClick={() => handleSelectTemplate(template.id)}
                      className={`w-full rounded-lg px-3 py-2 text-left text-sm transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${
                        selectedId === template.id
                          ? 'bg-blue-500/20 text-blue-200 focus-visible:outline-blue-400'
                          : 'border border-slate-700/60 bg-slate-900/60 text-slate-200 hover:border-slate-500/70'
                      }`}
                    >
                      <span className="font-semibold text-slate-100">{template.name}</span>
                      {template.locale ? (
                        <span className="ml-2 text-xs uppercase tracking-wide text-slate-400">{template.locale}</span>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </aside>
          <form onSubmit={handleSubmit} className="flex w-full flex-col gap-4">
            <div className="flex flex-col gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                {selectedId ? t('templates.modal.editing') : t('templates.modal.new')}
              </span>
              <label className="flex flex-col gap-2 text-sm text-slate-300">
                <span>{t('templates.modal.nameLabel')}</span>
                <input
                  type="text"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  className="w-full rounded-xl border border-slate-700/60 bg-slate-900/60 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/30"
                  placeholder={t('templates.modal.namePlaceholder')}
                />
              </label>
              <label className="flex flex-col gap-2 text-sm text-slate-300">
                <span>{t('templates.modal.localeLabel')}</span>
                <input
                  type="text"
                  value={locale}
                  onChange={(event) => setLocale(event.target.value)}
                  className="w-full rounded-xl border border-slate-700/60 bg-slate-900/60 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/30"
                  placeholder={t('templates.modal.localePlaceholder')}
                />
              </label>
              <label className="flex flex-col gap-2 text-sm text-slate-300">
                <span>{t('templates.modal.bodyLabel')}</span>
                <textarea
                  value={body}
                  onChange={(event) => setBody(event.target.value)}
                  rows={10}
                  className="w-full rounded-xl border border-slate-700/60 bg-slate-900/60 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/30"
                  placeholder={t('templates.modal.bodyPlaceholder')}
                />
              </label>
            </div>
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
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex items-center justify-center rounded-lg bg-blue-500/20 px-4 py-2 text-sm font-semibold uppercase tracking-wide text-blue-200 transition hover:bg-blue-500/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {saving ? t('templates.modal.saving') : t('templates.modal.save')}
                </button>
                {selectedId ? (
                  <button
                    type="button"
                    onClick={handleDelete}
                    disabled={deleting}
                    className="inline-flex items-center justify-center rounded-lg border border-rose-500/60 px-4 py-2 text-sm font-semibold uppercase tracking-wide text-rose-200 transition hover:border-rose-400/70 hover:bg-rose-500/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-400 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {deleting ? t('templates.modal.deleting') : t('templates.modal.delete')}
                  </button>
                ) : null}
              </div>
              <button
                type="button"
                onClick={onClose}
                className="inline-flex items-center justify-center rounded-lg border border-slate-700/60 px-4 py-2 text-sm font-semibold uppercase tracking-wide text-slate-300 transition hover:border-slate-500/70 hover:text-slate-100"
              >
                {t('templates.modal.cancel')}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
