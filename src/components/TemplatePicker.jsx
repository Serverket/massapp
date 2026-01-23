import { useMemo } from 'react'

export function TemplatePicker({
  t,
  templates,
  loading,
  error,
  selectedTemplateId,
  onSelect,
  onApply,
  onClear,
  onRefresh,
  onManage,
}) {
  const options = useMemo(
    () => [{ id: '', name: t('templates.selectPlaceholder'), locale: null }, ...templates],
    [templates, t],
  )

  const selectedTemplate = useMemo(() => templates.find((template) => template.id === selectedTemplateId) || null, [selectedTemplateId, templates])

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-slate-700/60 bg-slate-900/60 p-4">
      <div className="flex flex-wrap items-center gap-2 sm:justify-between">
        <div className="flex flex-col">
          <h3 className="text-sm font-semibold text-slate-100">{t('templates.title')}</h3>
          <p className="text-xs text-slate-400">{t('templates.subtitle')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-700/60 bg-slate-900/60 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-300 transition hover:border-slate-500/70 hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t('templates.refresh')}
          </button>
          <button
            type="button"
            onClick={onManage}
            className="inline-flex items-center gap-1 rounded-lg bg-blue-500/20 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-blue-200 transition hover:bg-blue-500/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400"
          >
            {t('templates.manage')}
          </button>
        </div>
      </div>

      {loading ? (
        <p className="text-xs text-slate-400">{t('templates.loading')}</p>
      ) : error ? (
        <p className="text-xs text-rose-300">{t('templates.error', { message: error.message })}</p>
      ) : templates.length === 0 ? (
        <p className="text-xs text-slate-400">{t('templates.empty')}</p>
      ) : (
        <>
          <label className="flex flex-col gap-2 text-xs font-semibold uppercase tracking-wide text-slate-300">
            <span>{t('templates.selectLabel')}</span>
            <select
              value={selectedTemplateId ?? ''}
              onChange={(event) => onSelect(event.target.value || null)}
              className="w-full rounded-xl border border-slate-700/60 bg-slate-900/60 px-3 py-2 text-sm font-semibold text-slate-100 transition hover:border-slate-500/70 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/30"
            >
              {options.map((template) => (
                <option
                  key={template.id || 'placeholder'}
                  value={template.id}
                  disabled={!template.id}
                  className="bg-slate-900 text-slate-100"
                >
                  {template.name}
                  {template.locale ? ` (${template.locale.toUpperCase()})` : ''}
                </option>
              ))}
            </select>
          </label>

          {selectedTemplate ? (
            <div className="flex flex-col gap-2 text-sm text-slate-200">
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <span className="font-semibold uppercase tracking-wide">{t('templates.previewHeading')}</span>
                {selectedTemplate.locale ? (
                  <span className="rounded-full border border-slate-700/60 px-2 py-0.5 text-[0.65rem] uppercase tracking-wide text-slate-400">
                    {t('templates.localeLabel', { locale: selectedTemplate.locale.toUpperCase() })}
                  </span>
                ) : null}
              </div>
              <p className="whitespace-pre-wrap rounded-lg border border-slate-700/50 bg-slate-900/50 px-3 py-3 text-sm text-slate-100">
                {selectedTemplate.body}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => onApply(selectedTemplate.id)}
                  className="inline-flex items-center justify-center rounded-lg bg-blue-500/20 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-blue-200 transition hover:bg-blue-500/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400"
                >
                  {t('templates.apply')}
                </button>
                <button
                  type="button"
                  onClick={onClear}
                  className="inline-flex items-center justify-center rounded-lg border border-slate-700/60 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-300 transition hover:border-slate-500/70 hover:text-slate-100"
                >
                  {t('templates.clear')}
                </button>
              </div>
            </div>
          ) : null}
        </>
      )}
    </section>
  )
}
