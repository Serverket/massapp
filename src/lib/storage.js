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

export async function recordContactSends({ contactIds, sendMetricId = null, sentAt = null }) {
  if (!isSupabaseReady()) {
    return { error: new Error('Supabase client is not configured') }
  }

  const uniqueIds = Array.from(new Set(contactIds ?? [])).filter(Boolean)
  if (uniqueIds.length === 0) {
    return { error: null }
  }

  const rows = uniqueIds.map((contactId) => ({
    contact_id: contactId,
    send_metric_id: sendMetricId,
    ...(sentAt ? { sent_at: sentAt } : {}),
  }))

  const { error } = await supabase.from('contact_sends').insert(rows, { returning: 'minimal' })
  return { error }
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

export async function toggleContactDeliveryStatus({ contactId, currentStatus }) {
  if (!isSupabaseReady()) {
    return { error: new Error('Supabase client is not configured') }
  }

  if (!contactId) {
    return { error: new Error('Contact id is required') }
  }

  const markAsSent = currentStatus !== 'green'
  const nextLastSentAt = markAsSent ? new Date().toISOString() : null

  const { data, error } = await supabase
    .from('contacts')
    .update({ last_sent_at: nextLastSentAt })
    .eq('id', contactId)
    .select('id, status, last_sent_at')
    .single()

  return { data, error }
}
