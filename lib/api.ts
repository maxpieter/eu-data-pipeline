/**
 * Centralized API service layer for all Python backend requests.
 *
 * All fetch calls are routed through `apiFetch`, which handles:
 * - Building the request URL with query parameters
 * - Setting `cache: "no-store"` to always retrieve fresh data
 * - Uniform error handling and JSON parsing
 * - The direct `localhost:5001` bypass for development, which avoids
 *   Next.js rewrite timeout issues for long-running graph requests
 */

import type { GraphData, GraphFilters } from '@/lib/data'

// Re-export core graph types so callers can import from one place
export type { GraphData, GraphFilters }

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

/** A single MEP entry as returned by `/api/meps`. */
export interface MepInfo {
  id: number
  name: string
  country: string
  political_group: string
  meeting_count: number
}

/** A single committee entry as returned by `/api/committees`. */
export interface CommitteeInfo {
  acronym: string
  count: number
}

/** A single procedure entry as returned by `/api/procedures`. */
export interface ProcedureInfo {
  procedure: string
  count: number
}

/** A single organization entry as returned by `/api/organizations`. */
export interface OrganizationInfo {
  name: string
  count: number
}

/** A single OEIL legislative event. */
export interface OeilEvent {
  date: string
  event?: string
  doc_type?: string
  reference: string
  committee?: string
  source?: string
  link?: string | null
  category: 'key_event' | 'documentation'
}

/** Full procedure event data as returned by `/api/procedure-events`. */
export interface ProcedureEventsData {
  procedure: string
  title: string
  key_events: OeilEvent[]
  documentation_gateway: OeilEvent[]
}

/** A single entry within a timeline response. */
export interface MeetingDetail {
  date: string
  title: string
  attendee_count: number
  procedure: string | null
}

/** A single bucket (week or month) within a timeline response. */
export interface TimelineEntry {
  week?: string
  month?: string
  count: number
  meetings?: MeetingDetail[]
}

/** Full timeline response as returned by `/api/timeline`. */
export interface TimelineData {
  timeline: TimelineEntry[]
  total_meetings: number
  meps_involved?: number
  mep?: {
    id: number
    name: string
    country: string
    political_group: string
  }
  procedure?: string
  committee?: string
}

/** Query parameters accepted by `/api/timeline`. */
export interface TimelineParams {
  mep?: number
  committee?: string
  procedure?: string
  organization?: string
  ep_period?: string
}

// ---------------------------------------------------------------------------
// Core fetch helper
// ---------------------------------------------------------------------------

const BACKEND_PORT = 5001

/**
 * Resolves the base URL for an API path.
 *
 * In the browser on localhost, requests are sent directly to the Python
 * backend (port 5001) to avoid Next.js rewrite timeouts on long-running
 * graph computations. In all other environments the standard relative `/api`
 * path is used, which the Next.js rewrite layer (or a production proxy) will
 * forward appropriately.
 */
function resolveUrl(path: string, params?: Record<string, string>): string {
  const allParams = { ...params, _t: String(Date.now()) }
  const searchString = `?${new URLSearchParams(allParams).toString()}`

  const base =
    typeof window !== 'undefined' && window.location.hostname === 'localhost'
      ? `http://localhost:${BACKEND_PORT}`
      : ''

  return `${base}${path}${searchString}`
}

/**
 * Core fetch helper shared by all endpoint wrappers.
 *
 * @param path - Absolute path starting with `/api/...`
 * @param params - Optional query-string parameters
 * @param signal - Optional AbortSignal for request cancellation / timeouts
 * @returns Parsed JSON body typed as `T`
 * @throws `Error` with a descriptive message on non-2xx responses or network failures
 */
export async function apiFetch<T>(
  path: string,
  params?: Record<string, string>,
  signal?: AbortSignal,
): Promise<T> {
  const url = resolveUrl(path, params)

  const response = await fetch(url, {
    cache: 'no-store',
    ...(signal ? { signal } : {}),
  })

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(
      `API error ${response.status} for ${path}${body ? `: ${body}` : ''}`,
    )
  }

  return response.json() as Promise<T>
}

// ---------------------------------------------------------------------------
// Typed endpoint wrappers
// ---------------------------------------------------------------------------

/**
 * Fetches the list of all MEPs with their meeting counts.
 *
 * Endpoint: `GET /api/meps`
 */
export async function fetchMeps(): Promise<MepInfo[]> {
  const data = await apiFetch<{ meps: MepInfo[] }>('/api/meps')
  return data.meps ?? []
}

/**
 * Fetches the list of all committees with their meeting counts.
 *
 * Endpoint: `GET /api/committees`
 */
export async function fetchCommittees(): Promise<CommitteeInfo[]> {
  const data = await apiFetch<{ committees: CommitteeInfo[] }>('/api/committees')
  return data.committees ?? []
}

/**
 * Fetches the full list of all procedures with meeting counts.
 *
 * This endpoint returns rich objects (with `procedure` and `count` fields),
 * suitable for display in the MepMeetingsTimeline procedure picker.
 *
 * Endpoint: `GET /api/procedures`
 */
