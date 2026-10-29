export const calculatorNumber = value => {
  if (value == null || (typeof value === 'string' && value.trim() === '')) return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

export function calculatorData(response) {
  if (response?.status === 'error' || response?.status === false) {
    throw new Error(response.message || 'The calculator request failed.')
  }
  if (!response?.data || typeof response.data !== 'object') {
    throw new Error('The calculator returned an invalid response.')
  }
  return response.data
}

export function calculatorReport(response) {
  const data = calculatorData(response)
  if (!Array.isArray(data.logins) || !Array.isArray(data.exchanges) || !Array.isArray(data.pending)
    || !data.summary || !data.pagination || !data.usd_inr) {
    throw new Error('The calculator report is incomplete. Please retry or contact support.')
  }
  return data
}

export function calculatorRateRows(rows, client = false) {
  const seen = new Set()
  return rows.map(row => {
    const exchange = String(row.exchange || '').trim()
    const login = calculatorNumber(row.login)
    if (!exchange) throw new Error('Choose an exchange for every rate.')
    if (client && (!Number.isSafeInteger(login) || login <= 0)) throw new Error('Enter a valid positive client login.')
    const key = client ? `${login}:${exchange}` : exchange
    if (seen.has(key)) throw new Error(`Duplicate rate for ${key}.`)
    seen.add(key)
    const method = row.method || null
    if (method !== null && !['lot', 'crore'].includes(method)) throw new Error(`Choose Per Lot or Per Crore for ${exchange}.`)
    const blank = row.rate == null || String(row.rate).trim() === ''
    const rate = blank ? null : calculatorNumber(row.rate)
    if (!blank && (rate == null || rate < 0)) throw new Error(`Enter a non-negative rate for ${exchange}, or leave it blank.`)
    if (client) return { login, exchange, method, rate }
    // The rate's currency is fixed per exchange by the backend, so it is never sent
    return { exchange, method, rate }
  })
}

// Report-scoped editing must not expose unrelated saved overrides or exchanges.
export function calculatorClientRateScope(exchanges, saved, login, scope) {
  const names = [...new Set(scope.map(item => typeof item === 'string' ? item : item.exchange).filter(Boolean))]
  const allowed = new Set(names)
  const original = saved.filter(row => String(row.login) === String(login) && allowed.has(row.exchange))
  return {
    exchanges: names.map(exchange => exchanges.find(item => item.exchange === exchange) || { exchange }),
    original,
    rows: names.map(exchange => {
      const row = original.find(item => item.exchange === exchange)
      return { ...(row || { login, exchange, fixed: true }), method: row?.method ?? '', rate: row?.rate ?? '' }
    }),
  }
}

// Group rates: one row per saved filter group × exchange; blank method/rate = use the exchange rate
export function changedGroupRates(rows, original) {
  const key = row => `${row.group}\u0000${row.exchange}`
  const normalize = row => {
    const method = row.method || null
    if (method !== null && !['lot', 'crore'].includes(method)) throw new Error(`Choose Per Lot or Per Crore for ${row.exchange}.`)
    const blank = row.rate == null || String(row.rate).trim() === ''
    const rate = blank ? null : calculatorNumber(row.rate)
    if (!blank && (rate == null || rate < 0)) throw new Error(`Enter a non-negative rate for ${row.exchange}, or leave it blank.`)
    return { group: row.group, exchange: row.exchange, method, rate }
  }
  const before = new Map(original.map(row => [key(row), JSON.stringify(normalize(row))]))
  const changed = rows.map(normalize).filter(row => (before.get(key(row)) ?? JSON.stringify({ ...row, method: null, rate: null })) !== JSON.stringify(row))
  if (changed.length > 1000) throw new Error('Save no more than 1,000 changed rates at a time.')
  return changed
}

export function changedCalculatorRates(rows, original, client = false) {
  const normalized = calculatorRateRows(rows, client)
  const saved = calculatorRateRows(original, client)
  const key = row => client ? `${row.login}:${row.exchange}` : row.exchange
  const before = new Map(saved.map(row => [key(row), JSON.stringify(row)]))
  const changed = normalized.filter(row => before.get(key(row)) !== JSON.stringify(row))
  if (changed.length > 1000) throw new Error('Save no more than 1,000 changed rates at a time.')
  return changed
}

export function calculatorUsdRate(value) {
  if (value == null || String(value).trim() === '') return null
  const rate = calculatorNumber(value)
  if (rate == null || rate <= 0) throw new Error('USD-INR must be greater than zero, or blank to remove the saved rate.')
  return rate
}

export const calculatorExportView = tab => tab === 'pivot' ? 'exchanges' : tab
