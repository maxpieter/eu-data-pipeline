// Types for graph data - matching bip.py output structure
export interface Node {
  id: string
  type: 'org' | 'mep' | 'commission_employee'
  label: string
  community?: number  // Community ID (0-5 for top 6, -1 for others)
  // MEP-specific fields
  party?: string;
  country?: string;
  mep_name?: string;
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
  timestamps?: string[]
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
    label?: string
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
}

export const defaultFilters: GraphFilters = {
  mode: 'full',
  filterType: 'timeline',
  graphType: 'bipartite',
  start: '2025-01-01',
  end: '2025-09-01',
  procedure: 'all',
}

// Re-export color/label constants from the shared module
export { typeLabels, typeColors, communityColors, defaultCommunityColor } from '@/lib/constants'

// ── Cluster types (used by ClusterGraph and ClusterHeader) ──

export interface ClusterNode {
  id: string
  cluster_id: number
  type: 'cluster'
  label: string
  size: number
  density: number
  top_members: Array<{ id: string; label: string; degree: number }>
  top_interests: Array<{ interest: string; count: number }>
}

export interface ClusterLink {
  source: string
  target: string
  weight: number
  edge_count: number
}

export interface ClusterOverviewData {
  nodes: ClusterNode[]
  links: ClusterLink[]
  metadata: {
    total_clusters: number
    total_nodes: number
    total_edges: number
  }
}

export interface ClusterDetailNode {
  id: string
  type: 'org'
  label: string
  name: string
  interests_represented?: string
  register_id?: string
  degree: number
}

export interface ClusterDetailLink {
  source: string
  target: string
  weight: number
  shared: number
}

export interface ClusterDetailData {
  cluster_id: number
  cluster_label: string
  nodes: ClusterDetailNode[]
  links: ClusterDetailLink[]
  external_connections: Array<{
    cluster_id: number
    cluster_label: string
    edge_count: number
  }>
  metadata: {
    node_count: number
    edge_count: number
    density: number
  }
}

import { communityColors, defaultCommunityColor } from '@/lib/constants'

export function getClusterColor(clusterId: number): string {
  if (clusterId >= 0 && clusterId < communityColors.length) {
    return communityColors[clusterId]
  }
  return defaultCommunityColor
}

export async function fetchClusterOverview(): Promise<ClusterOverviewData> {
  const { apiFetch } = await import('@/lib/api')
  return apiFetch<ClusterOverviewData>('/api/clusters')
}

export async function fetchClusterDetail(clusterId: number): Promise<ClusterDetailData> {
  const { apiFetch } = await import('@/lib/api')
  return apiFetch<ClusterDetailData>(`/api/clusters/${clusterId}`)
}

/**
 * Fetch graph data from the API with filters.
 * Note: ALL filtering (degrees, k-core, edge weight) is automatically
 * determined by the backend based on the initial edge count.
 * @param filters - Graph filters (mode, start, end)
 */
export async function fetchGraphData(
  filters: Partial<GraphFilters> = {},
): Promise<GraphData> {
  const { fetchGraphData: _fetchGraphData } = await import('@/lib/api')
  return _fetchGraphData(filters)
}

/**
 * Fetch list of available procedures for graph filtering.
 * Uses the graph-procedures endpoint which returns procedures with >100 meetings.
 */
export async function fetchProcedures(): Promise<string[]> {
  const { fetchGraphProcedures } = await import('@/lib/api')
  return fetchGraphProcedures()
}
