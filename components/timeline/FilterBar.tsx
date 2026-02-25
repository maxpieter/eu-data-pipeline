"use client";

import React from "react";
import AutocompleteDropdown from "./AutocompleteDropdown";
import { getGroupColor, getGroupShortName } from "@/lib/timelineUtils";
import type {
  MepInfo,
  CommitteeInfo,
  ProcedureInfo,
  OrganizationInfo,
  EpPeriod,
} from "@/hooks/useTimelineData";

interface FilterBarProps {
  // MEP field
  mepSearch: string;
  setMepSearch: (v: string) => void;
  selectedMep: MepInfo | null;
  setSelectedMep: (mep: MepInfo | null) => void;
  mepDropdownOpen: boolean;
  setMepDropdownOpen: (v: boolean) => void;
  filteredMeps: MepInfo[];

  // Committee field
  committeeSearch: string;
  setCommitteeSearch: (v: string) => void;
  selectedCommittee: string;
  setSelectedCommittee: (v: string) => void;
  committeeDropdownOpen: boolean;
  setCommitteeDropdownOpen: (v: boolean) => void;
  filteredCommittees: CommitteeInfo[];

  // Procedure field
  procedureSearch: string;
  setProcedureSearch: (v: string) => void;
  selectedProcedure: string;
  setSelectedProcedure: (v: string) => void;
  procedureDropdownOpen: boolean;
  setProcedureDropdownOpen: (v: boolean) => void;
  filteredProcedures: ProcedureInfo[];

  // Organization field
  organizationSearch: string;
  setOrganizationSearch: (v: string) => void;
  selectedOrganization: string;
  setSelectedOrganization: (v: string) => void;
  organizationDropdownOpen: boolean;
  setOrganizationDropdownOpen: (v: boolean) => void;
  filteredOrganizations: OrganizationInfo[];

  // EP period toggle
  epPeriod: EpPeriod;
  setEpPeriod: (v: EpPeriod) => void;
}

/**
 * Renders the four autocomplete search fields (MEP, Committee, Procedure,
 * Organization) and the EP Period toggle buttons.
 */
