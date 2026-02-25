'use client'

import { GraphFilters, defaultFilters, GraphMode } from '@/lib/data'
import { fetchGraphProcedures as fetchProcedures } from '@/lib/api'
import { useEffect, useState } from 'react'

const MIN_DATE = '2024-03-01'
const MAX_DATE = '2025-09-19'

interface SidebarProps {
  collapsed: boolean
  onToggle: () => void
  chargeStrength: number
  setChargeStrength: (v: number) => void
  filters: GraphFilters
  setFilters: (f: GraphFilters) => void
}

export default function Sidebar({
  collapsed,
  onToggle,
  chargeStrength,
  setChargeStrength,
  filters,
  setFilters,
}: SidebarProps) {

  const [procedures, setProcedures] = useState<string[]>([])

  useEffect(() => {
    const loadProcedures = async () => {
      try {
        const procs = await fetchProcedures()
        console.log('Loaded procedures:', procs.length, procs.slice(0, 3))
        setProcedures(procs)
      } catch (err) {
        console.error('Failed to load procedures:', err)
        setProcedures([])
      }
    }
    loadProcedures()
  }, [])

  const updateFilter = <K extends keyof GraphFilters>(key: K, value: GraphFilters[K]) => {
    setFilters({ ...filters, [key]: value })
  }

  const setStart = (newStart: string) => {
    if (newStart > filters.end) {
      setFilters({ ...filters, start: newStart, end: newStart })
    } else {
      setFilters({ ...filters, start: newStart })
    }
  }

const setEnd = (newEnd: string) => {
  if (newEnd < filters.start) {
    setFilters({ ...filters, start: newEnd, end: newEnd })
  } else {
    setFilters({ ...filters, end: newEnd })
  }
}

  return (
    <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
      {/* Sidebar Header */}
      <div className="sidebar-header">
        <span className="sidebar-title">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M3 12h18M3 6h18M3 18h18"
            />
          </svg>
          EU Network Graph
        </span>
        <button className="sidebar-toggle" onClick={onToggle}>
          {collapsed ? '>' : '<'}
        </button>
      </div>

      {/* Sidebar Content */}
      <div className="sidebar-content">


        {/* Institution */}
        <div className="filter-section">
          <div className="filter-label">Institution</div>
          <div className="filter-options">
            {(['full', 'mep', 'commission'] as GraphMode[]).map((mode) => (
              <button
                key={mode}
                className={`filter-option ${filters.mode === mode ? 'active' : ''}`}
                onClick={() => {
                  // Reset to timeline filter when switching away from MEP
                  if (mode !== 'mep') {
                    setFilters({ ...filters, mode, filterType: 'timeline', procedure: 'all' })
                  } else {
                    updateFilter('mode', mode)
                  }
                }}
              >
                {mode === 'full' ? 'All meetings' : mode === 'mep' ? 'Lobbyists meetings with Parliament' : 'Lobbyists meetings with Commission'}
              </button>
            ))}
          </div>
        </div>

        {/* Filter Type Selector - MEP only */}
        {filters.mode === 'mep' && (
          <div className="filter-section">
            <div className="filter-label">Filter By</div>
            <div className="filter-options">
              <button
                className={`filter-option ${filters.filterType === 'timeline' ? 'active' : ''}`}
                onClick={() => setFilters({ ...filters, filterType: 'timeline', procedure: 'all' })}
              >
                Timeline
              </button>
              <button
                className={`filter-option ${filters.filterType === 'procedure' ? 'active' : ''}`}
                onClick={() => updateFilter('filterType', 'procedure')}
              >
                Procedure
              </button>
            </div>
          </div>
        )}

        {/* Timeline - shown when filterType is timeline */}
        {filters.filterType === 'timeline' && (
          <div className="filter-section">
            <div className="filter-label">Timeline</div>
            <div className="timeline-grid">
              <label className="timeline-field">
                <span>Start</span>
                <input
                  type="date"
                  min={MIN_DATE}
                  max={MAX_DATE}
                  value={filters.start}
                  onChange={(e) => setStart(e.target.value)}
                />
              </label>

              <label className="timeline-field">
                <span>End</span>
                <input
                  type="date"
                  min={MIN_DATE}
                  max={MAX_DATE}
                  value={filters.end}
                  onChange={(e) => setEnd(e.target.value)}
                />
              </label>
            </div>

            <div className="timeline-hint mt-2 text-xs text-[#64748b]">
              Available: {MIN_DATE} → {MAX_DATE}
            </div>
          </div>
        )}

        {/* Procedure Filter - shown when filterType is procedure and mode is mep */}
        {filters.filterType === 'procedure' && filters.mode === 'mep' && (
          <div className="filter-section">
            <div className="filter-label">Procedure</div>
            <select
              value={filters.procedure}
              onChange={(e) => updateFilter('procedure', e.target.value)}
              className="w-full p-2 text-sm rounded-[6px] border border-[#cbd5e1] bg-white text-[#1e293b] cursor-pointer"
            >
              <option value="all">All Procedures</option>
              {procedures.map((proc) => (
                <option key={proc} value={proc}>
                  {proc}
                </option>
              ))}
            </select>
          </div>
        )}
        
        {/* Reset */}
        <div className="filter-section">
          <button
            className="reset-button"
            onClick={() => {
              setFilters(defaultFilters)
            }}
          >
            Reset all
          </button>
        </div>
      </div>
    </aside>
  )
}
