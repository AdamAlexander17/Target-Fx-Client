import { useCallback, useMemo, useState } from 'react'
import { columnFiltersForRequest, matchesColumnFilters, sortRowsByColumn } from '../utils/columnFilters'

// Owns active per-column condition filters and the shared menu's open state.
export default function useColumnFilters() {
  const [filters, setFilters] = useState({})
  const [openColumn, setOpenColumn] = useState(null)

  const setFilter = useCallback((columnKey, filter) => {
    setFilters(current => ({ ...current, [`${columnKey}_custom`]: filter }))
    setOpenColumn(null)
  }, [])
  const clearFilter = useCallback(columnKey => {
    setFilters(current => {
      const next = { ...current }
      delete next[`${columnKey}_custom`]
      return next
    })
    setOpenColumn(null)
  }, [])
  const activeFilters = useMemo(() => filters, [filters])
  const requestFilters = useMemo(() => columnFiltersForRequest(filters), [filters])
  const filterRows = useCallback((rows, getValue) => (
    Object.keys(filters).length ? rows.filter(row => matchesColumnFilters(row, filters, getValue)) : rows
  ), [filters])
  const sortRows = useCallback((rows, getValue, sortBy, sortOrder) => sortRowsByColumn(rows, getValue, sortBy, sortOrder), [])

  return {
    filters,
    requestFilters,
    activeFilters,
    filterRows,
    sortRows,
    setFilter,
    clearFilter,
    clearAll: useCallback(() => { setFilters({}); setOpenColumn(null) }, []),
    openColumn,
    openMenu: setOpenColumn,
    closeMenu: () => setOpenColumn(null),
  }
}
