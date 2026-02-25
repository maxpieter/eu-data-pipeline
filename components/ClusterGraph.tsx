"use client";

import { useRef, useState, useEffect } from "react";
import * as d3 from "d3";
import {
  ClusterOverviewData,
  ClusterDetailData,
  fetchClusterOverview,
  fetchClusterDetail,
  getClusterColor,
} from "@/lib/data";
import ClusterHeader from "./ClusterHeader";
import { useForceGraph } from "@/hooks/useForceGraph";

// ── Simulation node / link types ─────────────────────────────────────────────
// These extend d3.SimulationNodeDatum (adds x/y/vx/vy) while keeping the
// domain fields available for accessors.

interface SimClusterNode extends d3.SimulationNodeDatum {
  id: string;
  cluster_id: number;
  type: "cluster";
  label: string;
  size: number;
  density: number;
  top_members: Array<{ id: string; label: string; degree: number }>;
  top_interests: Array<{ interest: string; count: number }>;
}

interface SimClusterLink extends d3.SimulationLinkDatum<SimClusterNode> {
  weight: number;
  edge_count: number;
}

interface SimDetailNode extends d3.SimulationNodeDatum {
  id: string;
  type: "org";
  label: string;
  name: string;
  interests_represented?: string;
  register_id?: string;
  degree: number;
}

interface SimDetailLink extends d3.SimulationLinkDatum<SimDetailNode> {
  weight: number;
  shared: number;
}

type ViewLevel = "overview" | "detail";

// ── Layout constants ──────────────────────────────────────────────────────────
const MIN_NODE_SIZE = 10;
const MAX_NODE_SIZE = 50;
const DETAIL_NODE_SIZE = 8;
const LINK_DISTANCE_OVERVIEW = 150;
const LINK_DISTANCE_DETAIL = 80;

