import React from "react";
import { getGroupColor } from "./utils";
import type { MepInfo, EpPeriod } from "./types";

interface ActiveFiltersProps {
  selectedMep: MepInfo | null;
  selectedCommittee: string;
  selectedProcedure: string;
  selectedOrganization: string;
  epPeriod: EpPeriod;

  onClearMep: () => void;
  onClearCommittee: () => void;
  onClearProcedure: () => void;
  onClearOrganization: () => void;
  onClearEpPeriod: () => void;
  onClearAll: () => void;
}

const PILL_BUTTON_STYLE: React.CSSProperties = {
  background: "none",
  border: "none",
  color: "white",
  cursor: "pointer",
  padding: "0 0.25rem",
};

function FilterPill({
  label,
  color,
  onClear,
  maxWidth,
  truncate,
}: {
  label: string;
  color: string;
  onClear: () => void;
  maxWidth?: string;
  truncate?: boolean;
}): React.ReactNode {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.25rem",
        padding: "0.25rem 0.5rem",
        background: color,
        color: "white",
        borderRadius: "9999px",
        fontSize: "0.75rem",
        fontWeight: 500,
        maxWidth,
      }}
    >
      {truncate ? (
        <span
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {label}
        </span>
      ) : (
        label
      )}
      <button
        onClick={onClear}
        style={{
          ...PILL_BUTTON_STYLE,
          flexShrink: truncate ? 0 : undefined,
        }}
      >
        x
      </button>
    </span>
  );
}

export default function ActiveFilters({
  selectedMep,
  selectedCommittee,
  selectedProcedure,
  selectedOrganization,
  epPeriod,
  onClearMep,
  onClearCommittee,
  onClearProcedure,
  onClearOrganization,
  onClearEpPeriod,
  onClearAll,
}: ActiveFiltersProps): React.ReactNode {
  const hasFilters =
    selectedMep ||
    selectedCommittee ||
    selectedProcedure ||
    selectedOrganization ||
    epPeriod !== "both";

  if (!hasFilters) return null;

  return (
    <div
      style={{
        marginBottom: "1.5rem",
        display: "flex",
        flexWrap: "wrap",
        gap: "0.5rem",
        alignItems: "center",
      }}
    >
      <span
        style={{
          fontSize: "0.75rem",
          color: "#64748b",
          textTransform: "uppercase",
          fontWeight: 600,
        }}
      >
        Active filters:
      </span>
      {epPeriod !== "both" && (
        <FilterPill
          label={epPeriod === "ep9" ? "EP9 (2019-2024)" : "EP10 (2024-)"}
          color="#8b5cf6"
          onClear={onClearEpPeriod}
        />
      )}
      {selectedMep && (
        <FilterPill
          label={selectedMep.name}
          color={getGroupColor(selectedMep.political_group)}
          onClear={onClearMep}
        />
      )}
      {selectedCommittee && (
        <FilterPill
          label={selectedCommittee}
          color="#3b82f6"
          onClear={onClearCommittee}
        />
      )}
      {selectedProcedure && (
        <FilterPill
          label={selectedProcedure}
          color="#10b981"
          onClear={onClearProcedure}
        />
      )}
      {selectedOrganization && (
        <FilterPill
          label={selectedOrganization}
          color="#f59e0b"
          onClear={onClearOrganization}
          maxWidth="200px"
          truncate
        />
      )}
      <button
        onClick={onClearAll}
        style={{
          fontSize: "0.75rem",
          color: "#64748b",
          background: "none",
          border: "none",
          cursor: "pointer",
          textDecoration: "underline",
        }}
      >
        Clear all
      </button>
    </div>
  );
}
