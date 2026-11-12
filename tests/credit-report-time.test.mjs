import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { creditTimeValue, creditSortValue, filterCreditTime, fetchCreditCandidates } from '../src/utils/creditReportTime.js'
import { apiTimeSecond, formatTime, toApiEpoch } from '../src/utils/dateFormatter.js'
import { buildCreditRequest } from '../src/utils/creditReport.js'
import { applyReportGroupFilter } from '../src/utils/reportGroupFilter.js'

const source = readFileSync(new URL('../src/pages/CreditReportPage.jsx', import.meta.url), 'utf8')
const service = readFileSync(new URL('../src/services/api.js', import.meta.url), 'utf8')
const second = Date.parse('2026-11-12T09:32:24Z') / 1000
const equal = { type: 'equal', value1: second }
const row = (deal, time = second) => ({ deal, time })
const body = { from: second - 86400, to: second + 86400, page: 3, limit: 500 }
const collect = (api, request = body, controller = new AbortController(), current = () => true) =>
  fetchCreditCandidates(api, request, true, controller.signal, current)

test('Credit getter matches exact displayed UTC wall-clock second for numeric/ms/string aliases', () => {
  for (const value of [second, String(second), second * 1000 + 999, String(second * 1000 + 700),
    '2026.11.12 09:32:24', '12/11/2026 09:32:24', '2026-11-12T09:32:24Z', '2026-11-12T09:32:24-04:00']) {
    for (const key of ['time', 'Time', 'timeStr', 'dealTime', 'deal_time', 'timestamp', 'timestampStr', 'date', 'Deal_Time']) {
      const item = { [key]: value }
      assert.equal(formatTime(creditTimeValue(item)), '12/11/2026 09:32:24')
      assert.equal(creditSortValue(item, 'time'), second)
      assert.deepEqual(filterCreditTime([item], equal, 'time', 'desc'), [item])
    }
  }
  assert.equal(filterCreditTime([row(1, toApiEpoch(second))], equal).length, 0)
  assert.match(source, /key === 'time' \? creditTimeValue\(row\) : field\(row, key\)/)
})

test('all Time operators use whole seconds, inclusive bounds, invalid values never match', () => {
  const rows = [row(1, second - 1), row(2, second * 1000 + 999), row(3, second + 1)]
  for (const [type, ids] of Object.entries({ equal: [2], notEqual: [3, 1], lessThanOrEqual: [2, 1],
    greaterThanOrEqual: [3, 2], between: [3, 2] })) {
    const filter = { type, value1: second, value2: second + 1 }
    assert.deepEqual(filterCreditTime(rows, filter, 'time', 'desc').map(r => r.deal), ids)
    assert.deepEqual(filterCreditTime([{}, row(4, 0), row(5, 'bad'), row(6, '2026-02-31 09:32:24')], filter), [])
  }
  assert.equal(apiTimeSecond(second * 1000 + 999), second)
})

test('request/service preserve period, search, login/amount/group and non-Time columns', () => {
  const request = buildCreditRequest({ ...body, search: ' Alice ', logins: '100,101', amount: '5' })
  request.filters.push({ field: 'comment', operator: 'contains', value: 'credit' })
  assert.ok(applyReportGroupFilter(request, { loginIds: [101, 102] }))
  assert.equal(request.from, body.from); assert.equal(request.to, body.to); assert.equal(request.search, 'Alice')
  assert.deepEqual(request.filters, [{ field: 'amount', operator: 'greater_than', value: 5 },
    { field: 'comment', operator: 'contains', value: 'credit' }, { field: 'login', operator: 'in', value: [101] }])
  const range = { ...request }
  assert.ok(applyReportGroupFilter(range, { range: { from: 100, to: 200 } }))
  assert.equal(range.accountRangeMin, 100); assert.equal(range.accountRangeMax, 200)
  assert.equal(applyReportGroupFilter({}, { loginIds: [] }), false)
  assert.match(service, /api.post\('\/api\/broker\/reports\/credit', body, options\)/)
  assert.match(source, /columnRequestFilters.filter\(item => item.field !== 'time'\)/)
  const handlers = source.slice(source.indexOf('  const applyColumnFilter ='), source.indexOf('  const timeFilter ='))
  assert.doesNotMatch(handlers, /setApplied|toApiEpoch|setPreset/)
})

