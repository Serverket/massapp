import { supabase, isSupabaseReady } from './supabaseClient.js'

export async function recordSendMetrics({ recipientCount, messageBody, templateId, mode }) {
  if (!isSupabaseReady()) {
    return { error: new Error('Supabase client is not configured') }
  }

  const payload = {
    recipient_count: recipientCount,
    message_body: messageBody,
    template_id: templateId ?? null,
    mode: mode ?? 'web',
  }

  const { data, error } = await supabase.from('send_metrics').insert(payload).select().single()
  return { data, error }
}

export async function fetchTemplates() {
  if (!isSupabaseReady()) {
    return { error: new Error('Supabase client is not configured'), data: [] }
  }

  const { data, error } = await supabase.from('message_templates').select('*').order('name', { ascending: true })
  return { data: data ?? [], error }
}

export async function upsertTemplate({ id, name, body, locale }) {
  if (!isSupabaseReady()) {
    return { error: new Error('Supabase client is not configured') }
  }

  const entry = {
    name,
    body,
    locale,
  }

  if (id) {
    entry.id = id
  }

  const { data, error } = await supabase.from('message_templates').upsert(entry).select().single()
  return { data, error }
}

export async function removeTemplate(id) {
  if (!isSupabaseReady()) {
    return { error: new Error('Supabase client is not configured') }
  }

  const { error } = await supabase.from('message_templates').delete().eq('id', id)
  return { error }
}
