'use client'

import { Suspense, useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import Header from '@/components/Header'
import NetworkGraph from '@/components/NetworkGraph'
import Sidebar from '@/components/Sidebar'
import { GraphFilters, defaultFilters, GraphData } from '@/lib/data'
import type { GraphMode, FilterType } from '@/lib/data'

function useInitialFilters(): GraphFilters {
  const searchParams = useSearchParams()
  const procedure = searchParams.get('procedure')
  const mode = searchParams.get('mode') as GraphMode | null
  const filterType = searchParams.get('filterType') as FilterType | null

  return {
    ...defaultFilters,
    ...(mode && { mode }),
    ...(filterType && { filterType }),
    ...(procedure && { procedure, filterType: filterType ?? 'procedure' }),
  }
}

function NetworkPageInner() {
  const initialFilters = useInitialFilters()
  const [chargeStrength, setChargeStrength] = useState(-150)
  const [filters, setFilters] = useState<GraphFilters>(initialFilters)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [graphData, setGraphData] = useState<GraphData | null>(null)

  // Trigger resize event when sidebar collapses/expands
  useEffect(() => {
    const timer = setTimeout(() => {
      window.dispatchEvent(new Event('resize'))
    }, 300)
    return () => clearTimeout(timer)
  }, [sidebarCollapsed])

  return (
    <>
      <Header />
      <div className="app-container">
        <Sidebar
          collapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
          chargeStrength={chargeStrength}
          setChargeStrength={setChargeStrength}
          filters={filters}
          setFilters={setFilters}
        />

        <main className={`main-content ${sidebarCollapsed ? 'collapsed' : ''}`}>
          <div className="chart-container h-[calc(100vh-64px-3rem)]">
            <NetworkGraph
              chargeStrength={chargeStrength}
              filters={filters}
              setFilters={setFilters}
              onDataLoad={setGraphData}
            />
            <div className="graph-byline">
              {graphData ? (
                <>
                  {graphData.nodes?.length ?? 0} nodes · {graphData.links?.length ?? 0} edges
                  {graphData.metadata?.org_min_degree_used != null &&
                  graphData.metadata?.actor_min_degree_used != null &&
                  graphData.metadata?.k_core_used != null &&
                  graphData.metadata?.min_edge_weight_used != null ? (
                    <> · org≥{graphData.metadata.org_min_degree_used} · actor≥{graphData.metadata.actor_min_degree_used} · k={graphData.metadata.k_core_used} · w≥{graphData.metadata.min_edge_weight_used}</>
                  ) : null}
                  {filters.start && filters.end ? (
                    <> · {filters.start} → {filters.end}</>
                  ) : null}
                </>
              ) : (
                <>Loading…</>
              )}
            </div>
          </div>
        </main>
      </div>
    </>
  )
}

export default function NetworkPage() {
  return (
    <Suspense>
      <NetworkPageInner />
    </Suspense>
  )
}
