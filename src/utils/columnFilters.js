// Shared per-column filter model for report tables.
// Server requests keep API operators; local rows use the same filter shape via matchesColumnFilters.
import { toServerEpoch } from './dateFormatter.js'

export const COLUMN_FILTER_OPERATORS = {
  equal: 'equal',
  notEqual: 'not_equal',
  lessThan: 'less_than',
  lessThanOrEqual: 'less_than_or_equal',
  greaterThan: 'greater_than',
  greaterThanOrEqual: 'greater_than_or_equal',
  contains: 'contains',
  notContains: 'not_contains',
  startsWith: 'starts_with',
  endsWith: 'ends_with',
}

export const COLUMN_FILTER_OPTIONS = {
  number: [
    ['equal', 'Equal...'],
    ['notEqual', 'Not Equal...'],
    ['lessThan', 'Less Than...'],
    ['lessThanOrEqual', 'Less Than Or Equal...'],
    ['greaterThan', 'Greater Than...'],
    ['greaterThanOrEqual', 'Greater Than Or Equal...'],
    ['between', 'Between...'],
  ],
  text: [
    ['equal', 'Equal...'],
    ['notEqual', 'Not Equal...'],
    ['startsWith', 'Starts With...'],
    ['endsWith', 'Ends With...'],
    ['contains', 'Contains...'],
    ['doesNotContain', 'Does Not Contain...'],
  ],
  date: [
    ['equal', 'Equal...'],
    ['notEqual', 'Not Equal...'],
    ['lessThanOrEqual', 'Before Or At...'],
    ['greaterThanOrEqual', 'After Or At...'],
    ['between', 'Between...'],
  ],
}

const hasValue = value => value !== null && value !== undefined && String(value).trim() !== ''
const normalizeText = value => String(value ?? '').trim().toLowerCase()
const normalizeNumber = value => {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

export function columnFilterValue(raw, type, kind) {
  if (!hasValue(raw)) return null
  if (kind === 'date') {
    const date = new Date(String(raw))
    return Number.isNaN(date.getTime()) ? null : toServerEpoch(date)
  }
  return kind === 'number' ? normalizeNumber(raw) : String(raw).trim()
}

export function buildColumnFilter({ type = 'equal', value1 = '', value2 = '', kind = 'text' }) {
  if (!COLUMN_FILTER_OPTIONS[kind]?.some(([value]) => value === type)) throw new Error('Choose a valid filter condition.')
  const first = columnFilterValue(value1, type, kind)
  const second = type === 'between' ? columnFilterValue(value2, type, kind) : null
  if (first === null) throw new Error('Enter a filter value.')
  if (['number', 'date'].includes(kind) && (first === null || (type === 'between' && second === null))) throw new Error('Enter valid values.')
  if (type === 'between' && first != null && second != null && first > second) throw new Error('The From value cannot be greater than the To value.')
  return { type, value1: first, value2: second }
}

export function matchesColumnFilter(value, filter) {
  if (!filter) return true
  if (filter.type === 'between') {
    const left = normalizeNumber(value)
    const first = normalizeNumber(filter.value1)
    const second = normalizeNumber(filter.value2)
    if (left === null || first === null || second === null) return false
    return left >= first && left <= second
  }
  if (['equal', 'notEqual', 'lessThan', 'lessThanOrEqual', 'greaterThan', 'greaterThanOrEqual'].includes(filter.type)) {
    const left = normalizeNumber(value)
    const right = normalizeNumber(filter.value1)
    if (left !== null && right !== null) {
      return filter.type === 'equal' ? left === right
        : filter.type === 'notEqual' ? left !== right
        : filter.type === 'lessThan' ? left < right
        : filter.type === 'lessThanOrEqual' ? left <= right
        : filter.type === 'greaterThan' ? left > right
        : left >= right
    }
  }
  const left = normalizeText(value)
  const right = normalizeText(filter.value1)
  if (left === '' || right === '') return false
  return filter.type === 'equal' ? left === right
    : filter.type === 'notEqual' ? left !== right
    : filter.type === 'startsWith' ? left.startsWith(right)
    : filter.type === 'endsWith' ? left.endsWith(right)
    : filter.type === 'notContains' ? !left.includes(right)
    : left.includes(right)
}

export function matchesColumnFilters(row, filters, getValue) {
  return Object.entries(filters || {}).every(([key, filter]) => {
    if (!filter) return true
    const columnKey = key.endsWith('_custom') ? key.slice(0, -7) : key
    return matchesColumnFilter(getValue(row, columnKey), filter)
  })
}

export function filterRowsByColumnFilters(rows, filters, getValue) {
  if (typeof getValue !== 'function') throw new Error('A row value getter is required for column filtering.')
  if (!rows.length || !Object.keys(filters || {}).length) return rows
  return rows.filter(row => matchesColumnFilters(row, filters, getValue))
}

export function rowFieldValue(row, field, aliases = []) {
  const keys = [field, ...aliases]
  for (const key of keys) {
    if (row?.[key] !== undefined && row?.[key] !== null && row?.[key] !== '') return row[key]
  }
  const wanted = new Set(keys.map(key => String(key).toLowerCase().replace(/[^a-z0-9]/g, '')))
  for (const [key, value] of Object.entries(row || {})) {
    if (wanted.has(key.toLowerCase().replace(/[^a-z0-9]/g, '')) && value !== undefined && value !== null && value !== '') return value
  }
  return ''
}

export function columnFiltersForRequest(filters, getValue = null, fieldMap = {}) {
  const requests = []
  for (const [key, filter] of Object.entries(filters || {})) {
    if (!filter) continue
    const field = fieldMap[key.endsWith('_custom') ? key.slice(0, -7) : key] || (key.endsWith('_custom') ? key.slice(0, -7) : key)
    if (filter.type === 'between') {
      const first = normalizeNumber(filter.value1)
      const second = normalizeNumber(filter.value2)
      if (first !== null) requests.push({ field, operator: 'greater_than_or_equal', value: first })
      if (second !== null) requests.push({ field, operator: 'less_than_or_equal', value: second })
      continue
    }
    const operator = COLUMN_FILTER_OPERATORS[filter.type]
    if (!operator || !hasValue(filter.value1)) continue
    const value = getValue ? getValue(filter.value1, field, filter.type) : filter.value1
    if (hasValue(value)) requests.push({ field, operator, value })
  }
  return requests
}

export function sortRowsByColumn(rows, getValue, columnKey, direction = 'asc') {
  if (!columnKey) return rows
  const multiplier = direction === 'desc' ? -1 : 1
  return [...rows].sort((left, right) => {
    const a = getValue(left, columnKey)
    const b = getValue(right, columnKey)
    const aNumber = normalizeNumber(a)
    const bNumber = normalizeNumber(b)
    if (aNumber !== null && bNumber !== null) return (aNumber - bNumber) * multiplier
    const aText = normalizeText(a)
    const bText = normalizeText(b)
    if (aText < bText) return -1 * multiplier
    if (aText > bText) return multiplier
    return 0
  })
}
