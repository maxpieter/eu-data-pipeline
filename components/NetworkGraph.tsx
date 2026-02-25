'use client'

import { useEffect, useRef, useState } from 'react'
import * as d3 from 'd3'
import { typeColors, typeLabels, communityColors, defaultCommunityColor, fetchGraphData, GraphData, GraphFilters, Node, Link } from '@/lib/data'

interface SimNode extends d3.SimulationNodeDatum {
  id: string
  type: string
  label: string
  party?: string
  country?: string
  degree?: number  // Number of connections
  nodeSize?: number  // Calculated size based on degree
  community?: number  // Community ID (0-5 for top 6, -1 for others)
}

interface SimLink extends d3.SimulationLinkDatum<SimNode> {
  weight: number
  timestamps?: string[]
}

interface NetworkGraphProps {
  chargeStrength: number
  filters: GraphFilters
  setFilters: (filters: GraphFilters | ((prev: GraphFilters) => GraphFilters)) => void
  onDataLoad?: (data: GraphData) => void
}

// Fixed values
const LINK_DISTANCE = 80
const NODE_SIZE = 15

// Utility functions for statistics
function computeWeightedDegree(orgId: string, links: Link[]): number {
  return links
    .filter(l => l.source === orgId || l.target === orgId)
    .reduce((sum, l) => sum + l.weight, 0)
}

function computeCloseness(orgId: string, nodes: Node[], links: Link[]): number {
  // Simple BFS for shortest paths (unweighted)
  const orgIds = nodes.filter(n => n.type === 'org').map(n => n.id)
  const visited = new Set<string>()
  const queue: { id: string; dist: number }[] = [{ id: orgId, dist: 0 }]
  let totalDist = 0
  let reachable = 0

  while (queue.length) {
    const { id, dist } = queue.shift()!
    if (visited.has(id)) continue
    visited.add(id)
    if (id !== orgId && orgIds.includes(id)) {
      totalDist += dist
      reachable += 1
    }
    links.forEach(l => {
      if (l.source === id && !visited.has(l.target)) queue.push({ id: l.target, dist: dist + 1 })
      if (l.target === id && !visited.has(l.source)) queue.push({ id: l.source, dist: dist + 1 })
    })
  }
  return reachable > 0 ? reachable / totalDist : 0
}

function computeAuthority(orgId: string, nodes: Node[], links: Link[]): number {
  // Authority: number of incoming edges from MEPs or Commission
  return links.filter(l =>
    l.target === orgId &&
    nodes.find(n => n.id === l.source && (n.type === 'mep' || n.type === 'commission_employee'))
  ).length
}

