import { useEffect, useState } from 'react'
import {
  ensureSupabaseKeepAlive,
  getSupabaseHealthSnapshot,
  pingSupabaseHealth,
  subscribeSupabaseHealth,
} from './supabaseClient.js'

export function useSupabaseHealth() {
  const [health, setHealth] = useState(() => getSupabaseHealthSnapshot())

  useEffect(() => {
    const unsubscribe = subscribeSupabaseHealth(setHealth)
    const stopKeepAlive = ensureSupabaseKeepAlive()
    void pingSupabaseHealth({ reason: 'hook-init' })

    return () => {
      unsubscribe()
      stopKeepAlive()
    }
  }, [])

  return health
}
