// Types for graph data - matching bip.py output structure
export interface Node {
  id: string;
  type: "org" | "mep" | "commission_employee";
  label: string;
  // MEP-specific fields
  party?: string;
  country?: string;
  mep_name?: string;
  // Org-specific fields
  name?: string;
  interests_represented?: string;
  register_id?: string;
}

export interface Link {
  source: string;
  target: string;
  weight: number;
  timestamps?: string[];
}

export interface GraphData {
  nodes: Node[];
  links: Link[];
}

// Node type labels for the legend
export const typeLabels: Record<string, string> = {
  org: "Organizations",
  mep: "MEPs",
  commission_employee: "Commission",
};

// Node type colors
export const typeColors: Record<string, string> = {
  org: "#7C3AED", // Violet for organizations
  mep: "#1E40AF", // Blue for MEPs
  commission_employee: "#DC2626", // Red for Commission
};

// Available graph modes matching bip.py
export type GraphMode = "mep" | "commission" | "full";

// Filter options matching bip.py --flags
export interface GraphFilters {
  mode: GraphMode;
  orgMinDegree: number; // --org-min-degree
  actorMinDegree: number; // --actor-min-degree
  bipartiteKCore: number; // --bipartite-k-core
  minEdgeWeight: number; // --min-edge-weight
  keepIsolates: boolean; // --keep-isolates
}

export const defaultFilters: GraphFilters = {
  mode: "full",
  orgMinDegree: 2,
  actorMinDegree: 1,
  bipartiteKCore: 0,
  minEdgeWeight: 1,
  keepIsolates: false,
};

/**
 * Fetch graph data from the API with filters
 * @param filters - Graph filters matching bip.py arguments
 */
export async function fetchGraphData(
  filters: Partial<GraphFilters> = {},
): Promise<GraphData> {
  const f = { ...defaultFilters, ...filters };

  const params = new URLSearchParams();
  params.set("mode", f.mode);
  params.set("org_min_degree", String(f.orgMinDegree));
  params.set("actor_min_degree", String(f.actorMinDegree));
  params.set("bipartite_k_core", String(f.bipartiteKCore));
  params.set("min_edge_weight", String(f.minEdgeWeight));
  params.set("keep_isolates", String(f.keepIsolates));

  // Next.js rewrites will proxy to Python backend in development
  const url = `/api/graph?${params}`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    console.error("Failed to fetch graph data:", error);
    return { nodes: [], links: [] };
  }
}