// ── Component ─────────────────────────────────────────────────────────────────
export default function ClusterGraph() {
  const svgRef = useRef<SVGSVGElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  const [viewLevel, setViewLevel] = useState<ViewLevel>("overview");
  const [selectedClusterId, setSelectedClusterId] = useState<number | null>(
    null,
  );
  const [overviewData, setOverviewData] = useState<ClusterOverviewData | null>(
    null,
  );
  const [detailData, setDetailData] = useState<ClusterDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ── Data fetching ────────────────────────────────────────────────────────────
  useEffect(() => {
    async function loadOverview() {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchClusterOverview();
        setOverviewData(data);
        if (data.nodes.length === 0) {
          setError("No cluster data found. Run api/04_cluster_graph.py first.");
        }
      } catch (err) {
        console.error("Failed to fetch cluster overview:", err);
        setError(
          "Failed to load clusters. Start the server with: python server.py",
        );
      } finally {
        setLoading(false);
      }
    }
    loadOverview();
  }, []);

  useEffect(() => {
    if (selectedClusterId === null) return;

    async function loadDetail() {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchClusterDetail(selectedClusterId!);
        setDetailData(data);
        setViewLevel("detail");
      } catch (err) {
        console.error(`Failed to fetch cluster ${selectedClusterId}:`, err);
        setError(`Failed to load cluster ${selectedClusterId}`);
      } finally {
        setLoading(false);
      }
    }
    loadDetail();
  }, [selectedClusterId]);

  const handleBack = () => {
    setViewLevel("overview");
    setSelectedClusterId(null);
    setDetailData(null);
  };

  // ── Overview graph (Level 1) ──────────────────────────────────────────────────
  // Build config only when overviewData is available; otherwise pass empty arrays
  // and disable the hook via `enabled`.
  const overviewEnabled =
    !loading && viewLevel === "overview" && overviewData !== null;

  const overviewNodes: SimClusterNode[] = overviewData
    ? (overviewData.nodes as SimClusterNode[])
    : [];
  const overviewLinks: SimClusterLink[] = overviewData
    ? (overviewData.links as SimClusterLink[])
    : [];

  const sizeScale = d3
    .scaleSqrt()
    .domain([0, d3.max(overviewNodes, (d) => d.size) || 1])
    .range([MIN_NODE_SIZE, MAX_NODE_SIZE]);

  useForceGraph<SimClusterNode, SimClusterLink>(
    svgRef,
    tooltipRef,
    overviewNodes,
    overviewLinks,
    {
      // Forces
      linkForce: d3
        .forceLink<SimClusterNode, SimClusterLink>()
        .id((d) => d.id)
        .distance(LINK_DISTANCE_OVERVIEW),
      chargeForce: d3.forceManyBody<SimClusterNode>().strength(-30),
      extraForces: [
        ["x", d3.forceX<SimClusterNode>(0).strength(0.05)],
        ["y", d3.forceY<SimClusterNode>(0).strength(0.05)],
      ],
      collisionRadius: (d) => sizeScale(d.size) + 10,

      // Layout
      preTicks: 300,
      boundingRadius: (d) => sizeScale(d.size),
      fitPadding: 80,
      maxFitScale: 1.5,

      // Nodes
      nodeColor: (d) => getClusterColor(d.cluster_id),
      nodeRadius: (d) => sizeScale(d.size),
      nodeStrokeWidth: 3,
      nodeCursor: "pointer",
      nodeFilter: "drop-shadow(0 2px 4px rgba(0,0,0,0.15))",

      // Links
      linkStroke: "#94a3b8",
      linkStrokeOpacity: 0.6,
      linkStrokeWidth: (d) => Math.sqrt(d.edge_count) * 1.5,

      // Labels — truncate based on node radius
      labelText: (d) => {
        const radius = sizeScale(d.size);
        const maxChars = Math.floor(radius / 4);
        return d.label.length > maxChars
          ? d.label.slice(0, maxChars) + "\u2026"
          : d.label;
      },
      labelFontSize: (d) =>
        Math.max(8, Math.min(12, sizeScale(d.size) / 4)) + "px",
      labelFontWeight: "700",
      labelColor: "#fff",
      labelDy: "0.35em",
      labelInitialOpacity: 1,

      // Hover
      dimNodeOpacity: 0.2,
      dimLinkOpacity: 0.1,
      highlightLinkOpacity: 1,
      highlightLinkStroke: (d) => getClusterColor(d.cluster_id),
      highlightLabelOpacity: 1,
      dimLabelOpacity: 0.2,
      hoverRadiusScale: 1,

      // Tooltip
      tooltipContent: (d, _connectedIds) => {
        const topMembers = d.top_members
          .slice(0, 3)
          .map((m) => m.label)
          .join(", ");
        const topInterests = d.top_interests
          .slice(0, 2)
          .map((i) => i.interest)
          .join(", ");
        return `
          <div style="font-weight: 700; color: ${getClusterColor(d.cluster_id)}; margin-bottom: 0.25rem;">
            ${d.label}
          </div>
          <div style="color: #64748b; font-size: 0.75rem;">
            ${d.size} organizations &middot; ${(d.density * 100).toFixed(1)}% density
          </div>
          ${topMembers ? `<div style="margin-top: 0.5rem; font-size: 0.75rem; color: #475569;"><strong>Top members:</strong> ${topMembers}</div>` : ""}
          ${topInterests ? `<div style="font-size: 0.75rem; color: #475569;"><strong>Interests:</strong> ${topInterests}</div>` : ""}
          <div style="margin-top: 0.5rem; font-size: 0.75rem; color: #3B82F6; font-weight: 600;">
            Click to explore
          </div>
        `;
      },

      // Click → drill down
      onNodeClick: (_event, d) => setSelectedClusterId(d.cluster_id),

      // Resize: update center + x/y forces
      onResize: (simulation, w, h) => {
        simulation.force("center", d3.forceCenter(w / 2, h / 2));
        simulation.force("x", d3.forceX<SimClusterNode>(w / 2).strength(0.05));
        simulation.force("y", d3.forceY<SimClusterNode>(h / 2).strength(0.05));
        simulation.alpha(0.3).restart();
      },
    },
    overviewEnabled,
  );

  // ── Detail graph (Level 2) ────────────────────────────────────────────────────
  const detailEnabled =
    !loading && viewLevel === "detail" && detailData !== null;

  const detailNodes: SimDetailNode[] = detailData
    ? (detailData.nodes as SimDetailNode[])
    : [];
  const detailLinks: SimDetailLink[] = detailData
    ? (detailData.links as SimDetailLink[])
    : [];

  const clusterColor = detailData
    ? getClusterColor(detailData.cluster_id)
    : "#94a3b8";

  useForceGraph<SimDetailNode, SimDetailLink>(
    svgRef,
    tooltipRef,
    detailNodes,
    detailLinks,
    {
      // Forces
      linkForce: d3
        .forceLink<SimDetailNode, SimDetailLink>()
        .id((d) => d.id)
        .distance(LINK_DISTANCE_DETAIL),
      chargeForce: d3.forceManyBody<SimDetailNode>().strength(-150),
      collisionRadius: DETAIL_NODE_SIZE + 4,

      // Layout
      preTicks: 300,
      boundingRadius: () => 0,
      fitPadding: 100,
      maxFitScale: 1.5,

      // Nodes
      nodeColor: clusterColor,
      nodeRadius: DETAIL_NODE_SIZE,
      nodeStrokeWidth: 2,
      nodeCursor: "grab",
      nodeFilter: "drop-shadow(0 1px 2px rgba(0,0,0,0.1))",

      // Links
      linkStroke: "#cbd5e1",
      linkStrokeOpacity: 0.6,
      linkStrokeWidth: (d) => Math.sqrt(d.weight) * 1.5,

      // Labels — hidden by default, shown on hover
      labelText: (d) => d.label || d.id,
      labelFontSize: "11px",
      labelFontWeight: "600",
      labelColor: "#374151",
      labelDy: -(DETAIL_NODE_SIZE + 6),
      labelInitialOpacity: 0,

      // Hover
      dimNodeOpacity: 0.15,
      dimLinkOpacity: 0.05,
      highlightLinkOpacity: 1,
      highlightLinkStroke: () => clusterColor,
      highlightLinkStrokeWidth: (d) => Math.sqrt(d.weight) * 2.5,
      highlightLabelOpacity: 1,
      dimLabelOpacity: 0,
      hoverRadiusScale: 1.3,

      // Tooltip
      tooltipContent: (d, connectedIds) => `
        <div style="font-weight: 700; color: #1e293b;">${d.label || d.id}</div>
        <div style="color: #64748b; font-size: 0.75rem; margin-top: 0.25rem;">Organization</div>
        <div style="color: #64748b; font-size: 0.75rem;">${connectedIds.size} connections</div>
        ${d.interests_represented ? `<div style="margin-top: 0.5rem; font-size: 0.75rem; color: #475569;"><strong>Interest:</strong> ${d.interests_represented}</div>` : ""}
      `,

      // Resize: only re-center (no x/y forces in detail mode)
      onResize: (simulation, w, h) => {
        simulation.force("center", d3.forceCenter(w / 2, h / 2));
        simulation.alpha(0.3).restart();
      },
    },
    detailEnabled,
  );

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className="relative w-full h-full">
      {loading && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-slate-500 text-sm">
          Loading...
        </div>
      )}

      {error && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-red-50 text-red-600 px-4 py-2 rounded-lg text-sm z-[200]">
          {error}
        </div>
      )}

      {viewLevel === "detail" && detailData && !loading && (
        <ClusterHeader cluster={detailData} onBack={handleBack} />
      )}

      <svg
        ref={svgRef}
        className="w-full h-full bg-[rgb(250,250,255)] transition-opacity duration-200"
        style={{ opacity: loading ? 0.5 : 1 }}
      />

      {/* Overview Legend */}
      {viewLevel === "overview" && !loading && overviewData && (
        <div className="absolute bottom-4 right-4 bg-white/95 backdrop-blur-sm rounded-xl p-4 border border-slate-200 shadow-md">
          <div className="text-xs font-bold text-slate-900 mb-3 uppercase tracking-[0.05em]">
            Cluster Overview
          </div>
          <div className="text-[0.8125rem] text-slate-600 mb-2">
            {overviewData.metadata.total_clusters} clusters
          </div>
          <div className="text-[0.8125rem] text-slate-600 mb-2">
            {overviewData.metadata.total_nodes} organizations
          </div>
          <div className="text-[0.8125rem] text-slate-600">
            {overviewData.metadata.total_edges} connections
          </div>
          <div className="mt-3 pt-3 border-t border-slate-200 text-xs text-slate-500">
            Click a cluster to explore
          </div>
        </div>
      )}

      {/* Detail Legend */}
      {viewLevel === "detail" && !loading && detailData && (
        <div className="absolute bottom-4 right-4 bg-white/95 backdrop-blur-sm rounded-xl p-4 border border-slate-200 shadow-md">
          <div className="text-xs font-bold text-slate-900 mb-3 uppercase tracking-[0.05em]">
            Legend
          </div>
          <div className="flex items-center gap-2">
            <div
              className="w-[10px] h-[10px] rounded-full shrink-0"
              style={{ backgroundColor: getClusterColor(detailData.cluster_id) }}
            />
            <span className="text-[0.8125rem] text-slate-600">
              Organizations
            </span>
          </div>
        </div>
      )}

      {/* Tooltip */}
      <div
        ref={tooltipRef}
        className="fixed z-[1000] px-3 py-2 bg-white rounded-lg shadow-md border border-slate-200 text-sm pointer-events-none max-w-[280px] transition-opacity duration-[150ms] ease-linear"
        style={{ opacity: 0 }}
      />
    </div>
  );
}
