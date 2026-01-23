import { useCallback, useState } from 'react'
import { supabase, isSupabaseReady } from '../lib/supabaseClient.js'

const INPUT_STYLE =
  'w-full rounded-xl border border-slate-700/60 bg-slate-900/60 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/30'

const BUTTON_STYLE =
  'inline-flex w-full items-center justify-center rounded-xl bg-gradient-to-r from-blue-600 to-blue-500 px-4 py-2.5 text-sm font-semibold text-slate-100 transition hover:from-blue-500 hover:to-blue-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400 disabled:cursor-not-allowed disabled:opacity-60'

export function LoginForm({ t }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [status, setStatus] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = useCallback(
    async (event) => {
      event.preventDefault()
      if (!isSupabaseReady()) {
        setStatus({ type: 'error', message: t('login.missingSupabase') })
        return
      }

      if (!email || !password) {
        setStatus({ type: 'error', message: t('login.requirements') })
        return
      }

      setSubmitting(true)
      setStatus({ type: 'info', message: t('login.signingIn') })

      try {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) {
          setStatus({ type: 'error', message: t('login.error', { message: error.message }) })
        } else {
          setStatus({ type: 'success', message: t('login.success') })
        }
      } catch (error) {
        setStatus({ type: 'error', message: t('login.error', { message: error.message }) })
      } finally {
        setSubmitting(false)
      }
    },
    [email, password, t],
  )

  return (
    <form onSubmit={handleSubmit} className="flex w-full max-w-md flex-col gap-4 rounded-2xl border border-slate-700/50 bg-slate-900/70 p-6 shadow-xl shadow-slate-950/40">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-slate-100">{t('login.title')}</h1>
        <p className="text-sm text-slate-400">{t('login.subtitle')}</p>
      </header>

      <label className="flex flex-col gap-1 text-sm text-slate-300">
        <span>{t('login.emailLabel')}</span>
        <input
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder={t('login.emailPlaceholder')}
          className={INPUT_STYLE}
          disabled={submitting}
        />
      </label>

      <label className="flex flex-col gap-1 text-sm text-slate-300">
        <span>{t('login.passwordLabel')}</span>
        <input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder={t('login.passwordPlaceholder')}
          className={INPUT_STYLE}
          disabled={submitting}
        />
      </label>

      <button type="submit" className={BUTTON_STYLE} disabled={submitting}>
        {submitting ? t('login.submitting') : t('login.submit')}
      </button>

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
    </form>
  )
}