export default function FilterBar({
  mepSearch,
  setMepSearch,
  selectedMep,
  setSelectedMep,
  mepDropdownOpen,
  setMepDropdownOpen,
  filteredMeps,

  committeeSearch,
  setCommitteeSearch,
  selectedCommittee,
  setSelectedCommittee,
  committeeDropdownOpen,
  setCommitteeDropdownOpen,
  filteredCommittees,

  procedureSearch,
  setProcedureSearch,
  selectedProcedure,
  setSelectedProcedure,
  procedureDropdownOpen,
  setProcedureDropdownOpen,
  filteredProcedures,

  organizationSearch,
  setOrganizationSearch,
  selectedOrganization,
  setSelectedOrganization,
  organizationDropdownOpen,
  setOrganizationDropdownOpen,
  filteredOrganizations,

  epPeriod,
  setEpPeriod,
}: FilterBarProps) {
  return (
    <>
      {/* Four search fields */}
      <div
        className="grid gap-4 mb-6"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))" }}
      >
        {/* MEP Search */}
        <div className="relative">
          <label className="block text-[0.75rem] font-semibold text-[#475569] mb-2 uppercase tracking-[0.05em]">
            MEP <span className="font-normal normal-case"></span>
          </label>
          <input
            type="text"
            value={mepSearch}
            onChange={(e) => {
              setMepSearch(e.target.value);
              setMepDropdownOpen(true);
              if (!e.target.value) setSelectedMep(null);
            }}
            onFocus={() => setMepDropdownOpen(true)}
            onBlur={() => setTimeout(() => setMepDropdownOpen(false), 150)}
            placeholder="Search by name, country, party..."
            className="w-full p-[0.625rem] text-sm rounded-[8px] text-[#1e293b]"
            style={{
              border: `1px solid ${!!selectedMep ? "#3b82f6" : "#e2e8f0"}`,
              background: !!selectedMep ? "#eff6ff" : "white",
            }}
          />
          <AutocompleteDropdown<MepInfo>
            items={filteredMeps}
            isOpen={mepDropdownOpen && !selectedMep}
            onSelect={(mep) => {
              setSelectedMep(mep);
              setMepSearch(mep.name);
              setMepDropdownOpen(false);
            }}
            renderItem={(mep) => (
              <div className="flex items-center gap-2">
                <div
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ background: getGroupColor(mep.political_group) }}
                />
                <div className="flex-1">
                  <div className="font-medium">{mep.name}</div>
                  <div className="text-[0.75rem] text-[#64748b]">
                    {getGroupShortName(mep.political_group)} · {mep.country}
                  </div>
                </div>
              </div>
            )}
          />
        </div>

        {/* Committee Search */}
        <div className="relative">
          <label className="block text-[0.75rem] font-semibold text-[#475569] mb-2 uppercase tracking-[0.05em]">
            Committee{" "}
            <span className="font-normal normal-case"></span>
          </label>
          <input
            type="text"
            value={committeeSearch}
            onChange={(e) => {
              setCommitteeSearch(e.target.value);
              setCommitteeDropdownOpen(true);
              if (!e.target.value) setSelectedCommittee("");
            }}
            onFocus={() => setCommitteeDropdownOpen(true)}
            onBlur={() =>
              setTimeout(() => setCommitteeDropdownOpen(false), 150)
            }
            placeholder="Search committees..."
            className="w-full p-[0.625rem] text-sm rounded-[8px] text-[#1e293b]"
            style={{
              border: `1px solid ${!!selectedCommittee ? "#3b82f6" : "#e2e8f0"}`,
              background: !!selectedCommittee ? "#eff6ff" : "white",
            }}
          />
          <AutocompleteDropdown<CommitteeInfo>
            items={filteredCommittees}
            isOpen={committeeDropdownOpen && !selectedCommittee}
            onSelect={(c) => {
              setSelectedCommittee(c.acronym);
              setCommitteeSearch(c.acronym);
              setCommitteeDropdownOpen(false);
            }}
            renderItem={(c) => (
              <div className="flex justify-between">
                <span className="font-medium">{c.acronym}</span>
              </div>
            )}
          />
        </div>

        {/* Procedure Search */}
        <div className="relative">
          <label className="block text-[0.75rem] font-semibold text-[#475569] mb-2 uppercase tracking-[0.05em]">
            Procedure{" "}
            <span className="font-normal normal-case"></span>
          </label>
          <input
            type="text"
            value={procedureSearch}
            onChange={(e) => {
              setProcedureSearch(e.target.value);
              setProcedureDropdownOpen(true);
              if (!e.target.value) setSelectedProcedure("");
            }}
            onFocus={() => setProcedureDropdownOpen(true)}
            onBlur={() =>
              setTimeout(() => setProcedureDropdownOpen(false), 200)
            }
            placeholder="Search procedures..."
            className="w-full p-[0.625rem] text-sm rounded-[8px] text-[#1e293b]"
            style={{
              border: `1px solid ${!!selectedProcedure ? "#3b82f6" : "#e2e8f0"}`,
              background: !!selectedProcedure ? "#eff6ff" : "white",
            }}
          />
          <AutocompleteDropdown<ProcedureInfo>
            items={filteredProcedures}
            isOpen={procedureDropdownOpen && !selectedProcedure}
            onSelect={(p) => {
              setSelectedProcedure(p.procedure);
              setProcedureSearch(p.procedure);
              setProcedureDropdownOpen(false);
            }}
            renderItem={(p) => (
              <div className="flex justify-between">
                <span className="font-medium">{p.procedure}</span>
              </div>
            )}
          />
        </div>

        {/* Organization Search */}
        <div className="relative">
          <label className="block text-[0.75rem] font-semibold text-[#475569] mb-2 uppercase tracking-[0.05em]">
            Organization{" "}
            <span className="font-normal normal-case"></span>
          </label>
          <input
            type="text"
            value={organizationSearch}
            onChange={(e) => {
              setOrganizationSearch(e.target.value);
              setOrganizationDropdownOpen(true);
              if (!e.target.value) setSelectedOrganization("");
            }}
            onFocus={() => setOrganizationDropdownOpen(true)}
            onBlur={() =>
              setTimeout(() => setOrganizationDropdownOpen(false), 200)
            }
            placeholder="Search organizations..."
            className="w-full p-[0.625rem] text-sm rounded-[8px] text-[#1e293b]"
            style={{
              border: `1px solid ${!!selectedOrganization ? "#3b82f6" : "#e2e8f0"}`,
              background: !!selectedOrganization ? "#eff6ff" : "white",
            }}
          />
          <AutocompleteDropdown<OrganizationInfo>
            items={filteredOrganizations}
            isOpen={organizationDropdownOpen && !selectedOrganization}
            onSelect={(org) => {
              setSelectedOrganization(org.name);
              setOrganizationSearch(org.name);
              setOrganizationDropdownOpen(false);
            }}
            renderItem={(org) => (
              <div className="flex justify-between">
                <span className="font-medium overflow-hidden text-ellipsis whitespace-nowrap max-w-[200px]">
                  {org.name}
                </span>
              </div>
            )}
          />
        </div>
      </div>

      {/* EP Period toggle */}
      <div className="mb-4 flex items-center gap-3">
        <span className="text-[0.75rem] font-semibold text-[#475569] uppercase tracking-[0.05em]">
          EP Period:
        </span>
        <div className="flex rounded-[8px] border border-[#e2e8f0] overflow-hidden">
          {(
            [
              { value: "both" as const, label: "Both" },
              { value: "ep9" as const, label: "EP9 (2019-2024)" },
              { value: "ep10" as const, label: "EP10 (2024-)" },
            ] as { value: EpPeriod; label: string }[]
          ).map((option) => (
            <button
              key={option.value}
              onClick={() => setEpPeriod(option.value)}
              className="px-4 py-2 text-sm border-none cursor-pointer transition-all duration-[0.15s] ease-in-out"
              style={{
                fontWeight: epPeriod === option.value ? 600 : 400,
                background: epPeriod === option.value ? "#3b82f6" : "white",
                color: epPeriod === option.value ? "white" : "#475569",
                borderRight:
                  option.value !== "ep10" ? "1px solid #e2e8f0" : "none",
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
