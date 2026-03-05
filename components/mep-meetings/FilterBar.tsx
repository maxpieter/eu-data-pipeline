import React, { useState, useMemo } from "react";
import AutocompleteDropdown from "./AutocompleteDropdown";
import { fuzzyMatch, getGroupColor, getGroupShortName } from "./utils";
import type {
  MepInfo,
  CommitteeInfo,
  ProcedureInfo,
  OrganizationInfo,
  EpPeriod,
} from "./types";

interface FilterBarProps {
  mepSearch: string;
  setMepSearch: (value: string) => void;
  committeeSearch: string;
  setCommitteeSearch: (value: string) => void;
  procedureSearch: string;
  setProcedureSearch: (value: string) => void;
  organizationSearch: string;
  setOrganizationSearch: (value: string) => void;

  selectedMep: MepInfo | null;
  setSelectedMep: (mep: MepInfo | null) => void;
  selectedCommittee: string;
  setSelectedCommittee: (value: string) => void;
  selectedProcedure: string;
  setSelectedProcedure: (value: string) => void;
  selectedOrganization: string;
  setSelectedOrganization: (value: string) => void;

  mepList: MepInfo[];
  committees: CommitteeInfo[];
  procedures: ProcedureInfo[];
  organizations: OrganizationInfo[];

  epPeriod: EpPeriod;
  setEpPeriod: (value: EpPeriod) => void;
}

const LABEL_STYLE: React.CSSProperties = {
  display: "block",
  fontSize: "0.75rem",
  fontWeight: 600,
  color: "#475569",
  marginBottom: "0.5rem",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
};

function getInputStyle(isSelected: boolean): React.CSSProperties {
  return {
    width: "100%",
    padding: "0.625rem",
    fontSize: "0.875rem",
    border: `1px solid ${isSelected ? "#3b82f6" : "#e2e8f0"}`,
    borderRadius: "8px",
    background: isSelected ? "#eff6ff" : "white",
    color: "#1e293b",
  };
}

