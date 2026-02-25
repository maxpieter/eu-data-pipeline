"use client";

import React from "react";
import { useTimelineData } from "@/hooks/useTimelineData";
import FilterBar from "@/components/timeline/FilterBar";
import ActiveFilters from "@/components/timeline/ActiveFilters";
import ResultsCard from "@/components/timeline/ResultsCard";
import TimelineChart from "@/components/timeline/TimelineChart";

/**
 * MEP Meeting Timeline — orchestrator component.
 *
 * All state and data-fetching live in `useTimelineData`.  This component is a
 * thin shell: it calls the hook and fans the returned values out to the four
 * focused sub-components.
 */
export default function MepMeetingsGraph() {
  const timeline = useTimelineData();

  return (
    <div className="p-6 h-full overflow-auto">
      {/* Header */}
      <div className="mb-6">
        <h2 className="text-xl font-bold text-[#1e293b] mb-2">
          MEP Meeting Timeline
        </h2>
        <p className="text-sm text-[#64748b]">
          Filter by MEP, committee, procedure, and/or organization.
        </p>
      </div>

      {/* Search fields + EP Period toggle */}
      <FilterBar
        mepSearch={timeline.mepSearch}
        setMepSearch={timeline.setMepSearch}
        selectedMep={timeline.selectedMep}
        setSelectedMep={timeline.setSelectedMep}
        mepDropdownOpen={timeline.mepDropdownOpen}
        setMepDropdownOpen={timeline.setMepDropdownOpen}
        filteredMeps={timeline.filteredMeps}
        committeeSearch={timeline.committeeSearch}
        setCommitteeSearch={timeline.setCommitteeSearch}
        selectedCommittee={timeline.selectedCommittee}
        setSelectedCommittee={timeline.setSelectedCommittee}
        committeeDropdownOpen={timeline.committeeDropdownOpen}
        setCommitteeDropdownOpen={timeline.setCommitteeDropdownOpen}
        filteredCommittees={timeline.filteredCommittees}
        procedureSearch={timeline.procedureSearch}
        setProcedureSearch={timeline.setProcedureSearch}
        selectedProcedure={timeline.selectedProcedure}
        setSelectedProcedure={timeline.setSelectedProcedure}
        procedureDropdownOpen={timeline.procedureDropdownOpen}
        setProcedureDropdownOpen={timeline.setProcedureDropdownOpen}
        filteredProcedures={timeline.filteredProcedures}
        organizationSearch={timeline.organizationSearch}
        setOrganizationSearch={timeline.setOrganizationSearch}
        selectedOrganization={timeline.selectedOrganization}
        setSelectedOrganization={timeline.setSelectedOrganization}
        organizationDropdownOpen={timeline.organizationDropdownOpen}
        setOrganizationDropdownOpen={timeline.setOrganizationDropdownOpen}
        filteredOrganizations={timeline.filteredOrganizations}
        epPeriod={timeline.epPeriod}
        setEpPeriod={timeline.setEpPeriod}
      />

      {/* Active filter chips */}
      <ActiveFilters
        selectedMep={timeline.selectedMep}
        setSelectedMep={timeline.setSelectedMep}
        setMepSearch={timeline.setMepSearch}
        clearMep={timeline.clearMep}
        selectedCommittee={timeline.selectedCommittee}
        setSelectedCommittee={timeline.setSelectedCommittee}
        setCommitteeSearch={timeline.setCommitteeSearch}
        selectedProcedure={timeline.selectedProcedure}
        setSelectedProcedure={timeline.setSelectedProcedure}
        setProcedureSearch={timeline.setProcedureSearch}
        selectedOrganization={timeline.selectedOrganization}
        setSelectedOrganization={timeline.setSelectedOrganization}
        setOrganizationSearch={timeline.setOrganizationSearch}
        epPeriod={timeline.epPeriod}
        setEpPeriod={timeline.setEpPeriod}
        clearAll={timeline.clearAll}
      />

      {/* Error banner */}
      {timeline.error && (
        <div className="p-4 bg-[#fef3c7] border border-[#fcd34d] rounded-lg text-[#92400e] text-sm mb-6">
          {timeline.error}
        </div>
      )}

      {/* Loading indicator */}
      {timeline.loading && (
        <div className="text-[#64748b] text-sm p-8 text-center">
          Loading...
        </div>
      )}

      {/* Results summary card */}
      {timeline.timelineData && !timeline.loading && (
        <ResultsCard
          timelineData={timeline.timelineData}
          selectedMep={timeline.selectedMep}
          selectedProcedure={timeline.selectedProcedure}
          selectedCommittee={timeline.selectedCommittee}
          procedureEvents={timeline.procedureEvents}
        />
      )}

      {/* D3 timeline chart */}
      {timeline.timelineData && !timeline.loading && (
        <TimelineChart
          timelineData={timeline.timelineData}
          procedureEvents={timeline.procedureEvents}
          showKeyEvents={timeline.showKeyEvents}
          setShowKeyEvents={timeline.setShowKeyEvents}
          showDocGateway={timeline.showDocGateway}
          setShowDocGateway={timeline.setShowDocGateway}
          eventsLoading={timeline.eventsLoading}
        />
      )}

      {/* Empty state */}
      {!timeline.loading && !timeline.error && !timeline.timelineData && (
        <div className="p-12 text-center text-[#64748b] bg-white rounded-[12px] border border-dashed border-[#e2e8f0]">
          <svg
            className="w-12 h-12 mx-auto mb-4 text-[#cbd5e1]"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <p>Use the search fields above to filter meetings.</p>
          <p className="text-xs mt-2">
            Select an MEP to see their meetings, or filter by
            committee/procedure. Organization filter works with MEP selection.
          </p>
        </div>
      )}
    </div>
  );
}