export default function NetworkGraph({
  chargeStrength,
  filters,
  setFilters,
  onDataLoad,
}: NetworkGraphProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const simulationRef = useRef<d3.Simulation<SimNode, SimLink> | null>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null)

  const [graphData, setGraphData] = useState<GraphData>({ nodes: [], links: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedMetric, setSelectedMetric] = useState<'authority' | 'weightedDegree' | 'closeness'>('authority')
  const [orgStats, setOrgStats] = useState<{
    weightedDegree: { id: string; value: number; label: string }[]
    closeness: { id: string; value: number; label: string }[]
    authority: { id: string; value: number; label: string }[]
  }>({
    weightedDegree: [],
    closeness: [],
    authority: [],
  })

  // Fetch data from API when filters change
  useEffect(() => {
    let cancelled = false

    async function loadData() {
      setLoading(true)
      setError(null)

      try {
        const data = await fetchGraphData(filters)

        if (!cancelled) {
          setGraphData(data)
          // Pass data back to parent component
          if (onDataLoad) {
            onDataLoad(data)
          }
          if (data.nodes.length === 0) {
            setError('No data returned. Make sure the Python server is running.')
          }
        }
      } catch (err) {
        console.error('Failed to fetch data:', err)
        if (!cancelled) {
          setError('Failed to load data. Start the server with: python server.py')
          setGraphData({ nodes: [], links: [] })
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    loadData()

    return () => {
      cancelled = true
    }
  }, [filters])

  // Compute organization statistics
  useEffect(() => {
    if (loading || graphData.nodes.length === 0) return

    const orgNodes = graphData.nodes.filter(n => n.type === 'org')
    const links = graphData.links

    if (orgNodes.length === 0) return

    // Limit to first 100 orgs to avoid computing expensive stats on thousands of nodes
    const orgNodesToAnalyze = orgNodes.slice(0, 100)

    // Compute stats for each org
    const weightedDegreeArr = orgNodesToAnalyze.map(n => ({
      id: n.id,
      value: computeWeightedDegree(n.id, links),
      label: n.label || n.id,
    }))
    const closenessArr = orgNodesToAnalyze.map(n => ({
      id: n.id,
      value: computeCloseness(n.id, graphData.nodes, links),
      label: n.label || n.id,
    }))
    const authorityArr = orgNodesToAnalyze.map(n => ({
      id: n.id,
      value: computeAuthority(n.id, graphData.nodes, links),
      label: n.label || n.id,
    }))

    // Sort and take top 8
    setOrgStats({
      weightedDegree: weightedDegreeArr.sort((a, b) => b.value - a.value).slice(0, 8),
      closeness: closenessArr.sort((a, b) => b.value - a.value).slice(0, 8),
      authority: authorityArr.sort((a, b) => b.value - a.value).slice(0, 8),
    })
  }, [graphData, loading])

  // Initialize/update graph
  useEffect(() => {
    if (!svgRef.current || loading) return

    const svg = d3.select(svgRef.current)
    const container = svgRef.current.parentElement!
    const width = container.clientWidth
    const height = container.clientHeight

    // Clear existing content
    svg.selectAll('*').remove()

    // Prepare data
    const nodes: SimNode[] = graphData.nodes.map(d => ({ ...d }))
    const links: SimLink[] = graphData.links.map(d => ({ ...d }))

    // Calculate degree (number of connections) for each node
    const degreeMap = new Map<string, number>()
    links.forEach(link => {
      const sourceId = typeof link.source === 'string' ? link.source : (link.source as SimNode).id
      const targetId = typeof link.target === 'string' ? link.target : (link.target as SimNode).id
      degreeMap.set(sourceId, (degreeMap.get(sourceId) || 0) + 1)
      degreeMap.set(targetId, (degreeMap.get(targetId) || 0) + 1)
    })

    // Calculate node sizes based on degree
    // Min size: 5, Max size: 20, scale logarithmically
    const degrees = Array.from(degreeMap.values())
    const minDegree = Math.min(...degrees, 1)
    const maxDegree = Math.max(...degrees, 1)
    
    nodes.forEach(node => {
      const degree = degreeMap.get(node.id) || 0
      node.degree = degree
      
      // Logarithmic scaling for better visual distribution
      if (degree === 0) {
        node.nodeSize = 5
      } else {
        const normalized = (Math.log(degree + 1) - Math.log(minDegree + 1)) / 
                          (Math.log(maxDegree + 1) - Math.log(minDegree + 1))
        node.nodeSize = 5 + normalized * 15  // Range: 5-20px
      }
    })

    // Pre-run simulation to calculate positions before rendering
    const preSimulation = d3.forceSimulation<SimNode>(nodes)
      .force('link', d3.forceLink<SimNode, SimLink>(links).id(d => d.id).distance(LINK_DISTANCE))
      .force('charge', d3.forceManyBody<SimNode>().strength(chargeStrength))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide<SimNode>().radius(d => (d.nodeSize || NODE_SIZE) + 4))
      .stop()

    // Run simulation - fewer ticks for large graphs to avoid blocking
    const ticks = nodes.length > 2000 ? 50 : 300
    for (let i = 0; i < ticks; i++) {
      preSimulation.tick()
    }

    // Calculate initial transform to fit all nodes
    const padding = 50
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
    nodes.forEach(n => {
      if (n.x !== undefined && n.y !== undefined) {
        minX = Math.min(minX, n.x)
        maxX = Math.max(maxX, n.x)
        minY = Math.min(minY, n.y)
        maxY = Math.max(maxY, n.y)
      }
    })

    let initialTransform = d3.zoomIdentity
    if (isFinite(minX) && nodes.length > 0) {
      const boundsWidth = maxX - minX
      const boundsHeight = maxY - minY
      const centerX = (minX + maxX) / 2
      const centerY = (minY + maxY) / 2
      const scale = Math.min(
        (width - padding * 2) / (boundsWidth || 1),
        (height - padding * 2) / (boundsHeight || 1),
        1.5
      )
      initialTransform = d3.zoomIdentity
        .translate(width / 2, height / 2)
        .scale(scale)
        .translate(-centerX, -centerY)
    }

    // Main group
    const g = svg.append('g')

    // Add zoom
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 10])
      .on('zoom', (event) => {
        g.attr('transform', event.transform)
      })

    svg.call(zoom)
    zoomRef.current = zoom

    // Apply initial fitted transform immediately (no animation)
    svg.call(zoom.transform, initialTransform)

    // Links (positions already computed)
    const linkGroup = g.append('g').attr('class', 'links')
    const link = linkGroup
      .selectAll<SVGLineElement, SimLink>('line')
      .data(links)
      .join('line')
      .attr('stroke', '#cbd5e1')
      .attr('stroke-opacity', 0.6)
      .attr('stroke-width', d => Math.sqrt(d.weight) * 1.5)
      .attr('x1', d => (d.source as SimNode).x!)
      .attr('y1', d => (d.source as SimNode).y!)
      .attr('x2', d => (d.target as SimNode).x!)
      .attr('y2', d => (d.target as SimNode).y!)

    // Nodes (positions already computed)
    const nodeGroup = g.append('g').attr('class', 'nodes')
    const node = nodeGroup
      .selectAll<SVGCircleElement, SimNode>('circle')
      .data(nodes)
      .join('circle')
      .attr('r', d => d.nodeSize || NODE_SIZE)
      .attr('fill', d => {
        // Use community colors if community is assigned (cycle through colors using modulo)
        if (d.community !== undefined && d.community >= 0) {
          return communityColors[d.community % communityColors.length]
        }
        // Fallback to default community color for others
        return defaultCommunityColor
      })
      .attr('stroke', '#fff')
      .attr('stroke-width', 2)
      .attr('cx', d => d.x!)
      .attr('cy', d => d.y!)
      .style('cursor', 'grab')
      .style('filter', 'drop-shadow(0 1px 2px rgba(0,0,0,0.1))')

    // Labels (hidden by default, positions already computed)
    const labelGroup = g.append('g').attr('class', 'labels')
    const labels = labelGroup
      .selectAll<SVGTextElement, SimNode>('text')
      .data(nodes)
      .join('text')
      .attr('font-size', '11px')
      .attr('font-weight', '600')
      .attr('fill', '#374151')
      .attr('text-anchor', 'middle')
      .attr('dy', d => -(d.nodeSize || NODE_SIZE) - 6)
      .attr('x', d => d.x!)
      .attr('y', d => d.y!)
      .attr('opacity', 0)
      .attr('pointer-events', 'none')
      .text(d => d.label || d.id)

    // Simulation (positions already pre-computed, start with low alpha)
    const simulation = d3.forceSimulation<SimNode>(nodes)
      .force('link', d3.forceLink<SimNode, SimLink>(links)
        .id(d => d.id)
        .distance(LINK_DISTANCE))
      .force('charge', d3.forceManyBody<SimNode>().strength(chargeStrength))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide<SimNode>().radius(d => (d.nodeSize || NODE_SIZE) + 4))
      .alpha(0.1)  // Start cool since positions are pre-computed
      .alphaDecay(0.02)

    simulationRef.current = simulation

    // Tick - just update positions (no fit needed, already pre-computed)
    simulation.on('tick', () => {
      link
        .attr('x1', d => (d.source as SimNode).x!)
        .attr('y1', d => (d.source as SimNode).y!)
        .attr('x2', d => (d.target as SimNode).x!)
        .attr('y2', d => (d.target as SimNode).y!)

      node
        .attr('cx', d => d.x!)
        .attr('cy', d => d.y!)

      labels
        .attr('x', d => d.x!)
        .attr('y', d => d.y!)
    })

    // Drag behavior
    const drag = d3.drag<SVGCircleElement, SimNode>()
      .on('start', (event, d) => {
        if (!event.active) simulation.alphaTarget(0.3).restart()
        d.fx = d.x
        d.fy = d.y
      })
      .on('drag', (event, d) => {
        d.fx = event.x
        d.fy = event.y
      })
      .on('end', (event, d) => {
        if (!event.active) simulation.alphaTarget(0)
        d.fx = null
        d.fy = null
      })

    node.call(drag)

    // Hover effects
    node.on('mouseover', function(event, d) {
      const connectedNodeIds = new Set<string>()
      links.forEach(l => {
        const sourceId = typeof l.source === 'object' ? (l.source as SimNode).id : String(l.source)
        const targetId = typeof l.target === 'object' ? (l.target as SimNode).id : String(l.target)
        if (sourceId === d.id) connectedNodeIds.add(targetId)
        if (targetId === d.id) connectedNodeIds.add(sourceId)
      })

      node
        .attr('opacity', n => n.id === d.id || connectedNodeIds.has(n.id) ? 1 : 0.15)
        .attr('r', n => {
          const baseSize = n.nodeSize || NODE_SIZE
          return n.id === d.id ? baseSize * 1.3 : baseSize
        })

      link
        .attr('opacity', l => {
          const sourceId = typeof l.source === 'object' ? (l.source as SimNode).id : String(l.source)
          const targetId = typeof l.target === 'object' ? (l.target as SimNode).id : String(l.target)
          return sourceId === d.id || targetId === d.id ? 1 : 0.05
        })
        .attr('stroke', l => {
          const sourceId = typeof l.source === 'object' ? (l.source as SimNode).id : String(l.source)
          const targetId = typeof l.target === 'object' ? (l.target as SimNode).id : String(l.target)
          return sourceId === d.id || targetId === d.id ? (typeColors[d.type] || '#999') : '#cbd5e1'
        })
        .attr('stroke-width', l => {
          const sourceId = typeof l.source === 'object' ? (l.source as SimNode).id : String(l.source)
          const targetId = typeof l.target === 'object' ? (l.target as SimNode).id : String(l.target)
          return sourceId === d.id || targetId === d.id ? Math.sqrt(l.weight) * 2.5 : Math.sqrt(l.weight) * 1.5
        })

      labels.attr('opacity', n => n.id === d.id || connectedNodeIds.has(n.id) ? 1 : 0)

      // Show tooltip
      if (tooltipRef.current) {
        const communityInfo = d.community !== undefined && d.community >= 0
          ? `<div style="color: ${communityColors[d.community % communityColors.length]}; font-size: 0.6875rem; margin-top: 0.125rem; font-weight: 600;">Community ${d.community}</div>`
          : d.community === -1
          ? `<div style="color: #9CA3AF; font-size: 0.6875rem; margin-top: 0.125rem;">Minor community</div>`
          : ''
        
        tooltipRef.current.innerHTML = `
          <div style="font-weight: 700; color: #1e293b;">${d.label || d.id}</div>
          <div style="color: #64748b; font-size: 0.75rem; margin-top: 0.25rem;">${typeLabels[d.type] || 'Unknown'}</div>
          <div style="color: #64748b; font-size: 0.75rem;">${connectedNodeIds.size} connections</div>
          <div style="color: #2563eb; font-size: 0.6875rem; margin-top: 0.125rem; font-weight: 600;">Degree: ${d.degree || 0}</div>
          ${communityInfo}
        `
        tooltipRef.current.style.opacity = '1'
        tooltipRef.current.style.left = `${event.pageX + 12}px`
        tooltipRef.current.style.top = `${event.pageY + 12}px`
      }
    })

    node.on('mouseout', function() {
      node
        .attr('opacity', 1)
        .attr('r', d => d.nodeSize || NODE_SIZE)
      link
        .attr('opacity', 0.6)
        .attr('stroke', '#cbd5e1')
        .attr('stroke-width', d => Math.sqrt(d.weight) * 1.5)
      labels.attr('opacity', 0)

      if (tooltipRef.current) {
        tooltipRef.current.style.opacity = '0'
      }
    })

    // Handle resize
    const handleResize = () => {
      const newWidth = container.clientWidth
      const newHeight = container.clientHeight
      simulation.force('center', d3.forceCenter(newWidth / 2, newHeight / 2))
      simulation.alpha(0.3).restart()
    }

    window.addEventListener('resize', handleResize)

    return () => {
      simulation.stop()
      window.removeEventListener('resize', handleResize)
    }
  }, [graphData, loading])

  // Update charge strength
  useEffect(() => {
    if (!simulationRef.current) return

    const simulation = simulationRef.current
    const chargeForce = simulation.force('charge') as d3.ForceManyBody<SimNode>

    if (chargeForce) chargeForce.strength(chargeStrength)

    simulation.alpha(0.3).restart()
  }, [chargeStrength])

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      {loading && (
        <div style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          color: '#64748b',
          fontSize: '0.875rem',
        }}>
          Loading...
        </div>
      )}

      {error && (
        <div style={{
          position: 'absolute',
          top: '1rem',
          left: '50%',
          transform: 'translateX(-50%)',
          background: '#fef2f2',
          color: '#dc2626',
          padding: '0.5rem 1rem',
          borderRadius: '8px',
          fontSize: '0.875rem',
        }}>
          {error} - showing fallback data
        </div>
      )}

      {/* Graph Type Selector */}
      <div
        style={{
          position: 'absolute',
          top: '1rem',
          left: '50%',
          transform: 'translateX(-50%)',
          background: 'rgba(255, 255, 255, 0.95)',
          backdropFilter: 'blur(8px)',
          borderRadius: '8px',
          padding: '0.5rem',
          border: '1px solid #e2e8f0',
          boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
          display: 'flex',
          gap: '0.5rem',
          zIndex: 100,
        }}
      >
        {(['bipartite', 'politicians', 'organizations'] as const).map((type) => (
          <button
            key={type}
            onClick={() => {
              setFilters((prev) => ({
                ...prev,
                graphType: type,
              }))
            }}
            style={{
              padding: '0.5rem 1rem',
              border: filters.graphType === type ? '2px solid #3b82f6' : '1px solid #cbd5e1',
              background: filters.graphType === type ? '#dbeafe' : 'white',
              borderRadius: '6px',
              fontSize: '0.875rem',
              fontWeight: filters.graphType === type ? 600 : 400,
              color: filters.graphType === type ? '#1e40af' : '#475569',
              cursor: 'pointer',
              transition: 'all 0.2s',
            }}
          >
            {type === 'bipartite' ? 'ALL' : type === 'politicians' ? 'POLITICIANS' : 'ORGANISATIONS'}
          </button>
        ))}
      </div>

      <svg
        ref={svgRef}
        style={{
          width: '100%',
          height: '100%',
          background: 'rgb(250, 250, 255)',
          opacity: loading ? 0.5 : 1,
          transition: 'opacity 0.2s',
        }}
      />

      {/* Legend overlay - Top 6 Communities and Organization Statistics */}
      {graphData.metadata?.communities && (
        <div
          style={{
            position: 'absolute',
            bottom: '1rem',
            right: '1rem',
            background: 'rgba(255, 255, 255, 0.95)',
            backdropFilter: 'blur(8px)',
            borderRadius: '12px',
            padding: '1rem',
            border: '1px solid #e2e8f0',
            boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
            maxWidth: '320px',
            maxHeight: '70vh',
            overflowY: 'auto',
          }}
        >
          {/* Communities Section */}
          <div style={{ marginBottom: '1rem' }}>
            <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#1e293b', marginBottom: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Top 6 Communities
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {graphData.metadata.communities.map((community) => (
                <div key={community.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <div
                    style={{
                      width: '10px',
                      height: '10px',
                      borderRadius: '50%',
                      backgroundColor: communityColors[community.id % communityColors.length],
                      flexShrink: 0,
                    }}
                  />
                  <span style={{ fontSize: '0.8125rem', color: '#475569' }}>
                    Community {community.id} ({community.size} nodes, {community.percentage}%)
                  </span>
                </div>
              ))}
              {/* Other communities */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.25rem', paddingTop: '0.5rem', borderTop: '1px solid #e2e8f0' }}>
                <div
                  style={{
                    width: '10px',
                    height: '10px',
                    borderRadius: '50%',
                    backgroundColor: defaultCommunityColor,
                    flexShrink: 0,
                  }}
                />
                <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
                  Other communities
                </span>
              </div>
            </div>
          </div>

          {/* Organization Statistics Section */}
          {orgStats.weightedDegree.length > 0 && (
            <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: '1rem' }}>
              <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#1e293b', marginBottom: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Top 8 Organizations
              </div>

              {/* Metric Dropdown */}
              <div style={{ marginBottom: '0.75rem' }}>
                <select
                  value={selectedMetric}
                  onChange={(e) => setSelectedMetric(e.target.value as 'authority' | 'weightedDegree' | 'closeness')}
                  style={{
                    width: '100%',
                    padding: '0.375rem 0.5rem',
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    color: '#334155',
                    border: '1px solid #cbd5e1',
                    borderRadius: '6px',
                    backgroundColor: '#fff',
                    cursor: 'pointer',
                  }}
                >
                  <option value="authority">Authority</option>
                  <option value="weightedDegree">Weighted Degree</option>
                  <option value="closeness">Closeness</option>
                </select>
              </div>

              {/* Display selected metric */}
              {selectedMetric === 'authority' && (
                <div>
                  <ul style={{ margin: 0, paddingLeft: '1rem', listStyle: 'none' }}>
                    {orgStats.authority.map((stat, idx) => (
                      <li key={stat.id} style={{ fontSize: '0.75rem', color: '#475569', lineHeight: '1.4' }}>
                        {idx + 1}. {stat.label}: <strong>{stat.value}</strong>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {selectedMetric === 'weightedDegree' && (
                <div>
                  <ul style={{ margin: 0, paddingLeft: '1rem', listStyle: 'none' }}>
                    {orgStats.weightedDegree.map((stat, idx) => (
                      <li key={stat.id} style={{ fontSize: '0.75rem', color: '#475569', lineHeight: '1.4' }}>
                        {idx + 1}. {stat.label}: <strong>{stat.value.toFixed(2)}</strong>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {selectedMetric === 'closeness' && (
                <div>
                  <ul style={{ margin: 0, paddingLeft: '1rem', listStyle: 'none' }}>
                    {orgStats.closeness.map((stat, idx) => (
                      <li key={stat.id} style={{ fontSize: '0.75rem', color: '#475569', lineHeight: '1.4' }}>
                        {idx + 1}. {stat.label}: <strong>{stat.value.toFixed(4)}</strong>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Tooltip */}
      <div
        ref={tooltipRef}
        style={{
          position: 'fixed',
          zIndex: 1000,
          padding: '0.5rem 0.75rem',
          background: 'white',
          borderRadius: '8px',
          boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
          border: '1px solid #e2e8f0',
          fontSize: '0.875rem',
          pointerEvents: 'none',
          opacity: 0,
          transition: 'opacity 0.15s ease',
        }}
      />
    </div>
  )
}