test('capped candidates all collected, later matches sorted/counted/paginated without losing duplicates', async () => {
  const records = Array.from({ length: 44 }, (_, i) => row(i + 1, i < 20 ? second - 1 : second))
  const calls = []
  const next = await collect(async request => {
    calls.push(request)
    return { data: { credits: records.slice((request.page - 1) * 7, request.page * 7), pagination: { total: 44 } } }
  })
  assert.deepEqual(calls.map(c => c.page), [1, 2, 3, 4, 5, 6, 7])
  assert.ok(calls.every(c => c.from === body.from && c.to === body.to && c.limit === 500))
  const matches = filterCreditTime(next.rows, equal, 'deal', 'desc')
  assert.equal(matches.length, 24)
  assert.deepEqual(matches.slice(15, 30).map(r => r.deal), [29, 28, 27, 26, 25, 24, 23, 22, 21])
  const duplicate = row(1)
  assert.equal((await collect(async request => ({ rows: request.page === 1 ? [duplicate, duplicate] : [], total: 2 }))).rows.length, 2)
})

test('unknown totals scan to empty; page metadata supported; repeated/incomplete/malformed reject', async () => {
  const calls = []
  const next = await collect(async request => { calls.push(request.page); return { items: request.page < 4 ? [row(request.page)] : [] } })
  assert.equal(next.total, 3); assert.deepEqual(calls, [1, 2, 3, 4])
  assert.equal((await collect(async request => ({ records: [row(request.page)], totalPages: 2 }))).total, 2)
  await assert.rejects(collect(async () => ({ credits: [row(1)], total: 5 })), /did not advance/)
  await assert.rejects(collect(async () => ({ credits: [], total: 5 })), /incomplete/)
  await assert.rejects(collect(async () => ({ credits: 'bad' })), /Unexpected credit/)
  await assert.rejects(collect(async () => ({ credits: [null] })), /Invalid credit/)
})

test('ordinary mode issues one selected server page and preserves metadata', async () => {
  let calls = 0
  const next = await fetchCreditCandidates(async request => {
    calls++; assert.equal(request.page, 3); assert.equal(request.limit, 100)
    return { report: [row(3)], pagination: { total: 901, totalPages: 10 } }
  }, { ...body, limit: 100 }, false, new AbortController().signal, () => true)
  assert.equal(calls, 1); assert.equal(next.total, 901); assert.equal(next.pages, 10)
})

test('aborted/stale results cannot publish or request more pages; export shares query/predicate/sort', async () => {
  for (const abort of [true, false]) {
    const controller = new AbortController()
    let current = true, calls = 0
    assert.equal(await collect(async () => {
      calls++; if (abort) controller.abort(); else current = false
      return { credits: [row(1)], total: 5 }
    }, body, controller, () => current), null)
    assert.equal(calls, 1)
  }
  assert.match(source, /storedResult\?\.key === queryKey/)
  assert.match(source, /page: timeFilter \? 1 : page/)
  assert.match(source, /currentQueryRef.current === queryKey && !controller.signal.aborted/)
  const exportCode = source.slice(source.indexOf('  const exportPage ='), source.indexOf('  const totalPages ='))
  assert.match(exportCode, /fetchCreditCandidates\(brokerAPI.getCreditReport, body, true, controller.signal, isCurrent\)/)
  assert.match(exportCode, /filterCreditTime\(next.rows, timeFilter, applied.sortBy, applied.sortOrder\)/)
  assert.match(exportCode, /body.filters = \[...\(body.filters \|\| \[\]\), ...conditions\]/)
  assert.match(source, /return \(\) => controller.abort\(\)/)
})