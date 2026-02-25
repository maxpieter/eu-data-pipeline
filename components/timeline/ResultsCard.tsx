"use client";

import React from "react";
import { getGroupColor, getGroupShortName } from "@/lib/timelineUtils";
import type { MepInfo, TimelineData, ProcedureEventsData } from "@/hooks/useTimelineData";

interface ResultsCardProps {
  timelineData: TimelineData;
  selectedMep: MepInfo | null;
  selectedProcedure: string;
  selectedCommittee: string;
  procedureEvents: ProcedureEventsData | null;
}

/**
 * Summary card displayed above the timeline chart.
 *
 * When an MEP is selected it shows their avatar (initials), name, party, and
 * country.  Otherwise it shows the active procedure or committee name.
 * Meeting count and unique MEP count are always shown on the right side.
 */
export default function ResultsCard({
  timelineData,
  selectedMep,
  selectedProcedure,
  selectedCommittee,
  procedureEvents,
}: ResultsCardProps) {
  return (
    <div className="bg-white rounded-xl border border-[#e2e8f0] p-4 mb-6 flex items-center gap-4 flex-wrap">
      {selectedMep ? (
        <>
          {/* MEP avatar */}
          <div
            className="w-12 h-12 rounded-full flex items-center justify-center text-white font-bold"
            style={{ background: getGroupColor(selectedMep.political_group) }}
          >
            {selectedMep.name
              .split(" ")
              .map((n) => n[0])
              .join("")
              .slice(0, 2)}
          </div>

          {/* MEP name / party */}
          <div className="flex-1">
            <div className="font-bold text-[#1e293b]">
              {selectedMep.name}
            </div>
            <div className="text-sm text-[#64748b]">
              {getGroupShortName(selectedMep.political_group)} ·{" "}
              {selectedMep.country}
            </div>
          </div>
        </>
      ) : (
        <div className="flex-1">
          <div className="font-bold text-[#1e293b]">
            {selectedProcedure
              ? procedureEvents?.title || selectedProcedure
              : selectedCommittee || "All Meetings"}
          </div>
          <div className="text-sm text-[#64748b]">
            {selectedProcedure
              ? procedureEvents?.title
                ? selectedProcedure
                : "Procedure"
              : selectedCommittee
                ? "Committee"
                : ""}
          </div>
        </div>
      )}

      {/* Meeting count */}
      <div className="text-center px-4">
        <div
          className="text-2xl font-bold"
          style={{
            color: selectedMep
              ? getGroupColor(selectedMep.political_group)
              : "#3b82f6",
          }}
        >
          {timelineData.total_meetings}
        </div>
        <div className="text-xs text-[#64748b] uppercase">
          Meetings
        </div>
      </div>

      {/* MEP count (only when the backend returns it) */}
      {timelineData.meps_involved && (
        <div className="text-center px-4">
          <div className="text-2xl font-bold text-[#10b981]">
            {timelineData.meps_involved}
          </div>
          <div className="text-xs text-[#64748b] uppercase">
            MEPs
          </div>
        </div>
      )}
    </div>
  );
}
