const RAW_ZAI_KEY = import.meta.env.VITE_ZAI_API_KEY
const ZAI_CHAT_URL = import.meta.env.VITE_ZAI_CHAT_URL ?? 'https://open.bigmodel.cn/api/paas/v4/chat/completions'
const ZAI_MODEL = import.meta.env.VITE_ZAI_MODEL ?? 'GLM-4.7-Flash'

function safeTrim(value) {
  return typeof value === 'string' ? value.trim() : ''
}

export function isZaiConfigured() {
  return Boolean(ZAI_KEY_PARTS?.apiKey && ZAI_KEY_PARTS?.apiSecret)
}

const ZAI_KEY_PARTS = (() => {
  if (!RAW_ZAI_KEY) {
    return null
  }
  const parts = RAW_ZAI_KEY.split('.')
  if (parts.length === 2 && parts[0] && parts[1]) {
    return {
      apiKey: parts[0],
      apiSecret: parts[1],
    }
  }
  return {
    apiKey: RAW_ZAI_KEY,
    apiSecret: null,
  }
})()

let cachedAuthToken = null
let cachedAuthExpiry = 0
let inflightTokenPromise = null

function toUint8Array(value) {
  if (value instanceof Uint8Array) {
    return value
  }
  return new TextEncoder().encode(value)
}

function base64UrlEncode(buffer) {
  const bytes = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : buffer
  let string = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize)
    string += String.fromCharCode.apply(null, chunk)
  }
  return btoa(string).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

async function createHmacSha256(keyBytes, messageBytes) {
  if (typeof crypto !== 'undefined' && crypto?.subtle) {
    const cryptoKey = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: { name: 'SHA-256' } }, false, ['sign'])
    const signature = await crypto.subtle.sign('HMAC', cryptoKey, messageBytes)
    return signature
  }

  try {
    const { createHmac } = await import('crypto')
    const hmac = createHmac('sha256', Buffer.from(keyBytes))
    hmac.update(Buffer.from(messageBytes))
    return hmac.digest().buffer
  } catch (error) {
    throw new Error('Unable to access crypto.subtle or Node crypto for Z AI token generation')
  }
}

async function generateZaiAuthToken() {
  if (!ZAI_KEY_PARTS?.apiSecret) {
    throw new Error('Z AI API key must include secret component (expected format apiKey.apiSecret)')
  }

  const nowSeconds = Math.floor(Date.now() / 1000)
  const header = {
    alg: 'HS256',
    sign_type: 'SIGN',
    typ: 'JWT',
  }
  const payload = {
    api_key: ZAI_KEY_PARTS.apiKey,
    exp: nowSeconds + 3600,
    timestamp: nowSeconds,
  }

  const headerEncoded = base64UrlEncode(toUint8Array(JSON.stringify(header)))
  const payloadEncoded = base64UrlEncode(toUint8Array(JSON.stringify(payload)))
  const signingInput = `${headerEncoded}.${payloadEncoded}`

  const signatureRaw = await createHmacSha256(toUint8Array(ZAI_KEY_PARTS.apiSecret), toUint8Array(signingInput))
  const signatureEncoded = base64UrlEncode(new Uint8Array(signatureRaw))
  const token = `${signingInput}.${signatureEncoded}`

  return { token, exp: payload.exp }
}

async function getZaiAuthToken() {
  const nowSeconds = Math.floor(Date.now() / 1000)
  if (cachedAuthToken && cachedAuthExpiry - 60 > nowSeconds) {
    return cachedAuthToken
  }

  if (inflightTokenPromise) {
    return inflightTokenPromise
  }

  inflightTokenPromise = generateZaiAuthToken()
    .then(({ token, exp }) => {
      cachedAuthToken = token
      cachedAuthExpiry = exp
      inflightTokenPromise = null
      return token
    })
    .catch((error) => {
      inflightTokenPromise = null
      throw error
    })

  return inflightTokenPromise
}

export async function createZaiChatCompletion({ messages, model = ZAI_MODEL, temperature = 0.3, topP = 0.9, maxTokens, responseFormat } = {}) {
  if (!isZaiConfigured()) {
    return { error: new Error('Z AI API key is not configured'), data: null }
  }

  if (!Array.isArray(messages) || messages.length === 0) {
    return { error: new Error('Messages are required for Z AI request'), data: null }
  }

  const payload = {
    model: safeTrim(model) || ZAI_MODEL,
    messages,
    temperature,
    top_p: topP,
  }

  if (typeof maxTokens === 'number' && Number.isFinite(maxTokens)) {
    payload.max_tokens = maxTokens
  }

  if (responseFormat) {
    payload.response_format = responseFormat
  }

  try {
    const authToken = await getZaiAuthToken()
    const response = await fetch(ZAI_CHAT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      const errorText = safeTrim(await response.text())
      const reason = errorText ? `${response.status} ${errorText}` : `${response.status} ${response.statusText}`
      return { error: new Error(`Z AI request failed: ${reason}`), data: null }
    }

    const data = await response.json()
    return { data, error: null }
  } catch (error) {
    return { error, data: null }
  }
}
