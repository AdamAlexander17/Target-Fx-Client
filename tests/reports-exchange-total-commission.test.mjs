import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import { transformSync } from 'esbuild'
import XLSX from 'xlsx-js-style'
import { columnFiltersForRequest, filterRowsByColumnFilters, rowFieldValue, sortRowsByColumn } from '../src/utils/columnFilters.js'

const source = readFileSync(new URL('../src/pages/ReportsExchangePage.jsx', import.meta.url), 'utf8')
const { code } = transformSync(source, { loader: 'jsx', format: 'cjs' })
const settle = () => new Promise(resolve => setImmediate(resolve))
const plain = value => JSON.parse(JSON.stringify(value))
const client = (Login, TotalCommission, Exchanges = []) => ({ Login, Name: `Client ${Login}`, AgentCommission: 10, TotalCommission, Exchanges })
const exchange = { Exchange: 'NSE', Commission: -999999, Lots: 2, Volume: 100 }
const payload = (Clients, Totals, page = 1, pages = 1) => ({ data: { Clients, Totals, Pagination: { total: Clients.length, page, total_pages: pages } } })

// Match the existing auth tests: transpile the real component and drive its
// hooks/API deterministically, without copying its calculation or export logic.
async function mount({ response = payload([]), exportResponses, filters = {}, openColumn = null, width = 1440 } = {}) {
  const slots = []
  const effects = []
  const requests = []
  const downloads = []
  const errors = []
  let cursor = 0
  let tree
  let exporting = false
  const react = {
    Fragment: 'fragment',
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState(initial) {
      const index = cursor++
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial
      return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value }]
    },
    useRef(initial) {
      const index = cursor++
      return slots[index] ??= { current: initial }
    },
    useMemo: fn => fn(),
    useEffect: fn => effects.push(fn),
  }
  const module = { exports: {} }
  vm.runInNewContext(code, {
    module, exports: module.exports, React: react,
    window: { innerWidth: width },
    localStorage: { getItem: () => null },
    console,
    require(name) {
      if (name === 'react') return react
      if (name === 'xlsx-js-style') return {
        ...XLSX,
        writeFile: (workbook, filename, options) => downloads.push({ workbook, filename, options }),
      }
      if (name.endsWith('/api')) return { brokerAPI: {
        getSettlementWeeks: async () => ({ data: { weeks: [{ id: 1, name: 'Test Week' }] } }),
        getExchangeData: async (_week, options) => {
          requests.push(plain(options))
          return exporting ? (exportResponses?.[options.page - 1] ?? response) : response
        },
      } }
      if (name.endsWith('/authContextStore')) return { useAuth: () => ({ isAuthenticated: true }) }
      if (name.endsWith('/groupContextStore')) return { useGroups: () => ({ groups: [], getActiveGroupFilter: () => null }) }
      if (name.endsWith('/exportLoading')) return { withExportLoading: fn => fn }
      if (name.endsWith('/columnFilters')) return { rowFieldValue }
      if (name.endsWith('/useColumnFilters')) return { __esModule: true, default: () => ({
        filters,
        openColumn,
        requestFilters: columnFiltersForRequest(filters),
        filterRows: (rows, getValue) => filterRowsByColumnFilters(rows, filters, getValue),
        sortRows: sortRowsByColumn,
      }) }
      if (name.endsWith('/useSearchAsYouType')) return { __esModule: true, default() {} }
      if (name.endsWith('/dateFormatter')) return { formatDate: value => value }
      return { __esModule: true, default: name.split('/').at(-1) }
    },
  })
  function render() {
    cursor = 0
    effects.length = 0
    tree = module.exports.default()
    return tree
  }
  render()
  effects[1]() // settlement weeks
  await settle()
  render()
  effects[2]() // brokerage data
  await settle()
  render()
  return {
    get tree() { return tree },
    render, requests, downloads, errors,
    async export() {
      exporting = true
      const button = nodes(tree, 'button').find(node => text(node).includes('Export CSV'))
      await button.props.onClick()
      render()
      errors.push(...nodes(tree, 'td').filter(node => node.props.role === 'status').map(text))
      assert.deepEqual(errors, [], 'export should not report an error')
      return downloads[0]
    },
  }
}

