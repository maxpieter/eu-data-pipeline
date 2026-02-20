import React from "react";
import { getGroupColor, getGroupShortName } from "./utils";
import type { MepInfo, TimelineData, ProcedureEventsData } from "./types";

interface ResultsInfoCardProps {
  timelineData: TimelineData;
  selectedMep: MepInfo | null;
  selectedProcedure: string;
  selectedCommittee: string;
  procedureEvents: ProcedureEventsData | null;
}

export default function ResultsInfoCard({
  timelineData,
  selectedMep,
  selectedProcedure,
  selectedCommittee,
  procedureEvents,
}: ResultsInfoCardProps): React.ReactNode {
  return (
    <div
      style={{
        background: "white",
        borderRadius: "12px",
        border: "1px solid #e2e8f0",
        padding: "1rem",
        marginBottom: "1.5rem",
        display: "flex",
        alignItems: "center",
        gap: "1rem",
        flexWrap: "wrap",
      }}
    >
      {selectedMep ? (
        <>
          <div
            style={{
              width: "48px",
              height: "48px",
              borderRadius: "50%",
              background: getGroupColor(selectedMep.political_group),
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "white",
              fontWeight: 700,
            }}
          >
            {selectedMep.name
              .split(" ")
              .map((n) => n[0])
              .join("")
              .slice(0, 2)}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, color: "#1e293b" }}>
              {selectedMep.name}
            </div>
            <div style={{ fontSize: "0.875rem", color: "#64748b" }}>
              {getGroupShortName(selectedMep.political_group)} ·{" "}
              {selectedMep.country}
            </div>
          </div>
        </>
      ) : (
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, color: "#1e293b" }}>
            {selectedProcedure
              ? procedureEvents?.title || selectedProcedure
              : selectedCommittee || "All Meetings"}
          </div>
          <div style={{ fontSize: "0.875rem", color: "#64748b" }}>
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
      <div style={{ textAlign: "center", padding: "0 1rem" }}>
        <div
          style={{
            fontSize: "1.5rem",
            fontWeight: 700,
            color: selectedMep
              ? getGroupColor(selectedMep.political_group)
              : "#3b82f6",
          }}
        >
          {timelineData.total_meetings}
        </div>
        <div
          style={{
            fontSize: "0.75rem",
            color: "#64748b",
            textTransform: "uppercase",
          }}
        >
          Meetings
        </div>
      </div>
      {timelineData.meps_involved && (
        <div style={{ textAlign: "center", padding: "0 1rem" }}>
          <div
            style={{
              fontSize: "1.5rem",
              fontWeight: 700,
              color: "#10b981",
            }}
          >
            {timelineData.meps_involved}
          </div>
          <div
            style={{
              fontSize: "0.75rem",
              color: "#64748b",
              textTransform: "uppercase",
            }}
          >
            MEPs
          </div>
        </div>
      )}
    </div>
  );
}
