import { createClient } from '@supabase/supabase-js'

const KEEP_ALIVE_INTERVAL_MS = Number.parseInt(import.meta.env.VITE_SUPABASE_KEEPALIVE_INTERVAL_MS ?? '', 10)
const RESOLVED_KEEP_ALIVE_INTERVAL_MS = Number.isFinite(KEEP_ALIVE_INTERVAL_MS)
  ? Math.max(KEEP_ALIVE_INTERVAL_MS, 60_000)
  : 5 * 60 * 1000

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.warn('Supabase environment variables are missing. Metrics storage is disabled.')
}

export const supabase = SUPABASE_URL && SUPABASE_ANON_KEY ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null

export function isSupabaseReady() {
  return Boolean(supabase)
}

let healthState = {
  state: isSupabaseReady() ? 'idle' : 'offline',
  updatedAt: null,
  error: null,
  fallback: false,
  heartbeatAt: null,
  meta: null,
}

const healthListeners = new Set()
let keepAliveTimer = null
let keepAliveConsumers = 0
let visibilityBound = false
let inflightPing = null

function notifyHealthListeners() {
  healthListeners.forEach((listener) => {
    try {
      listener(healthState)
    } catch (error) {
      console.error('Supabase health listener error:', error)
    }
  })
}

function setHealthState(nextState) {
  const resolved = typeof nextState === 'function' ? nextState(healthState) : nextState
  healthState = {
    ...healthState,
    ...resolved,
  }
  notifyHealthListeners()
}

function attachVisibilityPing() {
  if (visibilityBound || typeof document === 'undefined') {
    return
  }
  const handler = () => {
    if (document.hidden) {
      return
    }
    pingSupabaseHealth({ reason: 'visibility' })
  }
  document.addEventListener('visibilitychange', handler, { passive: true })
  visibilityBound = true
}

async function fallbackPing() {
  if (!supabase) {
    throw new Error('Supabase client is not initialized')
  }
  const { error } = await supabase.from('message_templates').select('id', { head: true, count: 'exact' })
  if (error) {
    throw error
  }
  return { fallback: true }
}

export function getSupabaseHealthSnapshot() {
  return healthState
}

export function subscribeSupabaseHealth(listener) {
  if (typeof listener !== 'function') {
    throw new TypeError('Supabase health listener must be a function')
  }
  healthListeners.add(listener)
  listener(healthState)
  return () => {
    healthListeners.delete(listener)
  }
}

export async function pingSupabaseHealth({ reason } = {}) {
  if (inflightPing) {
    return inflightPing
  }

  if (!isSupabaseReady()) {
    setHealthState({
      state: 'offline',
      updatedAt: new Date().toISOString(),
      error: null,
      fallback: false,
      heartbeatAt: null,
      meta: { reason: reason ?? 'manual', fallback: false },
    })
    return { ok: false, reason: 'not-configured' }
  }

  setHealthState((current) => ({
    state: current?.state === 'online' ? current.state : 'checking',
    error: null,
  }))

  const executePing = async () => {
    try {
      const { error, data } = await supabase.rpc('touch_service_heartbeat')
      if (error) {
        const missingHeartbeat = typeof error.message === 'string' && error.message.includes('touch_service_heartbeat')
        if (!missingHeartbeat) {
          throw error
        }
        const fallbackResult = await fallbackPing()
        setHealthState({
          state: 'degraded',
          updatedAt: new Date().toISOString(),
          error: null,
          fallback: true,
          heartbeatAt: null,
          meta: { reason: reason ?? 'manual', fallback: true },
        })
        return { ok: true, fallback: true, data: fallbackResult }
      }
      setHealthState({
        state: 'online',
        updatedAt: new Date().toISOString(),
        error: null,
        fallback: false,
        heartbeatAt: data ?? null,
        meta: { reason: reason ?? 'manual', fallback: false },
      })
      return { ok: true, fallback: false, data }
    } catch (error) {
      console.warn('Supabase keep-alive ping failed:', error)
      setHealthState({
        state: 'error',
        updatedAt: new Date().toISOString(),
        error,
        fallback: false,
        heartbeatAt: null,
        meta: { reason: reason ?? 'manual', fallback: false },
      })
      return { ok: false, error }
    } finally {
      inflightPing = null
    }
  }

  inflightPing = executePing()
  return inflightPing
}

function stopKeepAliveTimer() {
  if (keepAliveTimer) {
    clearInterval(keepAliveTimer)
    keepAliveTimer = null
  }
}

export function ensureSupabaseKeepAlive() {
  if (!isSupabaseReady()) {
    stopKeepAliveTimer()
    keepAliveConsumers = 0
    return () => {}
  }

  attachVisibilityPing()

  keepAliveConsumers += 1

  if (!keepAliveTimer) {
    keepAliveTimer = setInterval(() => {
      void pingSupabaseHealth({ reason: 'interval' })
    }, RESOLVED_KEEP_ALIVE_INTERVAL_MS)
    void pingSupabaseHealth({ reason: 'startup' })
  }

  return () => {
    keepAliveConsumers = Math.max(keepAliveConsumers - 1, 0)
    if (keepAliveConsumers === 0) {
      stopKeepAliveTimer()
    }
  }
}
