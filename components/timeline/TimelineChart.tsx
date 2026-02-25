"use client";

import React, { useEffect, useRef } from "react";
import * as d3 from "d3";
import { getAttendeeColor } from "@/lib/timelineUtils";
import type {
  TimelineData,
  ProcedureEventsData,
  TimelineEntry,
  OeilEvent,
} from "@/hooks/useTimelineData";

interface TimelineChartProps {
  timelineData: TimelineData;
  procedureEvents: ProcedureEventsData | null;
  showKeyEvents: boolean;
  setShowKeyEvents: (v: boolean) => void;
  showDocGateway: boolean;
  setShowDocGateway: (v: boolean) => void;
  eventsLoading: boolean;
}

/**
 * Renders the D3-powered bar chart of meetings per week/month, plus the
 * optional OEIL event overlay (dashed lines + dots).
 *
 * All D3 mutation happens inside a `useEffect` that is re-run whenever the
 * data or overlay-visibility flags change.
 */
export default function TimelineChart({
  timelineData,
  procedureEvents,
  showKeyEvents,
  setShowKeyEvents,
  showDocGateway,
  setShowDocGateway,
  eventsLoading,
}: TimelineChartProps) {
  const timelineRef = useRef<SVGSVGElement>(null);

  // D3 rendering effect
  useEffect(() => {
    if (!timelineRef.current || !timelineData?.timeline?.length) {
      if (timelineRef.current) {
        d3.select(timelineRef.current).selectAll("*").remove();
      }
      return;
    }

    const svg = d3.select(timelineRef.current);
    const container = timelineRef.current.parentElement!;
    const width = container.clientWidth;
    const height = 400;
    const margin = { top: 20, right: 30, bottom: 60, left: 50 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    svg.attr("width", width).attr("height", height).selectAll("*").remove();

    const g = svg
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    const data = timelineData.timeline;

    // Prefer week key, fall back to month
    const getTimeKey = (d: TimelineEntry) => d.week || d.month || "";

    const x = d3
      .scaleBand()
      .domain(data.map(getTimeKey))
      .range([0, innerWidth])
      .padding(0.1);

    const y = d3
      .scaleLinear()
      .domain([0, d3.max(data, (d) => d.count) || 1])
      .nice()
      .range([innerHeight, 0]);

    const barColor = "#3b82f6";

    // X axis — show every Nth tick to avoid crowding
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

    // Y axis
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

    // Render stacked bars — each meeting segment coloured by attendee count
    data.forEach((periodData) => {
      const meetings = periodData.meetings || [];
      const barX = x(getTimeKey(periodData))!;
      const barWidth = x.bandwidth();

      // Sort meetings by attendee count (largest at bottom)
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

      // Fallback: single solid bar when no meetings array is provided
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

    // === OEIL Procedure Events overlay ===
    if (procedureEvents) {
      // Map an ISO date to the "DD-MM-YYYY" week-start (Monday) key
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

      const allWeekKeys = new Set(data.map(getTimeKey));

      // Get the x-pixel position for an event based on its exact weekday
      const eventX = (
        evt: OeilEvent,
      ): { weekKey: string; xPos: number } | null => {
        const wk = dateToWeekKey(evt.date);
        if (!wk || !allWeekKeys.has(wk)) return null;
        const barXPos = x(wk);
        if (barXPos === undefined) return null;
        const dt = new Date(evt.date + "T00:00:00");
        const dayOfWeek = dt.getDay();
        const dayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
        const xPos = barXPos + (dayOffset / 6) * x.bandwidth();
        return { weekKey: wk, xPos };
      };

      const allEvents: OeilEvent[] = [
        ...(showKeyEvents ? procedureEvents.key_events : []),
        ...(showDocGateway ? procedureEvents.documentation_gateway : []),
      ];

      // Collect pixel positions for all events
      const eventPositions: { evt: OeilEvent; xPos: number }[] = [];
      allEvents.forEach((evt) => {
        const pos = eventX(evt);
        if (pos) eventPositions.push({ evt, xPos: pos.xPos });
      });

      const eventsGroup = g.append("g").attr("class", "oeil-events");

      // Group events that land on the same pixel column
      const byXPos: Record<number, OeilEvent[]> = {};
      eventPositions.forEach(({ evt, xPos }) => {
        const key = Math.round(xPos);
        if (!byXPos[key]) byXPos[key] = [];
        byXPos[key].push(evt);
      });

      Object.entries(byXPos).forEach(([xKey, events]) => {
        const posX = Number(xKey);

        // Dashed vertical line
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

        // Stacked dots above the chart
        events.forEach((evt, i) => {
          const dotColor =
            evt.category === "key_event" ? "#dc2626" : "#f59e0b";
          const dotY = -8 - i * 10;

          eventsGroup
            .append("circle")
            .attr("cx", posX)
            .attr("cy", dotY)
            .attr("r", 4)
            .attr("fill", dotColor)
            .attr("stroke", "white")
            .attr("stroke-width", 1)
            .style("cursor", "pointer")
            .on("mouseover", function (event: MouseEvent) {
              d3.select(this).attr("r", 6);

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
                .style("filter", "drop-shadow(0 2px 4px rgba(0,0,0,0.1))");

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
                  detail.length > 60 ? detail.slice(0, 57) + "..." : detail,
                );
            })
            .on("mouseout", function () {
              d3.select(this).attr("r", 4);
              svg.selectAll(".tooltip").remove();
            });
        });
      });
    }
  }, [timelineData, procedureEvents, showKeyEvents, showDocGateway]);

  return (
    <div className="bg-white rounded-xl border border-[#e2e8f0] p-4 shadow-[0_1px_3px_rgba(0,0,0,0.05)]">
      {/* Chart header: title + OEIL toggles + colour scale legend */}
      <div className="flex justify-between items-center mb-4 flex-wrap gap-2">
        <h3 className="text-sm font-semibold text-[#1e293b] relative z-[1] m-0">
          Meetings per Week
        </h3>

        <div className="flex gap-4 items-center text-xs">
          {procedureEvents && (
            <>
              {eventsLoading && (
                <span className="text-[#94a3b8]">Loading events...</span>
              )}
              <label className="flex items-center gap-1 cursor-pointer text-[#475569]">
                <input
                  type="checkbox"
                  checked={showKeyEvents}
                  onChange={(e) => setShowKeyEvents(e.target.checked)}
                  className="accent-red-600"
                />
                Key Events ({procedureEvents.key_events.length})
              </label>
              <label className="flex items-center gap-1 cursor-pointer text-[#475569]">
                <input
                  type="checkbox"
                  checked={showDocGateway}
                  onChange={(e) => setShowDocGateway(e.target.checked)}
                  className="accent-amber-400"
                />
                Documents ({procedureEvents.documentation_gateway.length})
              </label>
            </>
          )}

          {/* Attendee colour scale legend */}
          <div className="flex items-center gap-1">
            <span className="text-[#64748b]">Attendees:</span>
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
                className="inline-block w-4 h-[10px] rounded-[2px]"
                style={{ background: item.color }}
              />
            ))}
          </div>
        </div>
      </div>

      {/* SVG canvas */}
      <div className="w-full min-h-[400px] relative z-10">
        <svg
          ref={timelineRef}
          className="w-full h-[400px] overflow-visible"
        />
      </div>
    </div>
  );
}
