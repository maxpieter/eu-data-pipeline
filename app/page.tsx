'use client'

import { useState, useEffect } from 'react'
import NetworkGraph from '@/components/NetworkGraph'
import Sidebar from '@/components/Sidebar'
import { GraphFilters, defaultFilters, GraphData } from '@/lib/data'

export default function Home() {
  const [chargeStrength, setChargeStrength] = useState(-150)
  const [filters, setFilters] = useState<GraphFilters>(defaultFilters)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [graphData, setGraphData] = useState<GraphData | null>(null)

  // Trigger resize event when sidebar collapses/expands
  useEffect(() => {
    const timer = setTimeout(() => {
      window.dispatchEvent(new Event('resize'))
    }, 300)
    return () => clearTimeout(timer)
  }, [sidebarCollapsed])

  // Prepare graph stats for sidebar
    const filteringApplied =
    graphData?.metadata?.org_min_degree_used != null &&
    graphData?.metadata?.actor_min_degree_used != null &&
    graphData?.metadata?.k_core_used != null &&
    graphData?.metadata?.min_edge_weight_used != null
      ? {
          orgDegree: graphData.metadata.org_min_degree_used,
          actorDegree: graphData.metadata.actor_min_degree_used,
          kCore: graphData.metadata.k_core_used,
          edgeWeight: graphData.metadata.min_edge_weight_used,
        }
      : undefined

  const graphStats = graphData
    ? {
        nodeCount: graphData.nodes?.length || 0,
        edgeCount: graphData.links?.length || 0,
        initialEdgeCount: graphData.metadata?.initial_edge_count,
        filteringApplied,
      }
    : undefined


  return (
    <>
      {/* Header */}
      <header className="header">
        <div className="header-logo">
          <h1>EU<span> Network</span></h1>
        </div>

        <nav className="header-nav">
          <a href="https://maxpieter.github.io/MEP_votes/" target="_blank" rel="noopener noreferrer">
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
              />
            </svg>
            <span>Rebel Scores</span>
          </a>
          <a href="#" className="active">
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M13 10V3L4 14h7v7l9-11h-7z"
              />
            </svg>
            <span>Network Graph</span>
          </a>
        </nav>

        <div className="header-actions">
          <a
            href="https://github.com/maxpieter"
            target="_blank"
            rel="noopener noreferrer"
            className="header-btn"
            title="View on GitHub"
          >
            <svg fill="currentColor" viewBox="0 0 24 24">
              <path
                fillRule="evenodd"
                d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
                clipRule="evenodd"
              />
            </svg>
          </a>
        </div>
      </header>

      {/* App Container */}
      <div className="app-container">
        {/* Sidebar */}
        <Sidebar
          collapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
          chargeStrength={chargeStrength}
          setChargeStrength={setChargeStrength}
          filters={filters}
          setFilters={setFilters}
        />

        {/* Main Content */}
        <main className={`main-content ${sidebarCollapsed ? 'collapsed' : ''}`}>
          <div className="chart-container" style={{ height: 'calc(100vh - 64px - 3rem)' }}>
            <NetworkGraph
              chargeStrength={chargeStrength}
              filters={filters}
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