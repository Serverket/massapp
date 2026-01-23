import { useEffect, useState } from 'react'
import { supabase, isSupabaseReady } from './supabaseClient.js'

export function useSupabaseAuth() {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!isSupabaseReady()) {
      setLoading(false)
      setSession(null)
      setError(new Error('Supabase client is not configured'))
      return
    }

    let isMounted = true

    const bootstrap = async () => {
      try {
        const { data, error: sessionError } = await supabase.auth.getSession()
        if (!isMounted) {
          return
        }
        if (sessionError) {
          setError(sessionError)
        } else {
          setSession(data?.session ?? null)
          setError(null)
        }
      } catch (error_) {
        if (!isMounted) {
          return
        }
        setError(error_)
      } finally {
        if (isMounted) {
          setLoading(false)
        }
      }
    }

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession)
    })

    bootstrap()

    return () => {
      isMounted = false
      subscription?.subscription?.unsubscribe()
    }
  }, [])

  return { session, loading, error }
}
