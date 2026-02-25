"use client";

import React from "react";
import { getGroupColor } from "@/lib/timelineUtils";
import type { MepInfo, EpPeriod } from "@/hooks/useTimelineData";

interface ActiveFiltersProps {
  selectedMep: MepInfo | null;
  setSelectedMep: (mep: MepInfo | null) => void;
  setMepSearch: (v: string) => void;
  /** Clears selectedMep, resets mepSearch, and restores global procedures. */
  clearMep: () => Promise<void>;

  selectedCommittee: string;
  setSelectedCommittee: (v: string) => void;
  setCommitteeSearch: (v: string) => void;

  selectedProcedure: string;
  setSelectedProcedure: (v: string) => void;
  setProcedureSearch: (v: string) => void;

  selectedOrganization: string;
  setSelectedOrganization: (v: string) => void;
  setOrganizationSearch: (v: string) => void;

  epPeriod: EpPeriod;
  setEpPeriod: (v: EpPeriod) => void;

  clearAll: () => Promise<void>;
}

/**
 * Renders the "Active filters" row of coloured chips with individual remove
 * buttons and a global "Clear all" link.
 *
 * The component only renders when at least one filter is active.
 */
export default function ActiveFilters({
  selectedMep,
  clearMep,

  selectedCommittee,
  setSelectedCommittee,
  setCommitteeSearch,

  selectedProcedure,
  setSelectedProcedure,
  setProcedureSearch,

  selectedOrganization,
  setSelectedOrganization,
  setOrganizationSearch,

  epPeriod,
  setEpPeriod,

  clearAll,
}: ActiveFiltersProps) {
  const hasActiveFilter =
    selectedMep ||
    selectedCommittee ||
    selectedProcedure ||
    selectedOrganization ||
    epPeriod !== "both";

  if (!hasActiveFilter) return null;

  return (
    <div className="mb-6 flex flex-wrap gap-2 items-center">
      <span className="text-[0.75rem] text-[#64748b] uppercase font-semibold">
        Active filters:
      </span>

      {epPeriod !== "both" && (
        <span
          className="inline-flex items-center gap-1 py-1 px-2 text-white rounded-full text-[0.75rem] font-medium"
          style={{ background: "#8b5cf6" }}
        >
          {epPeriod === "ep9" ? "EP9 (2019-2024)" : "EP10 (2024-)"}
          <button
            onClick={() => setEpPeriod("both")}
            className="bg-transparent border-none text-white cursor-pointer px-1 py-0"
          >
            ×
          </button>
        </span>
      )}

      {selectedMep && (
        <span
          className="inline-flex items-center gap-1 py-1 px-2 text-white rounded-full text-[0.75rem] font-medium"
          style={{ background: getGroupColor(selectedMep.political_group) }}
        >
          {selectedMep.name}
          <button
            onClick={clearMep}
            className="bg-transparent border-none text-white cursor-pointer px-1 py-0"
          >
            ×
          </button>
        </span>
      )}

      {selectedCommittee && (
        <span
          className="inline-flex items-center gap-1 py-1 px-2 text-white rounded-full text-[0.75rem] font-medium"
          style={{ background: "#3b82f6" }}
        >
          {selectedCommittee}
          <button
            onClick={() => {
              setSelectedCommittee("");
              setCommitteeSearch("");
            }}
            className="bg-transparent border-none text-white cursor-pointer px-1 py-0"
          >
            ×
          </button>
        </span>
      )}

      {selectedProcedure && (
        <span
          className="inline-flex items-center gap-1 py-1 px-2 text-white rounded-full text-[0.75rem] font-medium"
          style={{ background: "#10b981" }}
        >
          {selectedProcedure}
          <button
            onClick={() => {
              setSelectedProcedure("");
              setProcedureSearch("");
            }}
            className="bg-transparent border-none text-white cursor-pointer px-1 py-0"
          >
            ×
          </button>
        </span>
      )}

      {selectedOrganization && (
        <span
          className="inline-flex items-center gap-1 py-1 px-2 text-white rounded-full text-[0.75rem] font-medium max-w-[200px]"
          style={{ background: "#f59e0b" }}
        >
          <span className="overflow-hidden text-ellipsis whitespace-nowrap">
            {selectedOrganization}
          </span>
          <button
            onClick={() => {
              setSelectedOrganization("");
              setOrganizationSearch("");
            }}
            className="bg-transparent border-none text-white cursor-pointer px-1 py-0 shrink-0"
          >
            ×
          </button>
        </span>
      )}

      <button
        onClick={clearAll}
        className="text-[0.75rem] text-[#64748b] bg-transparent border-none cursor-pointer underline"
      >
        Clear all
      </button>
    </div>
  );
}
