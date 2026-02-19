'use client'

import { useState, useEffect } from 'react'
import NetworkGraph from '@/components/NetworkGraph'
import Sidebar from '@/components/Sidebar'
import { GraphFilters, defaultFilters } from '@/lib/data'

export default function Home() {
  const [chargeStrength, setChargeStrength] = useState(-150)
  const [filters, setFilters] = useState<GraphFilters>(defaultFilters)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  // Trigger resize event when sidebar collapses/expands
  useEffect(() => {
    const timer = setTimeout(() => {
      window.dispatchEvent(new Event('resize'))
    }, 300)
    return () => clearTimeout(timer)
  }, [sidebarCollapsed])

  return (
    <>
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
        chargeStrength={chargeStrength}
        setChargeStrength={setChargeStrength}
        filters={filters}
        setFilters={setFilters}
      />

      <main className={`main-content ${sidebarCollapsed ? 'collapsed' : ''}`}>
        <div className="chart-container" style={{ height: 'calc(100vh - 64px - 3rem)' }}>
          <NetworkGraph chargeStrength={chargeStrength} filters={filters} />
        </div>
      </main>
    </>
  )
}
