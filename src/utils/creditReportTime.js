import { apiTimeSecond } from './dateFormatter.js'
import { matchesColumnFilter, rowFieldValue, sortRowsByColumn } from './columnFilters.js'
import { parseCreditReport } from './creditReport.js'

// Display, predicates, sorting and CSV must read the same API wall clock.
export const creditTimeValue = row => rowFieldValue(row, 'time', ['timeStr', 'dealTime', 'deal_time', 'timestamp', 'timestampStr', 'date'])
export const creditSortValue = (row, key) => key === 'time' ? apiTimeSecond(creditTimeValue(row)) : rowFieldValue(row, key)
export function filterCreditTime(rows, filter, sortBy, sortOrder) {
  if (!filter) return rows
  const filtered = rows.filter(row => {
    const second = apiTimeSecond(creditTimeValue(row))
    return second !== '' && matchesColumnFilter(second, filter)
  })
  return sortRowsByColumn(filtered, creditSortValue, sortBy, sortOrder)
}

// Never infer completion from a short page: the API can cap the requested limit.
export async function fetchCreditCandidates(getReport, body, collectAll, signal, isCurrent) {
  const rows = [], seenPages = new Set()
  let page = collectAll ? 1 : body.page
  while (isCurrent() && !signal.aborted) {
    const response = await getReport({ ...body, page }, { signal })
    if (!isCurrent() || signal.aborted) return null
    const result = parseCreditReport(response)
    if (result.rows.some(row => !row || typeof row !== 'object' || Array.isArray(row))) throw new Error('Invalid credit report row.')
    if (!collectAll) return result
    const signature = JSON.stringify(result.rows)
    if (result.rows.length && seenPages.has(signature)) throw new Error('Credit pagination did not advance.')
    seenPages.add(signature)
    rows.push(...result.rows)
    if (!result.rows.length && result.total > rows.length) throw new Error('Credit response is incomplete.')
    if (!result.rows.length || (result.total !== null && rows.length >= result.total)
      || (result.total === null && result.pages !== null && page >= result.pages)) {
      return { rows, total: rows.length, pages: null }
    }
    page++
  }
  return null
}