function nodes(tree, type) {
  if (Array.isArray(tree)) return tree.flatMap(child => nodes(child, type))
  if (!tree || typeof tree !== 'object') return []
  return [...(tree.type === type ? [tree] : []), ...nodes(tree.props?.children, type)]
}
function text(tree) {
  if (Array.isArray(tree)) return tree.map(text).join('')
  return tree && typeof tree === 'object' ? text(tree.props?.children) : tree == null || tree === false ? '' : String(tree)
}
const bodyRows = app => nodes(nodes(app.tree, 'tbody')[0], 'tr')
const footerCells = app => nodes(nodes(app.tree, 'tfoot')[0], 'td')

for (const width of [1440, 390]) {
  test(`shared table at ${width}px: fixed header, signed Indian values, colors and footer`, async () => {
    const app = await mount({ width, response: payload([
      client(1, -255000, [exchange]), client(2, 25.5), client(3, null), client(4, 'invalid'),
    ]) })
    const headers = nodes(app.tree, 'th')
    assert.deepEqual(headers.slice(0, 5).map(text), ['Login', 'Name', 'Agent Commission', 'Total Commission', 'NSE'])
    assert.equal(headers[3].props.rowSpan, 2)
    const trigger = nodes(headers[3], 'ColumnFilterTrigger')[0]
    assert.equal(trigger.props.columnKey, 'total_commission')
    assert.equal(trigger.props['data-kind'], 'number')
    const rows = bodyRows(app).map(row => nodes(row, 'td'))
    assert.ok(rows.every(row => row.length === 7))
    assert.deepEqual(rows.map(row => text(row[3])), ['-2,55,000.00', '25.50', '0.00', '0.00'])
    assert.match(rows[0][3].props.className, /text-\[#EF4444\]/)
    assert.match(rows[1][3].props.className, /text-\[#059669\]/)
    assert.match(rows[2][3].props.className, /text-\[#6B7280\]/)
    assert.equal(text(footerCells(app)[3]), '-2,54,974.50')
    assert.match(footerCells(app)[3].props.className, /text-\[#EF4444\]/)
  })
}

test('API totals aliases, including zero and totals without exchange metadata, override client sums', async () => {
  for (const key of ['TotalCommission', 'totalCommission', 'total_commission']) {
    for (const value of [-123.45, 0, 5]) {
      const app = await mount({ response: payload([client(1, -255000, [exchange])], { [key]: value }) })
      assert.equal(text(footerCells(app)[3]), value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
    }
  }
})

test('numeric filters and sort read client API aliases; fallback totals track filtered rows', async () => {
  const filters = { total_commission_custom: { type: 'lessThan', value1: 0 } }
  const app = await mount({
    filters, openColumn: 'total_commission',
    response: payload([
      client(1, -255000, [exchange]),
      { ...client(2, undefined), totalCommission: '-10.5' },
      { ...client(3, undefined), total_commission: 20 },
    ], { AgentCommission: 10, Exchanges: [exchange] }),
  })
  const menu = nodes(app.tree, 'ColumnFilterMenu')[0]
  assert.equal(menu.props.label, 'Total Commission')
  assert.equal(menu.props.kind, 'number')
  assert.deepEqual(menu.props.value, filters.total_commission_custom)
  menu.props.onSort('desc')
  app.render()
  assert.deepEqual(bodyRows(app).map(row => text(nodes(row, 'td')[0])), ['2', '1'])
  assert.equal(text(footerCells(app)[3]), '-2,55,010.50')
  assert.deepEqual(app.requests[0].filters, [{ field: 'total_commission', operator: 'less_than', value: 0 }])
  assert.equal(nodes(app.tree, 'ColumnFilterMenu')[0].props.sortDirection, 'desc')
})

test('loading and empty states account for all four fixed columns', async () => {
  const empty = await mount()
  assert.equal(nodes(empty.tree, 'td')[0].props.colSpan, 4)
  const loading = await mount({ response: new Promise(() => {}) })
  assert.equal(bodyRows(loading).length, 8)
  assert.ok(bodyRows(loading).every(row => nodes(row, 'td').length === 4))
})

test('SheetJS export preserves numeric signed values, fixed headers and all shifted indices across pages', async () => {
  const first = client(1, -255000, [exchange])
  const second = { ...client(2, undefined, [{ Exchange: 'MCX', Commission: 999, Lots: 3, Volume: 200 }]), total_commission: '12.5' }
  const app = await mount({
    response: payload([first]),
    exportResponses: [payload([first], { totalCommission: -300000 }, 1, 2), payload([second], { TotalCommission: -300000 }, 2, 2)],
  })
  const { workbook, filename, options } = await app.export()
  const ws = workbook.Sheets['Brokerage Data']
  assert.match(filename, /\.csv$/)
  assert.equal(options.bookType, 'csv', 'preserve the existing download format')
  assert.equal(ws.D3.v, 'Total Commission')
  assert.equal(ws.D4.t, 'n')
  assert.equal(ws.D4.v, -255000)
  assert.equal(ws.D5.v, 12.5)
  assert.equal(ws.D6.v, -300000, 'use explicit report total once, not once per page')
  assert.equal(ws.D4.z, '#,##0.00;[Red]-#,##0.00')
  assert.equal(ws.E2.v, 'NSE')
  assert.equal(ws.H2.v, 'MCX')
  assert.deepEqual(['E3', 'F3', 'G3'].map(key => ws[key].v), ['Lots', 'Volume', 'Commission'])
  assert.deepEqual(['E4', 'F4', 'G4'].map(key => ws[key].v), [2, 100, -999999])
  assert.deepEqual(plain(ws['!merges']), [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 9 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: 3 } },
    { s: { r: 1, c: 4 }, e: { r: 1, c: 6 } },
    { s: { r: 1, c: 7 }, e: { r: 1, c: 9 } },
  ])
  assert.equal(ws.D2.v, '')
  assert.equal(ws['!autofilter'].ref, 'A3:J5')
  assert.equal(ws['!cols'].length, 10)
  assert.ok(ws['!cols'][3].wch >= 'Total Commission'.length + 4)
  assert.deepEqual(plain(ws['!freeze']), { xSplit: 4, ySplit: 3 })
  assert.deepEqual(app.requests.slice(1).map(request => request.page), [1, 2])
})

test('export without explicit TotalCommission sums client values, not exchange commissions', async () => {
  const first = client(1, -255000, [exchange])
  const second = { ...client(2, undefined), totalCommission: 12.5 }
  const app = await mount({
    response: payload([first]),
    exportResponses: [payload([first], { AgentCommission: 0, Exchanges: [exchange] }, 1, 2), payload([second, client(3, null), client(4, 'invalid')], null, 2, 2)],
  })
  const { workbook } = await app.export()
  const ws = workbook.Sheets['Brokerage Data']
  assert.equal(ws.D6.v, 0)
  assert.equal(ws.D7.v, 0)
  assert.equal(ws.D8.v, -254987.5)
})

test('export accepts explicit zero totals and supports reports without exchange columns', async () => {
  const app = await mount({ response: payload([client(1, -255000)], { total_commission: 0 }) })
  const { workbook } = await app.export()
  const ws = workbook.Sheets['Brokerage Data']
  assert.equal(ws.D4.v, -255000)
  assert.equal(ws.D5.v, 0)
  assert.equal(ws['!ref'], 'A1:D5')
  assert.equal(ws['!cols'].length, 4)
  assert.equal(ws['!autofilter'].ref, 'A3:D4')
})