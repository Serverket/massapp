import { useCallback, useMemo, useRef, useState } from 'react'
import Papa from 'papaparse'
import { read, utils } from 'xlsx'
import { isSupabaseReady, supabase } from '../lib/supabaseClient.js'

const FIELD_ALIASES = {
  full_name: ['full name', 'name', 'nombre', 'contact', 'contact name'],
  phone: ['phone', 'phone number', 'telefono', 'tel', 'mobile', 'celular'],
  email: ['email', 'correo', 'mail', 'e-mail'],
  company: ['company', 'empresa', 'organization', 'organisation', 'business'],
}

function normalizeKey(value) {
  return value ? value.toString().trim().toLowerCase() : ''
}

function sanitizeValue(value) {
  if (value === undefined || value === null) {
    return null
  }
  const trimmed = value.toString().trim()
  return trimmed.length === 0 ? null : trimmed
}

function selectField(record, aliases) {
  for (const alias of aliases) {
    if (record.has(alias)) {
      return sanitizeValue(record.get(alias))
    }
  }
  return null
}

function buildRecord(raw) {
  const normalizedEntries = Object.entries(raw || {}).map(([key, value]) => [normalizeKey(key), value])
  const normalizedMap = new Map(normalizedEntries)

  let fullName = selectField(normalizedMap, FIELD_ALIASES.full_name)
  const firstName = normalizedMap.get('first') || normalizedMap.get('first name') || null
  const lastName = normalizedMap.get('last') || normalizedMap.get('last name') || null
  if (!fullName && (firstName || lastName)) {
    fullName = [firstName, lastName].filter(Boolean).join(' ').trim()
  }

  const phoneRaw = selectField(normalizedMap, FIELD_ALIASES.phone)
  const normalizedPhone = phoneRaw ? phoneRaw.replace(/[^0-9+]/g, '') : null
  const phone = normalizedPhone && normalizedPhone.length >= 6 ? normalizedPhone : null
  const email = selectField(normalizedMap, FIELD_ALIASES.email)?.toLowerCase() ?? null
  const company = selectField(normalizedMap, FIELD_ALIASES.company)

  if (!fullName) {
    return { skipped: true, reason: 'missing_name' }
  }

  if (!phone && !email) {
    return { skipped: true, reason: 'missing_contact' }
  }

  return {
    skipped: false,
    payload: {
      full_name: fullName,
      phone,
      email,
      company,
    },
  }
}

async function parseCsv(file) {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (result) => resolve(result.data),
      error: (error) => reject(error),
    })
  })
}

async function parseSpreadsheet(file) {
  const buffer = await file.arrayBuffer()
  const workbook = read(buffer, { type: 'array' })
  const sheetName = workbook.SheetNames[0]
  const sheet = workbook.Sheets[sheetName]
  return utils.sheet_to_json(sheet, { defval: null })
}

async function loadRows(file) {
  const extension = file.name.split('.').pop()?.toLowerCase()
  if (extension === 'csv' || extension === 'tsv') {
    return parseCsv(file)
  }
  if (extension === 'xlsx' || extension === 'xls') {
    return parseSpreadsheet(file)
  }
  throw new Error('Unsupported file type')
}

const CHUNK_SIZE = 500

function chunkArray(items, size) {
  if (size <= 0) {
    return [items]
  }
  const result = []
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size))
  }
  return result
}

