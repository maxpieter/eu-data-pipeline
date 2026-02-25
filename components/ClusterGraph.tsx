"use client";

import { useEffect, useRef, useState } from "react";
import * as d3 from "d3";
import {
  ClusterOverviewData,
  ClusterDetailData,
  ClusterNode,
  ClusterLink,
  ClusterDetailNode,
  ClusterDetailLink,
  fetchClusterOverview,
  fetchClusterDetail,
  getClusterColor,
} from "@/lib/data";
import ClusterHeader from "./ClusterHeader";

// Types for simulation
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

// Fixed values
const MIN_NODE_SIZE = 10;
const MAX_NODE_SIZE = 50;
const DETAIL_NODE_SIZE = 8;
const LINK_DISTANCE_OVERVIEW = 150;
const LINK_DISTANCE_DETAIL = 80;

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

  // Fetch overview data on mount
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

  // Fetch detail data when a cluster is selected
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

  // Handle back navigation
  const handleBack = () => {
    setViewLevel("overview");
    setSelectedClusterId(null);
    setDetailData(null);
  };

  // Render overview (Level 1)
  useEffect(() => {
    if (!svgRef.current || loading || viewLevel !== "overview" || !overviewData)
      return;

    const svg = d3.select(svgRef.current);
    const container = svgRef.current.parentElement!;
    const width = container.clientWidth;
    const height = container.clientHeight;

    svg.selectAll("*").remove();

    const nodes: SimClusterNode[] = overviewData.nodes.map((d) => ({ ...d }));
    const links: SimClusterLink[] = overviewData.links.map((d) => ({ ...d }));

    // Scale node size based on member count
    const sizeScale = d3
      .scaleSqrt()
      .domain([0, d3.max(nodes, (d) => d.size) || 1])
      .range([MIN_NODE_SIZE, MAX_NODE_SIZE]);

    // Pre-run simulation
    const preSimulation = d3
      .forceSimulation<SimClusterNode>(nodes)
      .force(
        "link",
        d3
          .forceLink<SimClusterNode, SimClusterLink>(links)
          .id((d) => d.id)
          .distance(LINK_DISTANCE_OVERVIEW),
      )
      .force("charge", d3.forceManyBody<SimClusterNode>().strength(-30))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("x", d3.forceX<SimClusterNode>(width / 2).strength(0.05))
      .force("y", d3.forceY<SimClusterNode>(height / 2).strength(0.05))
      .force(
        "collision",
        d3.forceCollide<SimClusterNode>().radius((d) => sizeScale(d.size) + 10),
      )
      .stop();

    for (let i = 0; i < 300; i++) {
      preSimulation.tick();
    }

    // Calculate initial transform
    const padding = 80;
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
    nodes.forEach((n) => {
      if (n.x !== undefined && n.y !== undefined) {
        const r = sizeScale(n.size);
        minX = Math.min(minX, n.x - r);
        maxX = Math.max(maxX, n.x + r);
        minY = Math.min(minY, n.y - r);
        maxY = Math.max(maxY, n.y + r);
      }
    });

    let initialTransform = d3.zoomIdentity;
    if (isFinite(minX) && nodes.length > 0) {
      const boundsWidth = maxX - minX;
      const boundsHeight = maxY - minY;
      const centerX = (minX + maxX) / 2;
      const centerY = (minY + maxY) / 2;
      const scale = Math.min(
        (width - padding * 2) / (boundsWidth || 1),
        (height - padding * 2) / (boundsHeight || 1),
        1.5,
      );
      initialTransform = d3.zoomIdentity
        .translate(width / 2, height / 2)
        .scale(scale)
        .translate(-centerX, -centerY);
    }

    const g = svg.append("g");

    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 10])
      .on("zoom", (event) => {
        g.attr("transform", event.transform);
      });

    svg.call(zoom);
    svg.call(zoom.transform, initialTransform);

    // Links
    const linkGroup = g.append("g").attr("class", "links");
    const link = linkGroup
      .selectAll<SVGLineElement, SimClusterLink>("line")
      .data(links)
      .join("line")
      .attr("stroke", "#94a3b8")
      .attr("stroke-opacity", 0.6)
      .attr("stroke-width", (d) => Math.sqrt(d.edge_count) * 1.5)
      .attr("x1", (d) => (d.source as SimClusterNode).x!)
      .attr("y1", (d) => (d.source as SimClusterNode).y!)
      .attr("x2", (d) => (d.target as SimClusterNode).x!)
      .attr("y2", (d) => (d.target as SimClusterNode).y!);

    // Nodes
    const nodeGroup = g.append("g").attr("class", "nodes");
    const node = nodeGroup
      .selectAll<SVGCircleElement, SimClusterNode>("circle")
      .data(nodes)
      .join("circle")
      .attr("r", (d) => sizeScale(d.size))
      .attr("fill", (d) => getClusterColor(d.cluster_id))
      .attr("stroke", "#fff")
      .attr("stroke-width", 3)
      .attr("cx", (d) => d.x!)
      .attr("cy", (d) => d.y!)
      .style("cursor", "pointer")
      .style("filter", "drop-shadow(0 2px 4px rgba(0,0,0,0.15))");

    // Name labels (inside nodes)
    const labelGroup = g.append("g").attr("class", "labels");
    const labels = labelGroup
      .selectAll<SVGTextElement, SimClusterNode>("text")
      .data(nodes)
      .join("text")
      .attr(
        "font-size",
        (d) => Math.max(8, Math.min(12, sizeScale(d.size) / 4)) + "px",
      )
      .attr("font-weight", "700")
      .attr("fill", "#fff")
      .attr("text-anchor", "middle")
      .attr("dy", "0.35em")
      .attr("x", (d) => d.x!)
      .attr("y", (d) => d.y!)
      .attr("pointer-events", "none")
      .text((d) => {
        // Truncate based on node size
        const radius = sizeScale(d.size);
        const maxChars = Math.floor(radius / 4);
        return d.label.length > maxChars
          ? d.label.slice(0, maxChars) + "…"
          : d.label;
      });

    // Simulation for drag
    const simulation = d3
      .forceSimulation<SimClusterNode>(nodes)
      .force(
        "link",
        d3
          .forceLink<SimClusterNode, SimClusterLink>(links)
          .id((d) => d.id)
          .distance(LINK_DISTANCE_OVERVIEW),
      )
      .force("charge", d3.forceManyBody<SimClusterNode>().strength(-30))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("x", d3.forceX<SimClusterNode>(width / 2).strength(0.05))
      .force("y", d3.forceY<SimClusterNode>(height / 2).strength(0.05))
      .force(
        "collision",
        d3.forceCollide<SimClusterNode>().radius((d) => sizeScale(d.size) + 10),
      )
      .alpha(0.1)
      .alphaDecay(0.02);

    simulation.on("tick", () => {
      link
        .attr("x1", (d) => (d.source as SimClusterNode).x!)
        .attr("y1", (d) => (d.source as SimClusterNode).y!)
        .attr("x2", (d) => (d.target as SimClusterNode).x!)
        .attr("y2", (d) => (d.target as SimClusterNode).y!);

      node.attr("cx", (d) => d.x!).attr("cy", (d) => d.y!);

      labels.attr("x", (d) => d.x!).attr("y", (d) => d.y!);
    });

    // Drag
    const drag = d3
      .drag<SVGCircleElement, SimClusterNode>()
      .on("start", (event, d) => {
        if (!event.active) simulation.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
      })
      .on("drag", (event, d) => {
        d.fx = event.x;
        d.fy = event.y;
      })
      .on("end", (event, d) => {
        if (!event.active) simulation.alphaTarget(0);
        d.fx = null;
        d.fy = null;
      });

    node.call(drag);

    // Click handler for drill-down
    node.on("click", (event, d) => {
      event.stopPropagation();
      setSelectedClusterId(d.cluster_id);
    });

    // Hover effects
    node.on("mouseover", function (event, d) {
      const connectedIds = new Set<string>();
      links.forEach((l) => {
        const sourceId =
          typeof l.source === "object"
            ? (l.source as SimClusterNode).id
            : String(l.source);
        const targetId =
          typeof l.target === "object"
            ? (l.target as SimClusterNode).id
            : String(l.target);
        if (sourceId === d.id) connectedIds.add(targetId);
        if (targetId === d.id) connectedIds.add(sourceId);
      });

      node.attr("opacity", (n) =>
        n.id === d.id || connectedIds.has(n.id) ? 1 : 0.2,
      );

      link
        .attr("opacity", (l) => {
          const sourceId =
            typeof l.source === "object"
              ? (l.source as SimClusterNode).id
              : String(l.source);
          const targetId =
            typeof l.target === "object"
              ? (l.target as SimClusterNode).id
              : String(l.target);
          return sourceId === d.id || targetId === d.id ? 1 : 0.1;
        })
        .attr("stroke", (l) => {
          const sourceId =
            typeof l.source === "object"
              ? (l.source as SimClusterNode).id
              : String(l.source);
          const targetId =
            typeof l.target === "object"
              ? (l.target as SimClusterNode).id
              : String(l.target);
          return sourceId === d.id || targetId === d.id
            ? getClusterColor(d.cluster_id)
            : "#94a3b8";
        });

      labels.attr("opacity", (n) =>
        n.id === d.id || connectedIds.has(n.id) ? 1 : 0.2,
      );

      // Tooltip
      if (tooltipRef.current) {
        const topMembers = d.top_members
          .slice(0, 3)
          .map((m) => m.label)
          .join(", ");
        const topInterests = d.top_interests
          .slice(0, 2)
          .map((i) => i.interest)
          .join(", ");

        tooltipRef.current.innerHTML = `
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
        tooltipRef.current.style.opacity = "1";
        tooltipRef.current.style.left = `${event.pageX + 12}px`;
        tooltipRef.current.style.top = `${event.pageY + 12}px`;
      }
    });

    node.on("mouseout", function () {
      node.attr("opacity", 1);
      link.attr("opacity", 0.6).attr("stroke", "#94a3b8");
      labels.attr("opacity", 1);

      if (tooltipRef.current) {
        tooltipRef.current.style.opacity = "0";
      }
    });

    // Handle resize
    const handleResize = () => {
      const newWidth = container.clientWidth;
      const newHeight = container.clientHeight;
      simulation.force("center", d3.forceCenter(newWidth / 2, newHeight / 2));
      simulation.force(
        "x",
        d3.forceX<SimClusterNode>(newWidth / 2).strength(0.05),
      );
      simulation.force(
        "y",
        d3.forceY<SimClusterNode>(newHeight / 2).strength(0.05),
      );
      simulation.alpha(0.3).restart();
    };

    window.addEventListener("resize", handleResize);

    return () => {
      simulation.stop();
      window.removeEventListener("resize", handleResize);
    };
  }, [overviewData, loading, viewLevel]);

  // Render detail (Level 2)
  useEffect(() => {
    if (!svgRef.current || loading || viewLevel !== "detail" || !detailData)
      return;

    const svg = d3.select(svgRef.current);
    const container = svgRef.current.parentElement!;
    const width = container.clientWidth;
    const height = container.clientHeight;

    svg.selectAll("*").remove();

    const nodes: SimDetailNode[] = detailData.nodes.map((d) => ({ ...d }));
    const links: SimDetailLink[] = detailData.links.map((d) => ({ ...d }));

    const clusterColor = getClusterColor(detailData.cluster_id);

    // Pre-run simulation
    const preSimulation = d3
      .forceSimulation<SimDetailNode>(nodes)
      .force(
        "link",
        d3
          .forceLink<SimDetailNode, SimDetailLink>(links)
          .id((d) => d.id)
          .distance(LINK_DISTANCE_DETAIL),
      )
      .force("charge", d3.forceManyBody<SimDetailNode>().strength(-150))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force(
        "collision",
        d3.forceCollide<SimDetailNode>().radius(DETAIL_NODE_SIZE + 4),
      )
      .stop();

    for (let i = 0; i < 300; i++) {
      preSimulation.tick();
    }

    // Calculate initial transform
    const padding = 100; // Extra padding for header
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
    nodes.forEach((n) => {
      if (n.x !== undefined && n.y !== undefined) {
        minX = Math.min(minX, n.x);
        maxX = Math.max(maxX, n.x);
        minY = Math.min(minY, n.y);
        maxY = Math.max(maxY, n.y);
      }
    });

    let initialTransform = d3.zoomIdentity;
    if (isFinite(minX) && nodes.length > 0) {
      const boundsWidth = maxX - minX;
      const boundsHeight = maxY - minY;
      const centerX = (minX + maxX) / 2;
      const centerY = (minY + maxY) / 2;
      const scale = Math.min(
        (width - padding * 2) / (boundsWidth || 1),
        (height - padding * 2) / (boundsHeight || 1),
        1.5,
      );
      initialTransform = d3.zoomIdentity
        .translate(width / 2, height / 2)
        .scale(scale)
        .translate(-centerX, -centerY);
    }

    const g = svg.append("g");

    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 10])
      .on("zoom", (event) => {
        g.attr("transform", event.transform);
      });

    svg.call(zoom);
    svg.call(zoom.transform, initialTransform);

    // Links
    const linkGroup = g.append("g").attr("class", "links");
    const link = linkGroup
      .selectAll<SVGLineElement, SimDetailLink>("line")
      .data(links)
      .join("line")
      .attr("stroke", "#cbd5e1")
      .attr("stroke-opacity", 0.6)
      .attr("stroke-width", (d) => Math.sqrt(d.weight) * 1.5)
      .attr("x1", (d) => (d.source as SimDetailNode).x!)
      .attr("y1", (d) => (d.source as SimDetailNode).y!)
      .attr("x2", (d) => (d.target as SimDetailNode).x!)
      .attr("y2", (d) => (d.target as SimDetailNode).y!);

    // Nodes
    const nodeGroup = g.append("g").attr("class", "nodes");
    const node = nodeGroup
      .selectAll<SVGCircleElement, SimDetailNode>("circle")
      .data(nodes)
      .join("circle")
      .attr("r", DETAIL_NODE_SIZE)
      .attr("fill", clusterColor)
      .attr("stroke", "#fff")
      .attr("stroke-width", 2)
      .attr("cx", (d) => d.x!)
      .attr("cy", (d) => d.y!)
      .style("cursor", "grab")
      .style("filter", "drop-shadow(0 1px 2px rgba(0,0,0,0.1))");

    // Labels (hidden by default)
    const labelGroup = g.append("g").attr("class", "labels");
    const labels = labelGroup
      .selectAll<SVGTextElement, SimDetailNode>("text")
      .data(nodes)
      .join("text")
      .attr("font-size", "11px")
      .attr("font-weight", "600")
      .attr("fill", "#374151")
      .attr("text-anchor", "middle")
      .attr("dy", -DETAIL_NODE_SIZE - 6)
      .attr("x", (d) => d.x!)
      .attr("y", (d) => d.y!)
      .attr("opacity", 0)
      .attr("pointer-events", "none")
      .text((d) => d.label || d.id);

    // Simulation for drag
    const simulation = d3
      .forceSimulation<SimDetailNode>(nodes)
      .force(
        "link",
        d3
          .forceLink<SimDetailNode, SimDetailLink>(links)
          .id((d) => d.id)
          .distance(LINK_DISTANCE_DETAIL),
      )
      .force("charge", d3.forceManyBody<SimDetailNode>().strength(-150))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force(
        "collision",
        d3.forceCollide<SimDetailNode>().radius(DETAIL_NODE_SIZE + 4),
      )
      .alpha(0.1)
      .alphaDecay(0.02);

    simulation.on("tick", () => {
      link
        .attr("x1", (d) => (d.source as SimDetailNode).x!)
        .attr("y1", (d) => (d.source as SimDetailNode).y!)
        .attr("x2", (d) => (d.target as SimDetailNode).x!)
        .attr("y2", (d) => (d.target as SimDetailNode).y!);

      node.attr("cx", (d) => d.x!).attr("cy", (d) => d.y!);

      labels.attr("x", (d) => d.x!).attr("y", (d) => d.y!);
    });

    // Drag
    const drag = d3
      .drag<SVGCircleElement, SimDetailNode>()
      .on("start", (event, d) => {
        if (!event.active) simulation.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
      })
      .on("drag", (event, d) => {
        d.fx = event.x;
        d.fy = event.y;
      })
      .on("end", (event, d) => {
        if (!event.active) simulation.alphaTarget(0);
        d.fx = null;
        d.fy = null;
      });

    node.call(drag);

    // Hover effects
    node.on("mouseover", function (event, d) {
      const connectedIds = new Set<string>();
      links.forEach((l) => {
        const sourceId =
          typeof l.source === "object"
            ? (l.source as SimDetailNode).id
            : String(l.source);
        const targetId =
          typeof l.target === "object"
            ? (l.target as SimDetailNode).id
            : String(l.target);
        if (sourceId === d.id) connectedIds.add(targetId);
        if (targetId === d.id) connectedIds.add(sourceId);
      });

      node
        .attr("opacity", (n) =>
          n.id === d.id || connectedIds.has(n.id) ? 1 : 0.15,
        )
        .attr("r", (n) =>
          n.id === d.id ? DETAIL_NODE_SIZE * 1.3 : DETAIL_NODE_SIZE,
        );

      link
        .attr("opacity", (l) => {
          const sourceId =
            typeof l.source === "object"
              ? (l.source as SimDetailNode).id
              : String(l.source);
          const targetId =
            typeof l.target === "object"
              ? (l.target as SimDetailNode).id
              : String(l.target);
          return sourceId === d.id || targetId === d.id ? 1 : 0.05;
        })
        .attr("stroke", (l) => {
          const sourceId =
            typeof l.source === "object"
              ? (l.source as SimDetailNode).id
              : String(l.source);
          const targetId =
            typeof l.target === "object"
              ? (l.target as SimDetailNode).id
              : String(l.target);
          return sourceId === d.id || targetId === d.id
            ? clusterColor
            : "#cbd5e1";
        })
        .attr("stroke-width", (l) => {
          const sourceId =
            typeof l.source === "object"
              ? (l.source as SimDetailNode).id
              : String(l.source);
          const targetId =
            typeof l.target === "object"
              ? (l.target as SimDetailNode).id
              : String(l.target);
          return sourceId === d.id || targetId === d.id
            ? Math.sqrt(l.weight) * 2.5
            : Math.sqrt(l.weight) * 1.5;
        });

      labels.attr("opacity", (n) =>
        n.id === d.id || connectedIds.has(n.id) ? 1 : 0,
      );

      // Tooltip
      if (tooltipRef.current) {
        tooltipRef.current.innerHTML = `
          <div style="font-weight: 700; color: #1e293b;">${d.label || d.id}</div>
          <div style="color: #64748b; font-size: 0.75rem; margin-top: 0.25rem;">Organization</div>
          <div style="color: #64748b; font-size: 0.75rem;">${connectedIds.size} connections</div>
          ${d.interests_represented ? `<div style="margin-top: 0.5rem; font-size: 0.75rem; color: #475569;"><strong>Interest:</strong> ${d.interests_represented}</div>` : ""}
        `;
        tooltipRef.current.style.opacity = "1";
        tooltipRef.current.style.left = `${event.pageX + 12}px`;
        tooltipRef.current.style.top = `${event.pageY + 12}px`;
      }
    });

    node.on("mouseout", function () {
      node.attr("opacity", 1).attr("r", DETAIL_NODE_SIZE);
      link
        .attr("opacity", 0.6)
        .attr("stroke", "#cbd5e1")
        .attr("stroke-width", (d) => Math.sqrt(d.weight) * 1.5);
      labels.attr("opacity", 0);

      if (tooltipRef.current) {
        tooltipRef.current.style.opacity = "0";
      }
    });

    // Handle resize
    const handleResize = () => {
      const newWidth = container.clientWidth;
      const newHeight = container.clientHeight;
      simulation.force("center", d3.forceCenter(newWidth / 2, newHeight / 2));
      simulation.alpha(0.3).restart();
    };

    window.addEventListener("resize", handleResize);

    return () => {
      simulation.stop();
      window.removeEventListener("resize", handleResize);
    };
  }, [detailData, loading, viewLevel]);

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      {loading && (
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            color: "#64748b",
            fontSize: "0.875rem",
          }}
        >
          Loading...
        </div>
      )}

      {error && (
        <div
          style={{
            position: "absolute",
            top: "1rem",
            left: "50%",
            transform: "translateX(-50%)",
            background: "#fef2f2",
            color: "#dc2626",
            padding: "0.5rem 1rem",
            borderRadius: "8px",
            fontSize: "0.875rem",
            zIndex: 200,
          }}
        >
          {error}
        </div>
      )}

      {/* Detail view header */}
      {viewLevel === "detail" && detailData && !loading && (
        <ClusterHeader cluster={detailData} onBack={handleBack} />
      )}

      <svg
        ref={svgRef}
        style={{
          width: "100%",
          height: "100%",
          background: "rgb(250, 250, 255)",
          opacity: loading ? 0.5 : 1,
          transition: "opacity 0.2s",
        }}
      />

      {/* Overview Legend */}
      {viewLevel === "overview" && !loading && overviewData && (
        <div
          style={{
            position: "absolute",
            bottom: "1rem",
            right: "1rem",
            background: "rgba(255, 255, 255, 0.95)",
            backdropFilter: "blur(8px)",
            borderRadius: "12px",
            padding: "1rem",
            border: "1px solid #e2e8f0",
            boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1)",
          }}
        >
          <div
            style={{
              fontSize: "0.75rem",
              fontWeight: 700,
              color: "#1e293b",
              marginBottom: "0.75rem",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            Cluster Overview
          </div>
          <div
            style={{
              fontSize: "0.8125rem",
              color: "#475569",
              marginBottom: "0.5rem",
            }}
          >
            {overviewData.metadata.total_clusters} clusters
          </div>
          <div
            style={{
              fontSize: "0.8125rem",
              color: "#475569",
              marginBottom: "0.5rem",
            }}
          >
            {overviewData.metadata.total_nodes} organizations
          </div>
          <div style={{ fontSize: "0.8125rem", color: "#475569" }}>
            {overviewData.metadata.total_edges} connections
          </div>
          <div
            style={{
              marginTop: "0.75rem",
              paddingTop: "0.75rem",
              borderTop: "1px solid #e2e8f0",
              fontSize: "0.75rem",
              color: "#64748b",
            }}
          >
            Click a cluster to explore
          </div>
        </div>
      )}

      {/* Detail Legend */}
      {viewLevel === "detail" && !loading && detailData && (
        <div
          style={{
            position: "absolute",
            bottom: "1rem",
            right: "1rem",
            background: "rgba(255, 255, 255, 0.95)",
            backdropFilter: "blur(8px)",
            borderRadius: "12px",
            padding: "1rem",
            border: "1px solid #e2e8f0",
            boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1)",
          }}
        >
          <div
            style={{
              fontSize: "0.75rem",
              fontWeight: 700,
              color: "#1e293b",
              marginBottom: "0.75rem",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            Legend
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <div
              style={{
                width: "10px",
                height: "10px",
                borderRadius: "50%",
                backgroundColor: getClusterColor(detailData.cluster_id),
                flexShrink: 0,
              }}
            />
            <span style={{ fontSize: "0.8125rem", color: "#475569" }}>
              Organizations
            </span>
          </div>
        </div>
      )}

      {/* Tooltip */}
      <div
        ref={tooltipRef}
        style={{
          position: "fixed",
          zIndex: 1000,
          padding: "0.5rem 0.75rem",
          background: "white",
          borderRadius: "8px",
          boxShadow:
            "0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)",
          border: "1px solid #e2e8f0",
          fontSize: "0.875rem",
          pointerEvents: "none",
          opacity: 0,
          transition: "opacity 0.15s ease",
          maxWidth: "280px",
        }}
      />
    </div>
  );
}
