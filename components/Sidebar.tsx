'use client'

import { GraphFilters, defaultFilters, GraphMode } from '@/lib/data'

const MIN_DATE = '2024-03-01'
const MAX_DATE = '2025-06-30'

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


        {/* Graph Mode */}
        <div className="filter-section">
          <div className="filter-label">Graph Mode</div>
          <div className="filter-options">
            {(['full', 'mep', 'commission'] as GraphMode[]).map((mode) => (
              <button
                key={mode}
                className={`filter-option ${filters.mode === mode ? 'active' : ''}`}
                onClick={() => updateFilter('mode', mode)}
              >
                {mode === 'full' ? 'Full Network' : mode === 'mep' ? 'MEP — Orgs' : 'Commission — Orgs'}
              </button>
            ))}
          </div>
        </div>

        {/* Timeline */}
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

            <button
              className="filter-option"
              onClick={() => setFilters({ ...filters, start: MIN_DATE, end: MAX_DATE })}
              title="Reset timeline to full range"
            >
              Reset
            </button>
          </div>

          <div className="timeline-hint">
            Available: {MIN_DATE} → {MAX_DATE}
          </div>
        </div>
        
        {/* Charge Strength */}
        <div className="filter-section">
          <div className="filter-label">Layout</div>
          <label className="slider">
            <span>Charge</span>
            <input
              type="range"
              min={-400}
              max={-20}
              step={10}
              value={chargeStrength}
              onChange={(e) => setChargeStrength(Number(e.target.value))}
            />
            <span>{chargeStrength}</span>
          </label>
        </div>

        {/* Reset */}
        <div className="filter-section">
          <button
            className="reset-button"
            onClick={() => {
              setChargeStrength(-150)
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
