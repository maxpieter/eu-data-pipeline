"use client";

import { useEffect, RefObject } from "react";
import * as d3 from "d3";

// ── Generic node / link constraints ──────────────────────────────────────────

export interface ForceGraphNode extends d3.SimulationNodeDatum {
  id: string;
}

export interface ForceGraphLink<N extends ForceGraphNode>
  extends d3.SimulationLinkDatum<N> {}

// ── Configuration passed by each call site ───────────────────────────────────

export interface ForceGraphConfig<
  N extends ForceGraphNode,
  L extends ForceGraphLink<N>,
> {
  // ── Forces ──────────────────────────────────────────────────────────────────
  /** Force applied along links. */
  linkForce: d3.ForceLink<N, L>;
  /** Charge (many-body) force. */
  chargeForce: d3.ForceManyBody<N>;
  /** Optional extra forces beyond link/charge/center/collide (e.g. forceX/Y). */
  extraForces?: Array<[string, d3.Force<N, L>]>;
  /** Collision radius for each node. */
  collisionRadius: number | ((node: N) => number);

  // ── Layout ──────────────────────────────────────────────────────────────────
  /** Number of ticks to pre-compute before rendering. Default: 300. */
  preTicks?: number;
  /**
   * Radius used when computing the auto-fit bounding box.
   * Pass 0 (or omit) to use point bounds.
   */
  boundingRadius?: (node: N) => number;
  /** Padding (px) around the fitted graph. Default: 80. */
  fitPadding?: number;
  /** Maximum initial zoom scale. Default: 1.5. */
  maxFitScale?: number;

  // ── Visual accessors ────────────────────────────────────────────────────────
  /** Fill color for each node circle. */
  nodeColor: string | ((node: N) => string);
  /** Radius of each node circle. */
  nodeRadius: number | ((node: N) => number);
  /** Stroke width of each node. Default: 2. */
  nodeStrokeWidth?: number;
  /** CSS cursor on nodes. Default: "pointer". */
  nodeCursor?: string;
  /** CSS filter on nodes. */
  nodeFilter?: string;

  /** Stroke color for links at rest. */
  linkStroke: string;
  /** Stroke opacity for links at rest. Default: 0.6. */
  linkStrokeOpacity?: number;
  /** Stroke width for each link at rest. */
  linkStrokeWidth: (link: L) => number;

  /** Label text for each node. */
  labelText: (node: N) => string;
  /** Font size (CSS string) for labels. Default: "11px". */
  labelFontSize?: string | ((node: N) => string);
  /** Font weight for labels. Default: "600". */
  labelFontWeight?: string;
  /** Label fill color. Default: "#374151". */
  labelColor?: string;
  /** dy offset for labels (vertical alignment). Default: -DETAIL_NODE_SIZE-6. */
  labelDy?: string | number;
  /** Initial opacity for labels. Default: 0. */
  labelInitialOpacity?: number;

  // ── Hover behaviour ─────────────────────────────────────────────────────────
  /** Opacity for non-highlighted nodes on hover. Default: 0.2. */
  dimNodeOpacity?: number;
  /** Opacity for non-highlighted links on hover. Default: 0.1. */
  dimLinkOpacity?: number;
  /** Highlighted link opacity. Default: 1. */
  highlightLinkOpacity?: number;
  /** Highlighted link stroke color (uses nodeColor of hovered node if omitted). */
  highlightLinkStroke?: (hoveredNode: N) => string;
  /** Stroke width for highlighted links on hover (optional). */
  highlightLinkStrokeWidth?: (link: L) => number;
  /** Opacity shown on hovered-node labels and connected labels. Default: 1. */
  highlightLabelOpacity?: number;
  /** Dim opacity for labels when another node is hovered. Default: 0. */
  dimLabelOpacity?: number;
  /** Scale factor applied to hovered node radius. 1 = no change. Default: 1. */
  hoverRadiusScale?: number;

  // ── Tooltip ─────────────────────────────────────────────────────────────────
  /** HTML string to render in the tooltip for a hovered node. */
  tooltipContent: (node: N, connectedIds: Set<string>) => string;

  // ── Interactions ────────────────────────────────────────────────────────────
  /** Called when a node is clicked. */
  onNodeClick?: (event: MouseEvent, node: N) => void;

  // ── Resize ──────────────────────────────────────────────────────────────────
  /**
   * Called on window resize with the live simulation and new dimensions.
   * Use this to update center/x/y forces and restart the simulation.
   */
  onResize: (
    simulation: d3.Simulation<N, L>,
    width: number,
    height: number,
  ) => void;
}

// ── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Mounts a D3 force-directed graph into `svgRef`.
 *
 * Pattern:
 *  1. Clear SVG and grab container dimensions.
 *  2. Pre-simulate `preTicks` ticks (positions are stable before paint).
 *  3. Auto-fit the initial zoom transform.
 *  4. Render links, nodes, labels.
 *  5. Start a low-alpha live simulation for drag interactivity.
 *  6. Wire up drag, hover highlights, tooltip, resize.
 *  7. Return cleanup that stops the simulation and removes the resize listener.
 *
 * The hook is generic over node type N and link type L so callers can keep
 * their fully-typed data without casting.
 */
export function useForceGraph<
  N extends ForceGraphNode,
  L extends ForceGraphLink<N>,
>(
  svgRef: RefObject<SVGSVGElement | null>,
  tooltipRef: RefObject<HTMLDivElement | null>,
  nodes: N[],
  links: L[],
  config: ForceGraphConfig<N, L>,
  enabled: boolean,
): void {
  useEffect(() => {
    if (!enabled || !svgRef.current) return;

    const svgEl = svgRef.current;
    const svg = d3.select<SVGSVGElement, unknown>(svgEl);
    const container = svgEl.parentElement!;
    const width = container.clientWidth;
    const height = container.clientHeight;

    // ── Defensive: clone data so D3 can mutate x/y/vx/vy ───────────────────
    const simNodes: N[] = nodes.map((d) => ({ ...d }));
    const simLinks: L[] = links.map((d) => ({ ...d }));

    // ── Resolve config defaults ──────────────────────────────────────────────
    const preTicks = config.preTicks ?? 300;
    const fitPadding = config.fitPadding ?? 80;
    const maxFitScale = config.maxFitScale ?? 1.5;
    const boundingRadius = config.boundingRadius ?? (() => 0);
    const nodeStrokeWidth = config.nodeStrokeWidth ?? 2;
    const nodeCursor = config.nodeCursor ?? "pointer";
    const linkStrokeOpacity = config.linkStrokeOpacity ?? 0.6;
    const labelFontSize =
      typeof config.labelFontSize === "string"
        ? () => config.labelFontSize as string
        : config.labelFontSize ?? (() => "11px");
    const labelFontWeight = config.labelFontWeight ?? "600";
    const labelColor = config.labelColor ?? "#374151";
    const labelDy = config.labelDy ?? "-1em";
    const labelInitialOpacity = config.labelInitialOpacity ?? 0;
    const dimNodeOpacity = config.dimNodeOpacity ?? 0.2;
    const dimLinkOpacity = config.dimLinkOpacity ?? 0.1;
    const highlightLinkOpacity = config.highlightLinkOpacity ?? 1;
    const highlightLabelOpacity = config.highlightLabelOpacity ?? 1;
    const dimLabelOpacity = config.dimLabelOpacity ?? 0;
    const hoverRadiusScale = config.hoverRadiusScale ?? 1;

    const resolveNodeColor = (d: N) =>
      typeof config.nodeColor === "function"
        ? config.nodeColor(d)
        : config.nodeColor;

    const resolveNodeRadius = (d: N) =>
      typeof config.nodeRadius === "function"
        ? config.nodeRadius(d)
        : config.nodeRadius;

    const resolveHighlightLinkStroke = (hovered: N) =>
      config.highlightLinkStroke
        ? config.highlightLinkStroke(hovered)
        : resolveNodeColor(hovered);

    // ── Clear SVG ────────────────────────────────────────────────────────────
    svg.selectAll("*").remove();

    // ── Helper: get the resolved node id from a link endpoint ────────────────
    function resolveEndpointId(
      endpoint: string | number | N,
    ): string {
      return typeof endpoint === "object"
        ? (endpoint as N).id
        : String(endpoint);
    }

    // ── Build and run pre-simulation ─────────────────────────────────────────
    const buildSimulation = () => {
      const sim = d3
        .forceSimulation<N>(simNodes)
        .force("link", config.linkForce.links(simLinks))
        .force("charge", config.chargeForce)
        .force("center", d3.forceCenter(width / 2, height / 2))
        .force(
          "collision",
          d3
            .forceCollide<N>()
            .radius(
              typeof config.collisionRadius === "function"
                ? config.collisionRadius
                : () => config.collisionRadius as number,
            ),
        );

      (config.extraForces ?? []).forEach(([name, force]) => {
        sim.force(name, force);
      });

      return sim;
    };

    // Pre-run
    const preSimulation = buildSimulation().stop();
    for (let i = 0; i < preTicks; i++) {
      preSimulation.tick();
    }

    // ── Auto-fit initial transform ───────────────────────────────────────────
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;

    simNodes.forEach((n) => {
      if (n.x !== undefined && n.y !== undefined) {
        const r = boundingRadius(n);
        minX = Math.min(minX, n.x - r);
        maxX = Math.max(maxX, n.x + r);
        minY = Math.min(minY, n.y - r);
        maxY = Math.max(maxY, n.y + r);
      }
    });

    let initialTransform = d3.zoomIdentity;
    if (isFinite(minX) && simNodes.length > 0) {
      const boundsWidth = maxX - minX;
      const boundsHeight = maxY - minY;
      const centerX = (minX + maxX) / 2;
      const centerY = (minY + maxY) / 2;
      const scale = Math.min(
        (width - fitPadding * 2) / (boundsWidth || 1),
        (height - fitPadding * 2) / (boundsHeight || 1),
        maxFitScale,
      );
      initialTransform = d3.zoomIdentity
        .translate(width / 2, height / 2)
        .scale(scale)
        .translate(-centerX, -centerY);
    }

    // ── Zoom & root group ────────────────────────────────────────────────────
    const g = svg.append("g");

    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 10])
      .on("zoom", (event) => {
        g.attr("transform", event.transform);
      });

    svg.call(zoom);
    svg.call(zoom.transform, initialTransform);

    // ── Links ────────────────────────────────────────────────────────────────
    const linkGroup = g.append("g").attr("class", "links");
    const link = linkGroup
      .selectAll<SVGLineElement, L>("line")
      .data(simLinks)
      .join("line")
      .attr("stroke", config.linkStroke)
      .attr("stroke-opacity", linkStrokeOpacity)
      .attr("stroke-width", config.linkStrokeWidth)
      .attr("x1", (d) => (d.source as N).x!)
      .attr("y1", (d) => (d.source as N).y!)
      .attr("x2", (d) => (d.target as N).x!)
      .attr("y2", (d) => (d.target as N).y!);

    // ── Nodes ────────────────────────────────────────────────────────────────
    const nodeGroup = g.append("g").attr("class", "nodes");
    const node = nodeGroup
      .selectAll<SVGCircleElement, N>("circle")
      .data(simNodes)
      .join("circle")
      .attr("r", resolveNodeRadius)
      .attr("fill", resolveNodeColor)
      .attr("stroke", "#fff")
      .attr("stroke-width", nodeStrokeWidth)
      .attr("cx", (d) => d.x!)
      .attr("cy", (d) => d.y!)
      .style("cursor", nodeCursor);

    if (config.nodeFilter) {
      node.style("filter", config.nodeFilter);
    }

    // ── Labels ───────────────────────────────────────────────────────────────
    const labelGroup = g.append("g").attr("class", "labels");
    const labels = labelGroup
      .selectAll<SVGTextElement, N>("text")
      .data(simNodes)
      .join("text")
      .attr("font-size", labelFontSize)
      .attr("font-weight", labelFontWeight)
      .attr("fill", labelColor)
      .attr("text-anchor", "middle")
      .attr("dy", typeof labelDy === "number" ? labelDy : labelDy)
      .attr("x", (d) => d.x!)
      .attr("y", (d) => d.y!)
      .attr("opacity", labelInitialOpacity)
      .attr("pointer-events", "none")
      .text(config.labelText);

    // ── Live simulation (low-alpha, for drag) ────────────────────────────────
    const simulation = buildSimulation().alpha(0.1).alphaDecay(0.02);

    simulation.on("tick", () => {
      link
        .attr("x1", (d) => (d.source as N).x!)
        .attr("y1", (d) => (d.source as N).y!)
        .attr("x2", (d) => (d.target as N).x!)
        .attr("y2", (d) => (d.target as N).y!);

      node.attr("cx", (d) => d.x!).attr("cy", (d) => d.y!);
      labels.attr("x", (d) => d.x!).attr("y", (d) => d.y!);
    });

    // ── Drag ─────────────────────────────────────────────────────────────────
    const drag = d3
      .drag<SVGCircleElement, N>()
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

    // ── Click ────────────────────────────────────────────────────────────────
    if (config.onNodeClick) {
      node.on("click", (event: MouseEvent, d: N) => {
        event.stopPropagation();
        config.onNodeClick!(event, d);
      });
    }

    // ── Hover: mouseover ─────────────────────────────────────────────────────
    node.on("mouseover", function (event: MouseEvent, d: N) {
      // Build connected-neighbour set
      const connectedIds = new Set<string>();
      simLinks.forEach((l) => {
        const srcId = resolveEndpointId(l.source as string | number | N);
        const tgtId = resolveEndpointId(l.target as string | number | N);
        if (srcId === d.id) connectedIds.add(tgtId);
        if (tgtId === d.id) connectedIds.add(srcId);
      });

      // Dim/highlight nodes
      node
        .attr("opacity", (n) =>
          n.id === d.id || connectedIds.has(n.id) ? 1 : dimNodeOpacity,
        )
        .attr("r", (n) => {
          const base = resolveNodeRadius(n);
          return n.id === d.id ? base * hoverRadiusScale : base;
        });

      // Dim/highlight links
      link
        .attr("opacity", (l) => {
          const srcId = resolveEndpointId(l.source as string | number | N);
          const tgtId = resolveEndpointId(l.target as string | number | N);
          return srcId === d.id || tgtId === d.id
            ? highlightLinkOpacity
            : dimLinkOpacity;
        })
        .attr("stroke", (l) => {
          const srcId = resolveEndpointId(l.source as string | number | N);
          const tgtId = resolveEndpointId(l.target as string | number | N);
          return srcId === d.id || tgtId === d.id
            ? resolveHighlightLinkStroke(d)
            : config.linkStroke;
        });

      if (config.highlightLinkStrokeWidth) {
        link.attr("stroke-width", (l) => {
          const srcId = resolveEndpointId(l.source as string | number | N);
          const tgtId = resolveEndpointId(l.target as string | number | N);
          return srcId === d.id || tgtId === d.id
            ? config.highlightLinkStrokeWidth!(l)
            : config.linkStrokeWidth(l);
        });
      }

      // Dim/highlight labels
      labels.attr("opacity", (n) =>
        n.id === d.id || connectedIds.has(n.id)
          ? highlightLabelOpacity
          : dimLabelOpacity,
      );

      // Tooltip
      if (tooltipRef.current) {
        tooltipRef.current.innerHTML = config.tooltipContent(d, connectedIds);
        tooltipRef.current.style.opacity = "1";
        tooltipRef.current.style.left = `${(event as MouseEvent).pageX + 12}px`;
        tooltipRef.current.style.top = `${(event as MouseEvent).pageY + 12}px`;
      }
    });

    // ── Hover: mouseout ───────────────────────────────────────────────────────
    node.on("mouseout", function () {
      node
        .attr("opacity", 1)
        .attr("r", resolveNodeRadius);

      link
        .attr("opacity", linkStrokeOpacity)
        .attr("stroke", config.linkStroke)
        .attr("stroke-width", config.linkStrokeWidth);

      labels.attr("opacity", labelInitialOpacity);

      if (tooltipRef.current) {
        tooltipRef.current.style.opacity = "0";
      }
    });

    // ── Resize ────────────────────────────────────────────────────────────────
    const handleResize = () => {
      const newWidth = container.clientWidth;
      const newHeight = container.clientHeight;
      config.onResize(simulation, newWidth, newHeight);
    };

    window.addEventListener("resize", handleResize);

    // ── Cleanup ───────────────────────────────────────────────────────────────
    return () => {
      simulation.stop();
      window.removeEventListener("resize", handleResize);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);
}