export function ContactsImport({ t, onImportComplete }) {
  const [fileName, setFileName] = useState('')
  const [status, setStatus] = useState('idle')
  const [message, setMessage] = useState('')
  const [details, setDetails] = useState(null)
  const inputRef = useRef(null)

  const disabled = !isSupabaseReady()

  const acceptedTypes = useMemo(() => '.csv,.tsv,.xlsx,.xls', [])

  const handleFileChange = useCallback(
    async (event) => {
      const file = event.target.files?.[0]
      if (!file) {
        return
      }
      setFileName(file.name)
      setStatus('processing')
      setMessage(t('contacts.import.processingState'))
      setDetails(null)

      try {
        if (disabled) {
          throw new Error(t('contacts.import.missingSupabase'))
        }

        const rawRows = await loadRows(file)
        const results = rawRows.map(buildRecord)
        const validRows = results.filter((item) => !item.skipped).map((item) => item.payload)
        const skipped = results.filter((item) => item.skipped)
        const skippedReasons = skipped.reduce((acc, item) => {
          if (!item.reason) {
            return acc
          }
          acc[item.reason] = (acc[item.reason] || 0) + 1
          return acc
        }, {})

        if (validRows.length === 0) {
          setStatus('error')
          setMessage(t('contacts.import.noValidRows'))
          setDetails({ skipped: skipped.length, skippedReasons })
          return
        }

        const dedupeRows = (rows, key) => {
          const map = new Map()
          let duplicates = 0
          for (const row of rows) {
            const identifier = row[key]
            if (!identifier) {
              continue
            }
            const previous = map.get(identifier)
            if (previous) {
              duplicates += 1
              map.set(identifier, { ...previous, ...row })
            } else {
              map.set(identifier, row)
            }
          }
          return { records: Array.from(map.values()), duplicates }
        }

        const rowsWithPhone = validRows.filter((row) => row.phone)
        const rowsWithEmailOnly = validRows.filter((row) => !row.phone && row.email)

        const { records: uniquePhoneRows, duplicates: phoneDuplicates } = dedupeRows(rowsWithPhone, 'phone')
        const { records: uniqueEmailRows, duplicates: emailDuplicates } = dedupeRows(rowsWithEmailOnly, 'email')

        const processedCount = uniquePhoneRows.length + uniqueEmailRows.length
        const duplicateCount = phoneDuplicates + emailDuplicates

        const upsertBatch = async (rows, conflictTarget) => {
          for (const chunk of chunkArray(rows, CHUNK_SIZE)) {
            const { error } = await supabase.from('contacts').upsert(chunk, {
              onConflict: conflictTarget,
              ignoreDuplicates: false,
            })
            if (error) {
              throw error
            }
          }
        }

        if (uniquePhoneRows.length > 0) {
          await upsertBatch(uniquePhoneRows, 'phone')
        }

        if (uniqueEmailRows.length > 0) {
          await upsertBatch(uniqueEmailRows, 'email')
        }

        setStatus('success')
        setMessage(t('contacts.import.success', { count: processedCount }))
        setDetails({
          skipped: skipped.length,
          processed: processedCount,
          duplicates: duplicateCount,
          skippedReasons,
        })

        if (onImportComplete) {
          onImportComplete({
            processed: processedCount,
            skipped: skipped.length,
            duplicates: duplicateCount,
            skippedReasons,
          })
        }
      } catch (error) {
        console.error('Failed to import contacts:', error)
        setStatus('error')
        setMessage(t('contacts.import.error', { message: error.message }))
      } finally {
        if (inputRef.current) {
          inputRef.current.value = ''
        }
      }
    },
    [disabled, onImportComplete, t],
  )

  const handleBrowseClick = useCallback(() => {
    if (disabled || status === 'processing') {
      return
    }
    inputRef.current?.click()
  }, [disabled, status])

  return (
    <article className="flex flex-col gap-4 rounded-2xl border border-slate-700/40 bg-slate-900/70 p-6 shadow-lg shadow-slate-950/50">
      <header className="flex flex-col gap-1.5">
        <h2 className="text-lg font-semibold text-slate-100">{t('contacts.import.title')}</h2>
        <p className="text-sm text-slate-400">{t('contacts.import.subtitle')}</p>
      </header>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="inline-flex items-center gap-3">
          <input
            ref={inputRef}
            type="file"
            accept={acceptedTypes}
            onChange={handleFileChange}
            disabled={disabled || status === 'processing'}
            className="hidden"
          />
          <button
            type="button"
            onClick={handleBrowseClick}
            disabled={disabled || status === 'processing'}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-700/60 bg-slate-900/60 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:border-slate-500/70 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {status === 'processing' ? t('contacts.import.processing') : t('contacts.import.cta')}
          </button>
          {fileName ? <span className="text-xs text-slate-400">{fileName}</span> : null}
        </div>
        <span className="text-xs text-slate-500">{t('contacts.import.acceptedTypes')}</span>
      </div>
      <p className="text-xs text-slate-500">{t('contacts.import.hint')}</p>
      {status !== 'idle' ? (
        <div
          className={`rounded-xl border px-4 py-3 text-sm ${
            status === 'success'
              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
              : status === 'error'
              ? 'border-rose-500/40 bg-rose-500/10 text-rose-200'
              : 'border-slate-600/40 bg-slate-800/40 text-slate-200'
          }`}
        >
          <p>{message}</p>
          {details ? (
            <ul className="mt-2 text-xs text-slate-300">
              {details.processed ? <li>{t('contacts.import.processed', { count: details.processed })}</li> : null}
              {details.skipped ? <li>{t('contacts.import.skipped', { count: details.skipped })}</li> : null}
              {details.duplicates ? <li>{t('contacts.import.duplicates', { count: details.duplicates })}</li> : null}
              {details.skippedReasons
                ? Object.entries(details.skippedReasons).map(([reason, count]) => (
                    <li key={reason}>{t(`contacts.import.skippedReason.${reason}`, { count })}</li>
                  ))
                : null}
            </ul>
          ) : null}
        </div>
      ) : null}
      <div className="rounded-xl border border-dashed border-slate-700/60 bg-slate-900/60 p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{t('contacts.import.sampleHeader')}</p>
        <code className="mt-2 block whitespace-pre-wrap text-xs text-slate-300">
          {t('contacts.import.exampleHeaders')}
        </code>
      </div>
    </article>
  )
}
