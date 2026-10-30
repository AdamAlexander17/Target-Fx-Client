import assert from 'node:assert/strict'
import test from 'node:test'
import { buildColumnFilter, columnFiltersForRequest } from '../src/utils/columnFilters.js'
import { toServerEpoch, toApiEpoch, serverEpochFromParts, SERVER_UTC_OFFSET_SEC } from '../src/utils/dateFormatter.js'

test('date From/To inputs become an epoch range for report requests', () => {
  const filter = buildColumnFilter({
    type: 'between',
    value1: '2026-10-30T14:30',
    value2: '2026-10-30T15:45',
    kind: 'date',
  })
  assert.equal(filter.value1, toServerEpoch(new Date(2026, 9, 30, 14, 30)))
  assert.equal(filter.value2, toServerEpoch(new Date(2026, 9, 30, 15, 45)))
  assert.deepEqual(columnFiltersForRequest({ time_custom: filter }), [
    { field: 'time', operator: 'greater_than_or_equal', value: filter.value1 },
    { field: 'time', operator: 'less_than_or_equal', value: filter.value2 },
  ])
})

test('reversed or incomplete date ranges are rejected before request', () => {
  assert.throws(() => buildColumnFilter({ type: 'between', value1: '2026-10-30T15:45', value2: '2026-10-30T14:30', kind: 'date' }), /From value/)
  assert.throws(() => buildColumnFilter({ type: 'between', value1: '2026-10-30T14:30', value2: '', kind: 'date' }), /valid values/)
})

test('TIME filter request window catches deals shown in the table', () => {
  // User picks the wall-clock window 15:20-16:30 around a deal the table
  // shows as 30/10/2026 16:24:44 (stored with those server wall-clock fields).
  const filter = buildColumnFilter({
    type: 'between',
    value1: '2026-10-30T15:20',
    value2: '2026-10-30T16:30',
    kind: 'date',
  })
  const dealTime = serverEpochFromParts(2026, 9, 30, 16, 24, 44)
  const from = toApiEpoch(filter.value1)
  const to = toApiEpoch(filter.value2)
  // The API interprets from/to as standard unix epochs in the server
  // timezone, i.e. wall-clock fields offset by SERVER_UTC_OFFSET_SEC.
  assert.ok(from + SERVER_UTC_OFFSET_SEC <= dealTime, 'lower bound must include the deal')
  assert.ok(dealTime <= to + SERVER_UTC_OFFSET_SEC, 'upper bound must include the deal')
  assert.equal(toApiEpoch(toServerEpoch(new Date(2026, 9, 30, 15, 20))), filter.value1 - SERVER_UTC_OFFSET_SEC)
})