export default function FilterBar({
  mepSearch,
  setMepSearch,
  committeeSearch,
  setCommitteeSearch,
  procedureSearch,
  setProcedureSearch,
  organizationSearch,
  setOrganizationSearch,
  selectedMep,
  setSelectedMep,
  selectedCommittee,
  setSelectedCommittee,
  selectedProcedure,
  setSelectedProcedure,
  selectedOrganization,
  setSelectedOrganization,
  mepList,
  committees,
  procedures,
  organizations,
  epPeriod,
  setEpPeriod,
}: FilterBarProps): React.ReactNode {
  // Dropdown open/close state — only used by this component
  const [mepDropdownOpen, setMepDropdownOpen] = useState(false);
  const [committeeDropdownOpen, setCommitteeDropdownOpen] = useState(false);
  const [procedureDropdownOpen, setProcedureDropdownOpen] = useState(false);
  const [organizationDropdownOpen, setOrganizationDropdownOpen] =
    useState(false);

  // Filtered lists derived from raw data + search strings
  const filteredMeps = useMemo(() => {
    if (!mepSearch.trim()) return mepList.slice(0, 15);
    return mepList
      .map((mep) => ({
        mep,
        score: Math.max(
          fuzzyMatch(mep.name, mepSearch),
          fuzzyMatch(mep.country, mepSearch) * 0.8,
          fuzzyMatch(getGroupShortName(mep.political_group), mepSearch) * 0.7,
        ),
      }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 15)
      .map(({ mep }) => mep);
  }, [mepList, mepSearch]);

  const filteredCommittees = useMemo(() => {
    if (!committeeSearch.trim()) return committees.slice(0, 15);
    return committees
      .filter((c) =>
        c.acronym.toLowerCase().includes(committeeSearch.toLowerCase()),
      )
      .slice(0, 15);
  }, [committees, committeeSearch]);

  const filteredProcedures = useMemo(() => {
    if (!procedureSearch.trim()) return procedures.slice(0, 15);
    return procedures
      .filter((p) =>
        p.procedure.toLowerCase().includes(procedureSearch.toLowerCase()),
      )
      .slice(0, 15);
  }, [procedures, procedureSearch]);

  const filteredOrganizations = useMemo(() => {
    if (!organizationSearch.trim()) return organizations.slice(0, 15);
    return organizations
      .map((org) => ({
        org,
        score: fuzzyMatch(org.name, organizationSearch),
      }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 15)
      .map(({ org }) => org);
  }, [organizations, organizationSearch]);

  return (
    <>
      {/* Search Fields */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))",
          gap: "1rem",
          marginBottom: "1.5rem",
        }}
      >
        {/* MEP Search */}
        <div style={{ position: "relative" }}>
          <label style={LABEL_STYLE}>
            MEP <span style={{ fontWeight: 400, textTransform: "none" }}></span>
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
            style={getInputStyle(!!selectedMep)}
          />
          <AutocompleteDropdown
            items={filteredMeps}
            isOpen={mepDropdownOpen && !selectedMep}
            onSelect={(mep) => {
              setSelectedMep(mep);
              setMepSearch(mep.name);
              setMepDropdownOpen(false);
            }}
            renderItem={(mep: MepInfo) => (
              <div
                style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}
              >
                <div
                  style={{
                    width: "8px",
                    height: "8px",
                    borderRadius: "50%",
                    background: getGroupColor(mep.political_group),
                  }}
                />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 500 }}>{mep.name}</div>
                  <div style={{ fontSize: "0.75rem", color: "#64748b" }}>
                    {getGroupShortName(mep.political_group)} · {mep.country}
                  </div>
                </div>
              </div>
            )}
          />
        </div>

        {/* Committee Search */}
        <div style={{ position: "relative" }}>
          <label style={LABEL_STYLE}>
            Committee{" "}
            <span style={{ fontWeight: 400, textTransform: "none" }}></span>
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
            style={getInputStyle(!!selectedCommittee)}
          />
          <AutocompleteDropdown
            items={filteredCommittees}
            isOpen={committeeDropdownOpen && !selectedCommittee}
            onSelect={(c) => {
              setSelectedCommittee(c.acronym);
              setCommitteeSearch(c.acronym);
              setCommitteeDropdownOpen(false);
            }}
            renderItem={(c: CommitteeInfo) => (
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontWeight: 500 }}>{c.acronym}</span>
              </div>
            )}
          />
        </div>

        {/* Procedure Search */}
        <div style={{ position: "relative" }}>
          <label style={LABEL_STYLE}>
            Procedure{" "}
            <span style={{ fontWeight: 400, textTransform: "none" }}></span>
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
            style={getInputStyle(!!selectedProcedure)}
          />
          <AutocompleteDropdown
            items={filteredProcedures}
            isOpen={procedureDropdownOpen && !selectedProcedure}
            onSelect={(p) => {
              setSelectedProcedure(p.procedure);
              setProcedureSearch(p.procedure);
              setProcedureDropdownOpen(false);
            }}
            renderItem={(p: ProcedureInfo) => (
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontWeight: 500 }}>{p.procedure}</span>
              </div>
            )}
          />
        </div>

        {/* Organization Search */}
        <div style={{ position: "relative" }}>
          <label style={LABEL_STYLE}>
            Organization{" "}
            <span style={{ fontWeight: 400, textTransform: "none" }}></span>
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
            style={getInputStyle(!!selectedOrganization)}
          />
          <AutocompleteDropdown
            items={filteredOrganizations}
            isOpen={organizationDropdownOpen && !selectedOrganization}
            onSelect={(org) => {
              setSelectedOrganization(org.name);
              setOrganizationSearch(org.name);
              setOrganizationDropdownOpen(false);
            }}
            renderItem={(org: OrganizationInfo) => (
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span
                  style={{
                    fontWeight: 500,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    maxWidth: "200px",
                  }}
                >
                  {org.name}
                </span>
              </div>
            )}
          />
        </div>
      </div>

      {/* EP Period Filter */}
      <div
        style={{
          marginBottom: "1rem",
          display: "flex",
          alignItems: "center",
          gap: "0.75rem",
        }}
      >
        <span
          style={{
            fontSize: "0.75rem",
            fontWeight: 600,
            color: "#475569",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}
        >
          EP Period:
        </span>
        <div
          style={{
            display: "flex",
            borderRadius: "8px",
            border: "1px solid #e2e8f0",
            overflow: "hidden",
          }}
        >
          {[
            { value: "both" as const, label: "Both" },
            { value: "ep9" as const, label: "EP9 (2019-2024)" },
            { value: "ep10" as const, label: "EP10 (2024-)" },
          ].map((option) => (
            <button
              key={option.value}
              onClick={() => setEpPeriod(option.value)}
              style={{
                padding: "0.5rem 1rem",
                fontSize: "0.875rem",
                fontWeight: epPeriod === option.value ? 600 : 400,
                background: epPeriod === option.value ? "#3b82f6" : "white",
                color: epPeriod === option.value ? "white" : "#475569",
                border: "none",
                cursor: "pointer",
                borderRight:
                  option.value !== "ep10" ? "1px solid #e2e8f0" : "none",
                transition: "all 0.15s ease",
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
