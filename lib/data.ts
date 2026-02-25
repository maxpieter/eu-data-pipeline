// Types for graph data - matching bip.py output structure
export interface Node {
  id: string
  type: 'org' | 'mep' | 'commission_employee'
  label: string
  community?: number  // Community ID (0-5 for top 6, -1 for others)
  // MEP-specific fields
  party?: string
  country?: string
  mep_name?: string
  // Org-specific fields
  name?: string
  interests_represented?: string
  register_id?: string
  // Commission fields
  host?: string
    // Centrality scores
  centrality?: {
    degree: number
    betweenness: number
    closeness: number
    hub?: number        // Only for actors (MEPs/Commission)
    authority?: number  // Only for orgs
  }
}

export interface Link {
  source: string
  target: string
  weight: number
}

export interface GraphMetadata {
  initial_edge_count?: number
  final_edge_count?: number
  final_node_count?: number
  org_min_degree_used?: number
  actor_min_degree_used?: number
  k_core_used?: number
  min_edge_weight_used?: number
  communities?: Array<{
    id: number
    size: number
    percentage: number
  }>
  community_method?: string
  timeline?: {
    start?: string | null
    end?: string | null
  }
}

export interface GraphData {
  nodes: Node[]
  links: Link[]
  metadata?: GraphMetadata
}

// Graph mode types
export type GraphMode = 'mep' | 'commission' | 'full'
export type FilterType = 'timeline' | 'procedure'
export type GraphType = 'bipartite' | 'politicians' | 'organizations'

// Filter settings
export interface GraphFilters {
  mode: GraphMode
  filterType: FilterType  // Choose between timeline or procedure filtering
  graphType: GraphType    // Choose between bipartite or one-mode projections
  start: string           // YYYY-MM-DD (inclusive)
  end: string             // YYYY-MM-DD (inclusive)
  procedure: string       // Related procedure code (e.g., '2025/0045(COD)') or 'all'
  // Removed ALL filtering parameters:
  // - orgMinDegree (automatic)
  // - actorMinDegree (automatic)
  // - bipartiteKCore (automatic)
  // - minEdgeWeight (automatic)
}

export const defaultFilters: GraphFilters = {
  mode: 'full',
  filterType: 'timeline',
  graphType: 'bipartite',
  start: '2025-01-01',
  end: '2025-09-01',
  procedure: 'all',
}

// Node type colors
export const typeColors: Record<string, string> = {
  org: '#64b5f6',                  // Light blue
  mep: '#ffb74d',                  // Orange
  commission_employee: '#81c784',  // Green
}

export const typeLabels: Record<string, string> = {
  org: 'Organization',
  mep: 'MEP',
  commission_employee: 'Commission',
}

// Community colors (top 6)
export const communityColors: string[] = [
  '#e57373', // Red
  '#64b5f6', // Blue
  '#81c784', // Green
  '#ffb74d', // Orange
  '#ba68c8', // Purple
  '#4db6ac', // Teal
]
export const defaultCommunityColor = '#9e9e9e' // Gray for other communities

/**
 * Fetch graph data from the API with filters
 * Note: ALL filtering (degrees, k-core, edge weight) is automatically
 * determined by the backend based on the initial edge count
 * @param filters - Graph filters (mode, start, end)
 */
export async function fetchGraphData(filters: Partial<GraphFilters> = {}): Promise<GraphData> {
  const f = { ...defaultFilters, ...filters }

  const params = new URLSearchParams()
  params.set('mode', f.mode)
  params.set('graphType', f.graphType)
  params.set('start', f.start)
  params.set('end', f.end)
  params.set('procedure', f.procedure)
  // All filtering parameters are handled automatically by backend

  // Next.js rewrites will proxy to Python backend in development
  // In development, fetch directly from Python backend to avoid Next.js timeout issues
  const apiUrl = typeof window !== 'undefined' && window.location.hostname === 'localhost' 
    ? `http://localhost:5001/api/graph?${params}`
    : `/api/graph?${params}`

  try {
    // Set 300-second timeout for large graph requests (5 minutes)
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 300000)
    
    const response = await fetch(apiUrl, {
      signal: controller.signal,
    })
    clearTimeout(timeoutId)
    
    console.log(`API Response status: ${response.status}`)
    
    if (!response.ok) {
      const errorText = await response.text()
      console.error(`HTTP error! status: ${response.status}, body:`, errorText)
      throw new Error(`HTTP error! status: ${response.status}`)
    }
    const data = await response.json()

    // Log the automatic filtering info if available
    if (data.metadata) {
      console.log('🔍 Graph filtering applied:', {
        'Initial edges': data.metadata.initial_edge_count?.toLocaleString(),
        'Final edges': data.metadata.final_edge_count?.toLocaleString(),
        'Final nodes': data.metadata.final_node_count?.toLocaleString(),
        'Org min degree': data.metadata.org_min_degree_used,
        'Actor min degree': data.metadata.actor_min_degree_used,
        'K-core': data.metadata.k_core_used,
        'Min edge weight': data.metadata.min_edge_weight_used,
        'Timeline': data.metadata.timeline,
      })
    }

    return data
  } catch (error) {
    console.error('Failed to fetch graph data:', error)
    return { nodes: [], links: [] }
  }
}

/**
 * Fetch list of available procedures
 */
export async function fetchProcedures(): Promise<string[]> {
  try {
    const response = await fetch('/api/procedures')
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }
    const data = await response.json()
    return data.procedures || []
  } catch (error) {
    console.error('Failed to fetch procedures:', error)
    return []
  }
}
