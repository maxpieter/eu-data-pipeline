"use client";

import { useEffect, useRef } from "react";
import * as d3 from "d3";
import {
  getAttendeeColor,
  classifyEventStage,
  LEGISLATIVE_STAGES,
} from "./utils";
import type {
  MepInfo,
  OeilEvent,
  ProcedureEventsData,
  TimelineData,
  TimelineEntry,
} from "./types";

interface TimelineChartProps {
  timelineData: TimelineData;
  selectedMep: MepInfo | null;
  mepSearch: string;
  procedureEvents: ProcedureEventsData | null;
  showKeyEvents: boolean;
  setShowKeyEvents: (value: boolean) => void;
  showDocGateway: boolean;
  setShowDocGateway: (value: boolean) => void;
  eventsLoading: boolean;
  hasProgressBar: boolean;
  analyzeDocument: (documentUrl: string, documentRef: string) => void;
}

export default function TimelineChart({
  timelineData,
  selectedMep,
  mepSearch,
  procedureEvents,
  showKeyEvents,
  setShowKeyEvents,
  showDocGateway,
  setShowDocGateway,
  eventsLoading,
  hasProgressBar,
  analyzeDocument,
}: TimelineChartProps): React.ReactNode {
  const timelineRef = useRef<SVGSVGElement>(null);

  const svgHeight = hasProgressBar ? "460px" : "400px";

  useEffect(() => {
    if (!timelineRef.current || !timelineData?.timeline?.length) {
      if (timelineRef.current)
        d3.select(timelineRef.current).selectAll("*").remove();
      return;
    }

    const svg = d3.select(timelineRef.current);
    const container = timelineRef.current.parentElement!;
    const width = container.clientWidth;
    const height = hasProgressBar ? 460 : 400;
    const margin = {
      top: 20,
      right: 30,
      bottom: hasProgressBar ? 120 : 60,
      left: 50,
    };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    svg.attr("width", width).attr("height", height).selectAll("*").remove();
    const g = svg
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);
    const data = timelineData.timeline;

    const getTimeKey = (d: TimelineEntry) => d.week || d.month || "";

    const dateToWeekKey = (isoDate: string): string | null => {
      const dt = new Date(isoDate + "T00:00:00");
      if (isNaN(dt.getTime())) return null;
      const day = dt.getDay();
      const diff = dt.getDate() - day + (day === 0 ? -6 : 1);
      const monday = new Date(dt);
      monday.setDate(diff);
      const dd = String(monday.getDate()).padStart(2, "0");
      const mm = String(monday.getMonth() + 1).padStart(2, "0");
      const yyyy = monday.getFullYear();
      return `${dd}-${mm}-${yyyy}`;
    };

    // Build x-axis domain: merge meeting weeks with event/document weeks
    const meetingKeys = data.map(getTimeKey);
    const meetingKeySet = new Set(meetingKeys);

    const eventOnlyKeys: string[] = [];
    if (procedureEvents) {
      const allEvts = [
        ...procedureEvents.key_events,
        ...procedureEvents.documentation_gateway,
      ];
      allEvts.forEach((evt) => {
        const wk = dateToWeekKey(evt.date);
        if (wk && !meetingKeySet.has(wk)) {
          meetingKeySet.add(wk);
          eventOnlyKeys.push(wk);
        }
      });
    }

    const parseWeekKey = (k: string): Date => {
      const [dd, mm, yyyy] = k.split("-");
      return new Date(Number(yyyy), Number(mm) - 1, Number(dd));
    };

    const allDomainKeys = [...meetingKeys, ...eventOnlyKeys].sort(
      (a, b) => parseWeekKey(a).getTime() - parseWeekKey(b).getTime(),
    );

    const x = d3
      .scaleBand()
      .domain(allDomainKeys)
      .range([0, innerWidth])
      .padding(0.1);
    const y = d3
      .scaleLinear()
      .domain([0, d3.max(data, (d) => d.count) || 1])
      .nice()
      .range([innerHeight, 0]);
    const barColor = "#3b82f6";

    // Axes
    const tickInterval = Math.max(1, Math.ceil(data.length / 20));
    g.append("g")
      .attr("transform", `translate(0,${innerHeight})`)
      .call(
        d3
          .axisBottom(x)
          .tickValues(
            data.filter((_, i) => i % tickInterval === 0).map(getTimeKey),
          ),
      )
      .selectAll("text")
      .attr("transform", "rotate(-45)")
      .style("text-anchor", "end")
      .style("font-size", "11px")
      .style("fill", "#64748b");

    g.append("g")
      .call(d3.axisLeft(y).ticks(5))
      .selectAll("text")
      .style("font-size", "11px")
      .style("fill", "#64748b");
    g.append("text")
      .attr("transform", "rotate(-90)")
      .attr("y", -40)
      .attr("x", -innerHeight / 2)
      .attr("text-anchor", "middle")
      .style("font-size", "12px")
      .style("fill", "#475569")
      .text("Number of Meetings");

    // Render stacked bars
    data.forEach((periodData) => {
      const meetings = periodData.meetings || [];
      const barX = x(getTimeKey(periodData))!;
      const barWidth = x.bandwidth();
      const sortedMeetings = [...meetings].sort(
        (a, b) => b.attendee_count - a.attendee_count,
      );
      const totalHeight = innerHeight - y(periodData.count);
      const segmentHeight =
        meetings.length > 0 ? totalHeight / meetings.length : totalHeight;

      sortedMeetings.forEach((meeting, i) => {
        const segmentY = y(periodData.count) + i * segmentHeight;
        g.append("rect")
          .attr("class", "meeting-segment")
          .attr("x", barX)
          .attr("y", segmentY)
          .attr("width", barWidth)
          .attr("height", Math.max(segmentHeight - 1, 1))
          .attr("fill", getAttendeeColor(meeting.attendee_count))
          .attr("rx", 1)
          .style("cursor", "pointer")
          .on("mouseover", function (event) {
            d3.select(this).attr("stroke", "#1e293b").attr("stroke-width", 2);
            const tooltip = svg.append("g").attr("class", "tooltip");
            const tx = barX + barWidth / 2 + margin.left;
            const ty = Math.max(segmentY + margin.top - 10, 40);
            const title =
              meeting.title.length > 40
                ? meeting.title.slice(0, 37) + "..."
                : meeting.title;
            const tooltipWidth = Math.max(title.length * 6 + 20, 150);
            tooltip
              .append("rect")
              .attr("x", tx - tooltipWidth / 2)
              .attr("y", ty - 50)
              .attr("width", tooltipWidth)
              .attr("height", 45)
              .attr("fill", "white")
              .attr("stroke", "#e2e8f0")
              .attr("rx", 4)
              .style("filter", "drop-shadow(0 2px 4px rgba(0,0,0,0.1))");
            tooltip
              .append("text")
              .attr("x", tx)
              .attr("y", ty - 35)
              .attr("text-anchor", "middle")
              .style("font-size", "11px")
              .style("fill", "#1e293b")
              .text(title);
            tooltip
              .append("text")
              .attr("x", tx)
              .attr("y", ty - 18)
              .attr("text-anchor", "middle")
              .style("font-size", "10px")
              .style("fill", "#64748b")
              .text(
                `${meeting.date} · ${meeting.attendee_count} attendee${meeting.attendee_count !== 1 ? "s" : ""}`,
              );
          })
          .on("mouseout", function () {
            d3.select(this).attr("stroke", "none");
            svg.selectAll(".tooltip").remove();
          });
      });

      if (meetings.length === 0) {
        g.append("rect")
          .attr("x", barX)
          .attr("y", y(periodData.count))
          .attr("width", barWidth)
          .attr("height", totalHeight)
          .attr("fill", barColor)
          .attr("rx", 2);
      }
    });

    // === OEIL Procedure Events Overlay ===
    if (procedureEvents) {
      const eventX = (
        evt: OeilEvent,
      ): { weekKey: string; xPos: number } | null => {
        const wk = dateToWeekKey(evt.date);
        if (!wk) return null;
        const barXPos = x(wk);
        if (barXPos === undefined) return null;
        const dt = new Date(evt.date + "T00:00:00");
        const dayOfWeek = dt.getDay();
        const dayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
        const xPos = barXPos + (dayOffset / 6) * x.bandwidth();
        return { weekKey: wk, xPos };
      };

      const allEvents = [
        ...(showKeyEvents ? procedureEvents.key_events : []),
        ...(showDocGateway ? procedureEvents.documentation_gateway : []),
      ];

      const getEvtAnalysis = (evt: OeilEvent) => {
        const hasPdfLink =
          !!evt.link &&
          (evt.link.endsWith(".pdf") ||
            evt.link.includes("/doceo/document/") ||
            evt.link.includes("LexUriServ") ||
            evt.link.includes("RegData"));
        const isAmendmentDoc =
          !!evt.link && evt.link.toUpperCase().includes("-AM-");
        const hasMepName = !!selectedMep || mepSearch.trim().length > 0;
        // Only amendments are analyzable for now
        const isAnalyzable = hasPdfLink && isAmendmentDoc && hasMepName;
        return { isAnalyzable, isAmendmentDoc };
      };

      const triggerAnalysis = (evt: OeilEvent) => {
        let pdfUrl = evt.link!;
        if (pdfUrl.includes("/doceo/document/") && pdfUrl.endsWith(".html")) {
          pdfUrl = pdfUrl.replace(/\.html$/, ".pdf");
        }
        analyzeDocument(pdfUrl, evt.reference || "");
      };

      const eventPositions: { evt: OeilEvent; xPos: number }[] = [];
      allEvents.forEach((evt) => {
        const pos = eventX(evt);
        if (pos) eventPositions.push({ evt, xPos: pos.xPos });
      });

      const eventsGroup = g.append("g").attr("class", "oeil-events");

      // Group by xPos for vertical lines
      const byXPos: Record<number, OeilEvent[]> = {};
      eventPositions.forEach(({ evt, xPos }) => {
        const key = Math.round(xPos);
        if (!byXPos[key]) byXPos[key] = [];
        byXPos[key].push(evt);
      });

      // Draw vertical dashed lines through the chart
      Object.entries(byXPos).forEach(([xKey, events]) => {
        const posX = Number(xKey);
        const lineColor = events.some((e) => e.category === "key_event")
          ? "#fca5a5"
          : "#fcd34d";
        eventsGroup
          .append("line")
          .attr("x1", posX)
          .attr("x2", posX)
          .attr("y1", 0)
          .attr("y2", innerHeight)
          .attr("stroke", lineColor)
          .attr("stroke-width", 1.5)
          .attr("stroke-dasharray", "4,3")
          .attr("opacity", 0.7);
      });

      // When NO progress bar, draw stacked dots above the chart
      if (!hasProgressBar) {
        Object.entries(byXPos).forEach(([xKey, events]) => {
          const posX = Number(xKey);
          events.forEach((evt, i) => {
            const dotColor =
              evt.category === "key_event" ? "#dc2626" : "#f59e0b";
            const dotY = -8 - i * 10;
            const { isAnalyzable, isAmendmentDoc } = getEvtAnalysis(evt);
            const dot = eventsGroup
              .append("circle")
              .attr("cx", posX)
              .attr("cy", dotY)
              .attr("r", isAnalyzable ? 5 : 4)
              .attr("fill", dotColor)
              .attr("stroke", isAnalyzable ? "#1e293b" : "white")
              .attr("stroke-width", isAnalyzable ? 2 : 1)
              .style("cursor", "pointer")
              .on("mouseover", function () {
                d3.select(this).attr("r", 7);
                const tooltip = svg.append("g").attr("class", "tooltip");
                const tx = posX + margin.left;
                const ty = dotY + margin.top - 10;
                const label =
                  evt.category === "key_event"
                    ? evt.event || "Key Event"
                    : evt.doc_type || "Document";
                const displayLabel =
                  label.length > 50 ? label.slice(0, 47) + "..." : label;
                const tooltipWidth = Math.max(
                  displayLabel.length * 6.5 + 24,
                  180,
                );
                const tooltipX = Math.max(
                  tooltipWidth / 2,
                  Math.min(tx, width - tooltipWidth / 2),
                );
                tooltip
                  .append("rect")
                  .attr("x", tooltipX - tooltipWidth / 2)
                  .attr("y", ty - 58)
                  .attr("width", tooltipWidth)
                  .attr("height", 52)
                  .attr("fill", "white")
                  .attr("stroke", "#e2e8f0")
                  .attr("rx", 4)
                  .style(
                    "filter",
                    "drop-shadow(0 2px 4px rgba(0,0,0,0.1))",
                  );
                tooltip
                  .append("text")
                  .attr("x", tooltipX)
                  .attr("y", ty - 42)
                  .attr("text-anchor", "middle")
                  .style("font-size", "11px")
                  .style("font-weight", "600")
                  .style("fill", dotColor)
                  .text(
                    evt.category === "key_event" ? "Key Event" : "Document",
                  );
                tooltip
                  .append("text")
                  .attr("x", tooltipX)
                  .attr("y", ty - 28)
                  .attr("text-anchor", "middle")
                  .style("font-size", "11px")
                  .style("fill", "#1e293b")
                  .text(displayLabel);
                const detail = `${evt.date}${evt.reference ? " · " + evt.reference : ""}${evt.source ? " · " + evt.source : ""}`;
                tooltip
                  .append("text")
                  .attr("x", tooltipX)
                  .attr("y", ty - 14)
                  .attr("text-anchor", "middle")
                  .style("font-size", "10px")
                  .style("fill", "#64748b")
                  .text(
                    detail.length > 60
                      ? detail.slice(0, 57) + "..."
                      : detail,
                  );
                if (isAnalyzable) {
                  tooltip
                    .append("text")
                    .attr("x", tooltipX)
                    .attr("y", ty + 2)
                    .attr("text-anchor", "middle")
                    .style("font-size", "10px")
                    .style("font-weight", "600")
                    .style("fill", "#3b82f6")
                    .text(
                      isAmendmentDoc
                        ? "Click to analyze MEP position"
                        : "Click to analyze document",
                    );
                }
              })
              .on("mouseout", function () {
                d3.select(this).attr("r", isAnalyzable ? 5 : 4);
                svg.selectAll(".tooltip").remove();
              });
            if (isAnalyzable) {
              dot.on("click", function () {
                triggerAnalysis(evt);
              });
            }
          });
        });
      }

      // === Legislative Procedure Progress Bar ===
      if (hasProgressBar) {
        const progressGroup = g
          .append("g")
          .attr("class", "legislative-progress");

        const stageMilestones: Record<
          string,
          { event: OeilEvent; xPos: number }
        > = {};
        procedureEvents.key_events.forEach((evt) => {
          const stage = classifyEventStage(evt.event || "");
          if (!stage) return;
          const pos = eventX(evt);
          if (!pos) return;
          if (!stageMilestones[stage]) {
            stageMilestones[stage] = { event: evt, xPos: pos.xPos };
          }
        });

        const progressY = innerHeight + 55;
        const barHeight = 8;
        const barCy = progressY + barHeight / 2;

        // Gray track
        progressGroup
          .append("rect")
          .attr("x", 0)
          .attr("y", progressY)
          .attr("width", innerWidth)
          .attr("height", barHeight)
          .attr("rx", 4)
          .attr("fill", "#e2e8f0");

        // Colored segments for reached stages
        const reachedStages = LEGISLATIVE_STAGES.filter(
          (s) => stageMilestones[s.id],
        );
        reachedStages.forEach((stage, i) => {
          const milestone = stageMilestones[stage.id];
          const segStart = milestone.xPos;
          const nextReached = reachedStages[i + 1];
          const segEnd = nextReached
            ? stageMilestones[nextReached.id].xPos
            : innerWidth;
          progressGroup
            .append("rect")
            .attr("x", segStart)
            .attr("y", progressY)
            .attr("width", Math.max(segEnd - segStart, 0))
            .attr("height", barHeight)
            .attr("fill", stage.color)
            .attr("opacity", 0.85);
        });

        // Vertical dashed lines for stage milestones
        LEGISLATIVE_STAGES.forEach((stage) => {
          const milestone = stageMilestones[stage.id];
          if (!milestone) return;
          progressGroup
            .append("line")
            .attr("x1", milestone.xPos)
            .attr("x2", milestone.xPos)
            .attr("y1", progressY)
            .attr("y2", 0)
            .attr("stroke", stage.color)
            .attr("stroke-width", 1.5)
            .attr("stroke-dasharray", "4,4")
            .attr("opacity", 0.4);
        });

        // Stage labels below the bar
        const labelY = progressY + barHeight + 22;
        LEGISLATIVE_STAGES.forEach((stage) => {
          const milestone = stageMilestones[stage.id];
          if (!milestone) return;
          const labelX = milestone.xPos;
          const words = stage.label.split(" ");
          if (words.length > 1 && stage.label.length > 10) {
            progressGroup
              .append("text")
              .attr("x", labelX)
              .attr("y", labelY)
              .attr("text-anchor", "middle")
              .style("font-size", "10px")
              .style("font-weight", "700")
              .style("fill", stage.color)
              .text(words.slice(0, Math.ceil(words.length / 2)).join(" "));
            progressGroup
              .append("text")
              .attr("x", labelX)
              .attr("y", labelY + 12)
              .attr("text-anchor", "middle")
              .style("font-size", "10px")
              .style("font-weight", "700")
              .style("fill", stage.color)
              .text(words.slice(Math.ceil(words.length / 2)).join(" "));
          } else {
            progressGroup
              .append("text")
              .attr("x", labelX)
              .attr("y", labelY)
              .attr("text-anchor", "middle")
              .style("font-size", "10px")
              .style("font-weight", "700")
              .style("fill", stage.color)
              .text(stage.label);
          }
        });

        // === Unified event dots on the progress bar ===
        const milestoneEvtKey = (evt: OeilEvent) =>
          `${evt.date}|${(evt.event || "").toLowerCase()}`;
        const milestoneEvtKeys = new Set<string>();
        Object.values(stageMilestones).forEach((m) =>
          milestoneEvtKeys.add(milestoneEvtKey(m.event)),
        );

        const barDots: {
          evt: OeilEvent;
          xPos: number;
          color: string;
          stageId: string | null;
        }[] = [];

        allEvents.forEach((evt) => {
          const pos = eventX(evt);
          if (!pos) return;
          const stageId = classifyEventStage(evt.event || "");
          const stageInfo = stageId
            ? LEGISLATIVE_STAGES.find((s) => s.id === stageId)
            : null;
          const color =
            stageInfo && milestoneEvtKeys.has(milestoneEvtKey(evt))
              ? stageInfo.color
              : evt.category === "key_event"
                ? "#dc2626"
                : "#f59e0b";
          barDots.push({ evt, xPos: pos.xPos, color, stageId });
        });

        barDots.sort((a, b) => a.xPos - b.xPos);

        // Cluster nearby dots
        const CLUSTER_THRESHOLD = 15;
        const clusters: {
          dots: typeof barDots;
          centerX: number;
        }[] = [];
        barDots.forEach((dot) => {
          const last = clusters[clusters.length - 1];
          if (
            last &&
            dot.xPos - last.dots[last.dots.length - 1].xPos < CLUSTER_THRESHOLD
          ) {
            last.dots.push(dot);
            last.centerX =
              last.dots.reduce((s, d) => s + d.xPos, 0) / last.dots.length;
          } else {
            clusters.push({ dots: [dot], centerX: dot.xPos });
          }
        });

        const dotsGroup = progressGroup.append("g").attr("class", "bar-dots");

        // Tooltip helper for a single event
        const showDotTooltip = (
          dotInfo: (typeof barDots)[0],
          tx: number,
          ty: number,
          isAnalyzable = false,
        ) => {
          const tooltip = svg.append("g").attr("class", "tooltip");
          const label =
            dotInfo.evt.category === "key_event"
              ? dotInfo.evt.event || "Key Event"
              : dotInfo.evt.doc_type || "Document";
          const displayLabel =
            label.length > 50 ? label.slice(0, 47) + "..." : label;
          const tooltipWidth = Math.max(displayLabel.length * 6.5 + 24, 180);
          const tooltipX = Math.max(
            tooltipWidth / 2,
            Math.min(tx, width - tooltipWidth / 2),
          );
          const tooltipH = isAnalyzable ? 66 : 52;
          const boxTop = ty - tooltipH - 8;

          tooltip
            .append("rect")
            .attr("x", tooltipX - tooltipWidth / 2)
            .attr("y", boxTop)
            .attr("width", tooltipWidth)
            .attr("height", tooltipH)
            .attr("fill", "white")
            .attr("stroke", "#e2e8f0")
            .attr("rx", 4)
            .style("filter", "drop-shadow(0 2px 4px rgba(0,0,0,0.1))");
          tooltip
            .append("text")
            .attr("x", tooltipX)
            .attr("y", boxTop + 16)
            .attr("text-anchor", "middle")
            .style("font-size", "11px")
            .style("font-weight", "600")
            .style("fill", dotInfo.color)
            .text(
              dotInfo.evt.category === "key_event" ? "Key Event" : "Document",
            );
          tooltip
            .append("text")
            .attr("x", tooltipX)
            .attr("y", boxTop + 30)
            .attr("text-anchor", "middle")
            .style("font-size", "11px")
            .style("fill", "#1e293b")
            .text(displayLabel);
          const detail = `${dotInfo.evt.date}${dotInfo.evt.reference ? " · " + dotInfo.evt.reference : ""}`;
          tooltip
            .append("text")
            .attr("x", tooltipX)
            .attr("y", boxTop + 44)
            .attr("text-anchor", "middle")
            .style("font-size", "10px")
            .style("fill", "#64748b")
            .text(
              detail.length > 60 ? detail.slice(0, 57) + "..." : detail,
            );
          if (isAnalyzable) {
            tooltip
              .append("text")
              .attr("x", tooltipX)
              .attr("y", boxTop + 58)
              .attr("text-anchor", "middle")
              .style("font-size", "10px")
              .style("font-weight", "600")
              .style("fill", "#3b82f6")
              .text("Click to analyze MEP position");
          }
        };

        clusters.forEach((cluster) => {
          const cx = cluster.centerX;

          if (cluster.dots.length === 1) {
            const d = cluster.dots[0];
            const { isAnalyzable } = getEvtAnalysis(d.evt);
            const r = d.stageId ? 7 : isAnalyzable ? 5 : 4;
            const singleDot = dotsGroup
              .append("circle")
              .attr("cx", cx)
              .attr("cy", barCy)
              .attr("r", r)
              .attr("fill", d.color)
              .attr("stroke", isAnalyzable ? "#1e293b" : "white")
              .attr("stroke-width", d.stageId ? 2 : isAnalyzable ? 1.5 : 1)
              .style("cursor", isAnalyzable ? "pointer" : "default")
              .on("mouseover", function () {
                d3.select(this).attr("r", r + 2);
                showDotTooltip(d, cx + margin.left, barCy + margin.top - 6, isAnalyzable);
              })
              .on("mouseout", function () {
                d3.select(this).attr("r", r);
                svg.selectAll(".tooltip").remove();
              });
            if (isAnalyzable) {
              singleDot.on("click", function () {
                triggerAnalysis(d.evt);
              });
            }
          } else {
            // Multi-dot cluster
            const hasStageDot = cluster.dots.some((d) => d.stageId);
            const hasKeyEvt = cluster.dots.some(
              (d) => !d.stageId && d.evt.category === "key_event",
            );
            const clusterColor = hasStageDot
              ? cluster.dots.find((d) => d.stageId)!.color
              : hasKeyEvt
                ? "#dc2626"
                : "#f59e0b";
            const clusterR = 9;

            const clusterDot = dotsGroup
              .append("circle")
              .attr("cx", cx)
              .attr("cy", barCy)
              .attr("r", clusterR)
              .attr("fill", clusterColor)
              .attr("stroke", "white")
              .attr("stroke-width", 2)
              .style("cursor", "pointer");

            dotsGroup
              .append("text")
              .attr("x", cx)
              .attr("y", barCy + 3.5)
              .attr("text-anchor", "middle")
              .style("font-size", "9px")
              .style("font-weight", "700")
              .style("fill", "white")
              .style("pointer-events", "none")
              .text(cluster.dots.length);

            let expandGroup: d3.Selection<
              SVGGElement,
              unknown,
              null,
              undefined
            > | null = null;

            const showExpand = () => {
              if (expandGroup) return;
              clusterDot.attr("r", clusterR + 2);
              expandGroup = svg
                .append("g")
                .attr("class", "cluster-expand");

              const dotScreenX = cx + margin.left;
              const barScreenY = barCy + margin.top;

              const dotSpacing = 16;
              const expandH = cluster.dots.length * dotSpacing + 10;
              const panelWidth = 28;
              const panelPadY = 6;
              const panelTop = barScreenY - expandH - panelPadY;
              const panelLeft = dotScreenX - panelWidth / 2;

              // White panel stops just above the cluster dot so it doesn't cover it
              const panelBottom = barScreenY - clusterR;

              // Transparent hit area extends through cluster dot for mouse interaction
              expandGroup
                .append("rect")
                .attr("x", panelLeft - 10)
                .attr("y", panelTop - 4)
                .attr("width", panelWidth + 20)
                .attr("height", barScreenY + clusterR + 8 - panelTop)
                .attr("fill", "transparent");
              expandGroup
                .append("rect")
                .attr("x", panelLeft)
                .attr("y", panelTop)
                .attr("width", panelWidth)
                .attr("height", panelBottom - panelTop)
                .attr("fill", "white")
                .attr("stroke", "#e2e8f0")
                .attr("rx", 8)
                .style("filter", "drop-shadow(0 4px 12px rgba(0,0,0,0.12))");

              cluster.dots.forEach((d, i) => {
                const ey = barScreenY - 18 - i * dotSpacing;
                const { isAnalyzable: expandAnalyzable } = getEvtAnalysis(d.evt);

                expandGroup!
                  .append("line")
                  .attr("x1", dotScreenX)
                  .attr("x2", dotScreenX)
                  .attr("y1", barScreenY - clusterR)
                  .attr("y2", ey + 5)
                  .attr("stroke", "#cbd5e1")
                  .attr("stroke-width", 1)
                  .attr("stroke-dasharray", "2,2");

                const eDotR = d.stageId ? 6 : 4.5;
                const eDot = expandGroup!
                  .append("circle")
                  .attr("cx", dotScreenX)
                  .attr("cy", ey)
                  .attr("r", eDotR)
                  .attr("fill", d.color)
                  .attr("stroke", expandAnalyzable ? "#1e40af" : "white")
                  .attr("stroke-width", expandAnalyzable ? 2 : 1.5)
                  .style("cursor", expandAnalyzable ? "pointer" : "default");

                eDot
                  .on("mouseover", function () {
                    d3.select(this).attr("r", eDotR + 2);
                    showDotTooltip(d, dotScreenX, ey - 4, expandAnalyzable);
                  })
                  .on("mouseout", function () {
                    d3.select(this).attr("r", eDotR);
                    svg.selectAll(".tooltip").remove();
                  });
                if (expandAnalyzable) {
                  eDot.on("click", function () {
                    triggerAnalysis(d.evt);
                  });
                }
              });

              expandGroup.on("mouseleave", hideExpand);
            };

            const hideExpand = () => {
              if (expandGroup) {
                expandGroup.remove();
                expandGroup = null;
              }
              clusterDot.attr("r", clusterR);
              svg.selectAll(".tooltip").remove();
            };

            clusterDot
              .on("mouseenter", showExpand)
              .on("mouseleave", function (event: MouseEvent) {
                const related = event.relatedTarget as Element;
                const expandEl = svg.select(".cluster-expand").node();
                if (
                  expandEl &&
                  (expandEl === related ||
                    (expandEl as Element).contains(related))
                )
                  return;
                hideExpand();
              });
          }
        });
      }
    }
  }, [
    timelineData,
    selectedMep,
    procedureEvents,
    showKeyEvents,
    showDocGateway,
    hasProgressBar,
    mepSearch,
    analyzeDocument,
  ]);

  return (
    <div
      style={{
        background: "white",
        borderRadius: "12px",
        border: "1px solid #e2e8f0",
        padding: "1rem",
        boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "1rem",
          flexWrap: "wrap",
          gap: "0.5rem",
        }}
      >
        <h3
          style={{
            fontSize: "0.875rem",
            fontWeight: 600,
            color: "#1e293b",
            position: "relative",
            zIndex: 1,
            margin: 0,
          }}
        >
          Meetings per Week
        </h3>
        <div
          style={{
            display: "flex",
            gap: "1rem",
            alignItems: "center",
            fontSize: "0.75rem",
          }}
        >
          {procedureEvents && (
            <>
              {eventsLoading && (
                <span style={{ color: "#94a3b8" }}>Loading events...</span>
              )}
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.25rem",
                  cursor: "pointer",
                  color: "#475569",
                }}
              >
                <input
                  type="checkbox"
                  checked={showKeyEvents}
                  onChange={(e) => setShowKeyEvents(e.target.checked)}
                  style={{ accentColor: "#dc2626" }}
                />
                Key Events ({procedureEvents.key_events.length})
              </label>
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.25rem",
                  cursor: "pointer",
                  color: "#475569",
                }}
              >
                <input
                  type="checkbox"
                  checked={showDocGateway}
                  onChange={(e) => setShowDocGateway(e.target.checked)}
                  style={{ accentColor: "#f59e0b" }}
                />
                Documents ({procedureEvents.documentation_gateway.length})
              </label>
            </>
          )}
          {/* Attendees color scale */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.25rem",
            }}
          >
            <span style={{ color: "#64748b" }}>Attendees:</span>
            {[
              { color: "#93c5fd" },
              { color: "#60a5fa" },
              { color: "#3b82f6" },
              { color: "#2563eb" },
              { color: "#1d4ed8" },
              { color: "#1e40af" },
            ].map((item, i) => (
              <span
                key={i}
                style={{
                  width: "16px",
                  height: "10px",
                  background: item.color,
                  borderRadius: "2px",
                  display: "inline-block",
                }}
              />
            ))}
          </div>
        </div>
      </div>
      <div
        style={{
          width: "100%",
          minHeight: svgHeight,
          position: "relative",
          zIndex: 10,
        }}
      >
        <svg
          ref={timelineRef}
          style={{ width: "100%", height: svgHeight, overflow: "visible" }}
        />
      </div>
    </div>
  );
}
