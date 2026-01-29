import { createZaiChatCompletion, isZaiConfigured } from './zaiClient.js'

function sanitizeContact(contact) {
  if (!contact || typeof contact !== 'object') {
    return null
  }
  const payload = {
    id: contact.id ?? null,
    full_name: contact.full_name ?? null,
    first_name: contact.first_name ?? null,
    last_name: contact.last_name ?? null,
    company: contact.company ?? null,
    email: contact.email ?? null,
    phone: contact.phone ?? null,
    locale: contact.locale ?? null,
    notes: contact.notes ?? null,
  }
  return payload
}

function normalizeSuggestion(raw, fallbackMessage) {
  if (!raw || typeof raw !== 'object') {
    return {
      message: fallbackMessage,
      summary: null,
      highlights: [],
      confidence: null,
      contactSummary: null,
      raw,
    }
  }

  const message = typeof raw.message === 'string' && raw.message.trim().length > 0 ? raw.message.trim() : fallbackMessage
  const summary = typeof raw.summary === 'string' ? raw.summary.trim() : null
  const highlights = Array.isArray(raw.highlights) ? raw.highlights.filter((item) => typeof item === 'string' && item.trim().length > 0) : []
  const confidence = typeof raw.confidence === 'number' && Number.isFinite(raw.confidence) ? raw.confidence : null
  const contactSummary = typeof raw.contactSummary === 'string' ? raw.contactSummary.trim() : null

  return {
    message,
    summary,
    highlights,
    confidence,
    contactSummary,
    raw,
  }
}

export function canSuggestPersonalization() {
  return isZaiConfigured()
}

export async function suggestTemplatePersonalization({ templateBody, contacts = [], languageHint }) {
  if (!templateBody || typeof templateBody !== 'string' || templateBody.trim().length === 0) {
    return { error: new Error('Template body is required'), data: null }
  }

  if (!isZaiConfigured()) {
    return { error: new Error('Z AI API key is not configured'), data: null }
  }

  const preparedContacts = contacts
    .map((contact) => sanitizeContact(contact))
    .filter(Boolean)
    .slice(0, 3)

  const targetLanguage = typeof languageHint === 'string' && languageHint.trim().length > 0 ? languageHint.trim().slice(0, 5).toLowerCase() : 'en'
  const guidelines = [
    'Craft a concise, warm, professional WhatsApp message.',
    'Match the output language to language_hint exactly. Do not translate away from it.',
    'Use provided contact names verbatim; never insert placeholders like [Name] or {{name}}.',
    'If no name is supplied, write a neutral greeting without placeholders.',
    'Keep the text plain (no markdown) and avoid emoji unless a casual tone already exists.',
  ]

  const payload = {
    template: templateBody,
    language_hint: targetLanguage,
    contacts: preparedContacts,
    guidelines,
    instructions:
      'Follow guidelines strictly. Return JSON with fields message, summary, highlights (array of strings), confidence (0-1 number), contactSummary. Ensure message language equals language_hint.',
  }

  const messages = [
    {
      role: 'system',
      content:
        'You assist with crafting personalized WhatsApp messages for outbound outreach. Respond with concise and empathetic copy that fits casual professional tone.',
    },
    {
      role: 'user',
      content: JSON.stringify(payload),
    },
  ]

  const { data, error } = await createZaiChatCompletion({
    messages,
    temperature: 0.4,
    responseFormat: { type: 'json_object' },
  })

  if (error) {
    return { error, data: null }
  }

  const content = data?.choices?.[0]?.message?.content

  if (!content || typeof content !== 'string') {
    return { error: new Error('Z AI returned an empty response'), data: null }
  }

  let parsed
  try {
    parsed = JSON.parse(content)
  } catch (jsonError) {
    return {
      error: null,
      data: normalizeSuggestion({ message: content, summary: null }, templateBody),
      warning: jsonError,
    }
  }

  return {
    data: normalizeSuggestion(parsed, templateBody),
    error: null,
  }
}
