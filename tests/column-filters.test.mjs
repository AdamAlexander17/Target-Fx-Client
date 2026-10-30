import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildColumnFilter,
  columnFiltersForRequest,
  filterRowsByColumnFilters,
  matchesColumnFilters,
  sortRowsByColumn,
} from '../src/utils/columnFilters.js'

const rows = [
  { login: 90002, name: 'Alpha', amount: 10 },
  { login: 90005, name: 'Beta', amount: 100 },
  { login: 90010, name: 'Gamma', amount: -5 },
]

test('column filter conditions evaluate numbers, text and ranges consistently', () => {
  const filters = {
    amount_custom: buildColumnFilter({ type: 'between', value1: '0', value2: '100', kind: 'number' }),
    name_custom: buildColumnFilter({ type: 'contains', value1: 'alp', kind: 'text' }),
  }
  assert.deepEqual(
    filterRowsByColumnFilters(rows, filters, (item, key) => item[key]).map(row => row.login),
    [90002],
  )
  assert.equal(matchesColumnFilters({ name: 'Broker' }, { name_custom: { type: 'doesNotContain', value1: 'bro' } }, (row, key) => row[key]), true)
  assert.equal(matchesColumnFilters({ name: 'Broker' }, { name_custom: { type: 'startsWith', value1: 'bro' } }, (row, key) => row[key]), true)
  assert.equal(matchesColumnFilters({ amount: '100' }, { amount_custom: { type: 'greaterThan', value1: 10 } }, (row, key) => row[key]), true)
})

test('column filters become API filters with comparison bounds for between', () => {
  const filters = {
    amount_custom: { type: 'between', value1: 10, value2: 100 },
    name_custom: { type: 'contains', value1: 'demo' },
  }
  assert.deepEqual(columnFiltersForRequest(filters), [
    { field: 'amount', operator: 'greater_than_or_equal', value: 10 },
    { field: 'amount', operator: 'less_than_or_equal', value: 100 },
    { field: 'name', operator: 'contains', value: 'demo' },
  ])
})

test('column sorting chooses numeric ordering only when both values are numeric', () => {
  assert.deepEqual(
    sortRowsByColumn(rows, (row, key) => row[key], 'amount', 'asc').map(row => row.amount),
    [-5, 10, 100],
  )
  assert.deepEqual(
    sortRowsByColumn(rows, (row, key) => row[key], 'name', 'desc').map(row => row.name),
    ['Gamma', 'Beta', 'Alpha'],
  )
})

test('invalid and inverted filter values are rejected before a report request', () => {
  assert.throws(() => buildColumnFilter({ type: 'between', value1: '100', value2: '10', kind: 'number' }), /From value/)
  assert.throws(() => buildColumnFilter({ type: 'equal', value1: '', kind: 'number' }), /filter value/)
  assert.throws(() => buildColumnFilter({ type: 'notListed', value1: 'x', kind: 'text' }), /valid filter condition/)
})
