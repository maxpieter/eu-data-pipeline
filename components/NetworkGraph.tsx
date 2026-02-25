'use client'

import { useEffect, useRef, useState } from 'react'
import * as d3 from 'd3'
import { typeColors, typeLabels, communityColors, defaultCommunityColor, fetchGraphData, GraphData, GraphFilters, Node, Link } from '@/lib/data'
import { computeWeightedDegree, computeCloseness, computeAuthority } from '@/lib/graph-metrics'

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
    <div className="relative w-full h-full">
      {loading && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-slate-500 text-sm">
          Loading...
        </div>
      )}

      {error && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-red-50 text-red-600 px-4 py-2 rounded-lg text-sm">
          {error} - showing fallback data
        </div>
      )}

      {/* Graph Type Selector */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-white/95 backdrop-blur-sm rounded-lg p-2 border border-slate-200 shadow-md flex gap-2 z-[100]">
        {(['bipartite', 'politicians', 'organizations'] as const).map((type) => (
          <button
            key={type}
            onClick={() => {
              setFilters((prev) => ({
                ...prev,
                graphType: type,
              }))
            }}
            className="px-4 py-2 rounded-[6px] text-sm transition-all duration-200 cursor-pointer"
            style={{
              border: filters.graphType === type ? '2px solid #3b82f6' : '1px solid #cbd5e1',
              background: filters.graphType === type ? '#dbeafe' : 'white',
              fontWeight: filters.graphType === type ? 600 : 400,
              color: filters.graphType === type ? '#1e40af' : '#475569',
            }}
          >
            {type === 'bipartite' ? 'ALL' : type === 'politicians' ? 'POLITICIANS' : 'ORGANISATIONS'}
          </button>
        ))}
      </div>

      <svg
        ref={svgRef}
        className="w-full h-full bg-[rgb(250,250,255)] transition-opacity duration-200"
        style={{ opacity: loading ? 0.5 : 1 }}
      />

      {/* Legend overlay - Top 6 Communities and Organization Statistics */}
      {graphData.metadata?.communities && (
        <div className="absolute bottom-4 right-4 bg-white/95 backdrop-blur-sm rounded-[12px] p-4 border border-slate-200 shadow-md max-w-[320px] max-h-[70vh] overflow-y-auto">
          {/* Communities Section */}
          <div className="mb-4">
            <div className="text-xs font-bold text-slate-900 mb-3 uppercase tracking-[0.05em]">
              Top 6 Communities
            </div>
            <div className="flex flex-col gap-2">
              {graphData.metadata.communities.map((community) => (
                <div key={community.id} className="flex items-center gap-2">
                  <div
                    className="w-[10px] h-[10px] rounded-full shrink-0"
                    style={{ backgroundColor: communityColors[community.id % communityColors.length] }}
                  />
                  <span className="text-[0.8125rem] text-slate-600">
                    Community {community.id} ({community.size} nodes, {community.percentage}%)
                  </span>
                </div>
              ))}
              {/* Other communities */}
              <div className="flex items-center gap-2 mt-1 pt-2 border-t border-slate-200">
                <div
                  className="w-[10px] h-[10px] rounded-full shrink-0"
                  style={{ backgroundColor: defaultCommunityColor }}
                />
                <span className="text-xs text-slate-500">
                  Other communities
                </span>
              </div>
            </div>
          </div>

          {/* Organization Statistics Section */}
          {orgStats.weightedDegree.length > 0 && (
            <div className="border-t border-slate-200 pt-4">
              <div className="text-xs font-bold text-slate-900 mb-3 uppercase tracking-[0.05em]">
                Top 8 Organizations
              </div>

              {/* Metric Dropdown */}
              <div className="mb-3">
                <select
                  value={selectedMetric}
                  onChange={(e) => setSelectedMetric(e.target.value as 'authority' | 'weightedDegree' | 'closeness')}
                  className="w-full py-[0.375rem] px-2 text-xs font-semibold text-slate-700 border border-slate-300 rounded-[6px] bg-white cursor-pointer"
                >
                  <option value="authority">Authority</option>
                  <option value="weightedDegree">Weighted Degree</option>
                  <option value="closeness">Closeness</option>
                </select>
              </div>

              {/* Display selected metric */}
              {selectedMetric === 'authority' && (
                <div>
                  <ul className="m-0 pl-4 list-none">
                    {orgStats.authority.map((stat, idx) => (
                      <li key={stat.id} className="text-xs text-slate-600 leading-[1.4]">
                        {idx + 1}. {stat.label}: <strong>{stat.value}</strong>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {selectedMetric === 'weightedDegree' && (
                <div>
                  <ul className="m-0 pl-4 list-none">
                    {orgStats.weightedDegree.map((stat, idx) => (
                      <li key={stat.id} className="text-xs text-slate-600 leading-[1.4]">
                        {idx + 1}. {stat.label}: <strong>{stat.value.toFixed(2)}</strong>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {selectedMetric === 'closeness' && (
                <div>
                  <ul className="m-0 pl-4 list-none">
                    {orgStats.closeness.map((stat, idx) => (
                      <li key={stat.id} className="text-xs text-slate-600 leading-[1.4]">
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

      {/* Tooltip — positioned and shown/hidden by D3 via tooltipRef.current.style.* */}
      <div
        ref={tooltipRef}
        className="fixed z-[1000] px-3 py-2 bg-white rounded-lg shadow-md border border-slate-200 text-sm pointer-events-none opacity-0 transition-opacity duration-[150ms] ease-in-out"
      />
    </div>
  )
}