export async function fetchMeetingProcedures(): Promise<ProcedureInfo[]> {
  const data = await apiFetch<{ procedures: ProcedureInfo[] }>('/api/procedures')
  return data.procedures ?? []
}

/**
 * Fetches the list of all organizations with their meeting counts.
 *
 * Endpoint: `GET /api/organizations`
 */
export async function fetchOrganizations(): Promise<OrganizationInfo[]> {
  const data = await apiFetch<{ organizations: OrganizationInfo[] }>('/api/organizations')
  return data.organizations ?? []
}

/**
 * Fetches procedures linked to a specific MEP with meeting counts.
 *
 * Returns the same rich object shape as `fetchMeetingProcedures`, so the
 * result can be used directly in the MepMeetingsTimeline procedure picker.
 *
 * Endpoint: `GET /api/meps/:mepId/procedures`
 * @param mepId - Numeric MEP identifier
 */
export async function fetchMepProcedures(mepId: number): Promise<ProcedureInfo[]> {
  const data = await apiFetch<{ procedures: ProcedureInfo[] }>(
    `/api/meps/${mepId}/procedures`,
  )
  return data.procedures ?? []
}

/**
 * Fetches a meeting-count timeline filtered by one or more dimensions.
 *
 * Endpoint: `GET /api/timeline`
 * @param params - Timeline filter dimensions (mep, committee, procedure, organization, ep_period)
 */
export async function fetchTimeline(params: TimelineParams): Promise<TimelineData> {
  const query: Record<string, string> = {}

  if (params.mep !== undefined) query.mep = String(params.mep)
  if (params.committee) query.committee = params.committee
  if (params.procedure) query.procedure = params.procedure
  if (params.organization) query.organization = params.organization
  if (params.ep_period) query.ep_period = params.ep_period

  return apiFetch<TimelineData>('/api/timeline', query)
}

/**
 * Fetches OEIL legislative events for a given procedure code.
 *
 * Endpoint: `GET /api/procedure-events`
 * @param procedure - Procedure reference code (e.g. `"2025/0045(COD)"`)
 */
export async function fetchProcedureEvents(
  procedure: string,
): Promise<ProcedureEventsData> {
  return apiFetch<ProcedureEventsData>('/api/procedure-events', { procedure })
}

/**
 * Fetches graph node/link data for the given filter set.
 *
 * This endpoint can be slow for large date ranges; a 300-second timeout is
 * applied via an `AbortController`. All backend-side filtering parameters
 * (degrees, k-core, edge weight) are determined automatically by the backend.
 *
 * Endpoint: `GET /api/graph`
 * @param filters - Graph filters merged on top of `defaultFilters`
 */
export async function fetchGraphData(
  filters: Partial<GraphFilters> = {},
): Promise<GraphData> {
  // Import at call-time to avoid circular dependency issues between api.ts and data.ts
  const { defaultFilters: defaults } = await import('@/lib/data')
  const f: GraphFilters = { ...defaults, ...filters }

  const params: Record<string, string> = {
    mode: f.mode,
    graphType: f.graphType,
    start: f.start,
    end: f.end,
    procedure: f.procedure,
  }

  // Apply a 300-second timeout for large graph requests
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 300_000)

  try {
    const data = await apiFetch<GraphData>('/api/graph', params, controller.signal)

    if (data.metadata) {
      console.log('Graph filtering applied:', {
        'Initial edges': data.metadata.initial_edge_count?.toLocaleString(),
        'Final edges': data.metadata.final_edge_count?.toLocaleString(),
        'Final nodes': data.metadata.final_node_count?.toLocaleString(),
        'Org min degree': data.metadata.org_min_degree_used,
        'Actor min degree': data.metadata.actor_min_degree_used,
        'K-core': data.metadata.k_core_used,
        'Min edge weight': data.metadata.min_edge_weight_used,
        Timeline: data.metadata.timeline,
      })
    }

    console.log(`API Response status: 200`)
    return data
  } catch (error) {
    console.error('Failed to fetch graph data:', error)
    return { nodes: [], links: [] }
  } finally {
    clearTimeout(timeoutId)
  }
}

/**
 * Fetches the list of procedures available as graph filters.
 * Only returns procedures that have more than 100 associated meetings.
 *
 * Endpoint: `GET /api/graph-procedures`
 */
export async function fetchGraphProcedures(): Promise<string[]> {
  try {
    const data = await apiFetch<{ procedures: string[] }>('/api/graph-procedures')
    return data.procedures ?? []
  } catch (error) {
    console.error('Failed to fetch graph procedures:', error)
    return []
  }
}

/**
 * Sends a cache-clear request to the Python backend.
 *
 * Endpoint: `POST /api/cache/clear`
 */
export async function clearCache(): Promise<void> {
  const url = resolveUrl('/api/cache/clear')
  const response = await fetch(url, { method: 'POST', cache: 'no-store' })
  if (!response.ok) {
    throw new Error(`Cache clear failed with status ${response.status}`)
  }
}
