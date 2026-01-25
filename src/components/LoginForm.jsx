import { useCallback, useState } from 'react'
import { supabase, isSupabaseReady } from '../lib/supabaseClient.js'

const EMAIL_PATTERN = '^[^\\s<>@]+@[^\\s<>@]+\\.[^\\s<>@]+$'
const CONTROL_CHARS_REGEX = /\p{Cc}/gu

function sanitizeEmail(value) {
  if (!value) {
    return ''
  }
  return value
    .normalize('NFKC')
    .replace(CONTROL_CHARS_REGEX, '')
    .replace(/[<>]/g, '')
    .replace(/\s+/g, '')
    .toLowerCase()
}

function sanitizePassword(value) {
  if (!value) {
    return ''
  }
  return value
    .normalize('NFKC')
    .replace(CONTROL_CHARS_REGEX, '')
}

function sanitizeStatusMessage(value) {
  if (!value) {
    return ''
  }
  return String(value)
    .normalize('NFKC')
    .replace(CONTROL_CHARS_REGEX, '')
    .trim()
}

const INPUT_STYLE =
  'w-full rounded-xl border border-slate-700/60 bg-slate-900/60 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/30'

const BUTTON_STYLE =
  'inline-flex w-full items-center justify-center rounded-xl bg-gradient-to-r from-blue-600 to-blue-500 px-4 py-2.5 text-sm font-semibold text-slate-100 transition hover:from-blue-500 hover:to-blue-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400 disabled:cursor-not-allowed disabled:opacity-60'

export function LoginForm({ t }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [status, setStatus] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  const applyStatus = useCallback((type, message) => {
    setStatus({ type, message: sanitizeStatusMessage(message) })
  }, [])

  const handleSubmit = useCallback(
    async (event) => {
      event.preventDefault()
      if (!isSupabaseReady()) {
        applyStatus('error', t('login.missingSupabase'))
        return
      }

      const safeEmail = sanitizeEmail(email)
      const safePassword = sanitizePassword(password)

      setEmail(safeEmail)
      setPassword(safePassword)

      if (!safeEmail || !safePassword) {
        applyStatus('error', t('login.requirements'))
        return
      }

      setSubmitting(true)
      applyStatus('info', t('login.signingIn'))

      try {
        const { error } = await supabase.auth.signInWithPassword({ email: safeEmail, password: safePassword })
        if (error) {
          const safeErrorMessage = sanitizeStatusMessage(error.message)
          applyStatus('error', t('login.error', { message: safeErrorMessage }))
        } else {
          applyStatus('success', t('login.success'))
        }
      } catch (error) {
        const safeErrorMessage = sanitizeStatusMessage(error.message)
        applyStatus('error', t('login.error', { message: safeErrorMessage }))
      } finally {
        setSubmitting(false)
      }
    },
    [applyStatus, email, password, t],
  )

  return (
    <form onSubmit={handleSubmit} className="flex w-full max-w-md flex-col gap-4 rounded-2xl border border-slate-700/50 bg-slate-900/70 p-6 shadow-xl shadow-slate-950/40">
      <div className="flex flex-col items-center gap-3 text-center">
        <img src="/massapp-logo.svg" alt={t('app.title')} className="h-14 w-14" />
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold text-slate-100">{t('login.title')}</h1>
          <p className="text-sm text-slate-400">{t('login.subtitle')}</p>
        </header>
      </div>

      <label className="flex flex-col gap-1 text-sm text-slate-300">
        <span>{t('login.emailLabel')}</span>
        <input
          type="email"
          autoComplete="email"
          inputMode="email"
          pattern={EMAIL_PATTERN}
          autoCapitalize="none"
          spellCheck={false}
          maxLength={320}
          value={email}
          onChange={(event) => setEmail(sanitizeEmail(event.target.value))}
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
          maxLength={128}
          value={password}
          onChange={(event) => setPassword(sanitizePassword(event.target.value))}
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
          role="status"
          aria-live="polite"
        >
          {status.message}
        </p>
      ) : null}
    </form>
  )
}
