"use client";

import { useEffect, useState, useCallback } from "react";
import FilterBar from "./mep-meetings/FilterBar";
import ActiveFilters from "./mep-meetings/ActiveFilters";
import ResultsInfoCard from "./mep-meetings/ResultsInfoCard";
import TimelineChart from "./mep-meetings/TimelineChart";
import AnalysisCards from "./mep-meetings/AnalysisCards";
import type {
  MepInfo,
  CommitteeInfo,
  ProcedureInfo,
  OrganizationInfo,
  TimelineData,
  ProcedureEventsData,
  AnalysisCard,
  AnalysisResult,
  EpPeriod,
} from "./mep-meetings/types";

export default function MepMeetingsTimeline() {
  // Data
  const [mepList, setMepList] = useState<MepInfo[]>([]);
  const [committees, setCommittees] = useState<CommitteeInfo[]>([]);
  const [procedures, setProcedures] = useState<ProcedureInfo[]>([]);
  const [organizations, setOrganizations] = useState<OrganizationInfo[]>([]);
  const [timelineData, setTimelineData] = useState<TimelineData | null>(null);

  // Procedure events (OEIL)
  const [procedureEvents, setProcedureEvents] =
    useState<ProcedureEventsData | null>(null);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [showKeyEvents, setShowKeyEvents] = useState(true);
  const [showDocGateway, setShowDocGateway] = useState(true);

  // Selections
  const [selectedMep, setSelectedMep] = useState<MepInfo | null>(null);
  const [selectedCommittee, setSelectedCommittee] = useState<string>("");
  const [selectedProcedure, setSelectedProcedure] = useState<string>("");
  const [selectedOrganization, setSelectedOrganization] = useState<string>("");

  // Search inputs
  const [mepSearch, setMepSearch] = useState("");
  const [committeeSearch, setCommitteeSearch] = useState("");
  const [procedureSearch, setProcedureSearch] = useState("");
  const [organizationSearch, setOrganizationSearch] = useState("");

  // EP Period filter
  const [epPeriod, setEpPeriod] = useState<EpPeriod>("both");

  // Document analysis cards
  const [analysisCards, setAnalysisCards] = useState<AnalysisCard[]>([]);
  const [expandedCardId, setExpandedCardId] = useState<string | null>(null);

  // UI
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Whether progress bar should show
  const hasProgressBar =
    procedureEvents != null && procedureEvents.key_events.length > 0;

  // Fetch initial data
  useEffect(() => {
    async function fetchData() {
      try {
        const [mepsRes, committeesRes, proceduresRes, organizationsRes] =
          await Promise.all([
            fetch("/api/meps"),
            fetch("/api/committees"),
            fetch("/api/procedures"),
            fetch("/api/organizations"),
          ]);
        if (
          !mepsRes.ok ||
          !committeesRes.ok ||
          !proceduresRes.ok ||
          !organizationsRes.ok
        )
          throw new Error("Failed to fetch");
        const [mepsData, committeesData, proceduresData, organizationsData] =
          await Promise.all([
            mepsRes.json(),
            committeesRes.json(),
            proceduresRes.json(),
            organizationsRes.json(),
          ]);
        const meps = mepsData.meps || [];
        const comms = committeesData.committees || [];
        const procs = proceduresData.procedures || [];
        const orgs = organizationsData.organizations || [];
        console.log("[MepMeetingsTimeline] Initial data loaded:", {
          meps: meps.length,
          topMep: meps[0] ? `${meps[0].name}=${meps[0].meeting_count}` : "none",
          committees: comms.length,
          procedures: procs.length,
          organizations: orgs.length,
        });
        setMepList(meps);
        setCommittees(comms);
        setProcedures(procs);
        setOrganizations(orgs);
        setError(null);
      } catch (err) {
        setError("Failed to load data. Make sure server.py is running.");
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  const restoreProcedures = useCallback(async () => {
    try {
      const res = await fetch("/api/procedures");
      if (res.ok) {
        const data = await res.json();
        setProcedures(data.procedures || []);
      }
    } catch (err) {
      console.error("Failed to restore procedures:", err);
    }
  }, []);

  // Fetch MEP-specific procedures when MEP is selected, restore global when cleared
  useEffect(() => {
    if (selectedMep) {
      fetch(`/api/meps/${selectedMep.id}/procedures`)
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data) {
            const procs = data.procedures || [];
            console.log(`[MepMeetingsTimeline] MEP ${selectedMep.id} procedures:`, procs.length, "total count sum:", procs.reduce((s: number, p: { count: number }) => s + p.count, 0));
            setProcedures(procs);
          }
        })
        .catch((err) => console.error("Failed to fetch procedures:", err));
    } else {
      restoreProcedures();
    }
  }, [selectedMep, restoreProcedures]);

  // Fetch timeline based on selections
  useEffect(() => {
    if (
      !selectedMep &&
      !selectedCommittee &&
      !selectedProcedure &&
      !selectedOrganization
    ) {
      setTimelineData(null);
      return;
    }

    async function fetchTimeline() {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (selectedMep) params.set("mep", selectedMep.id.toString());
        if (selectedCommittee) params.set("committee", selectedCommittee);
        if (selectedProcedure) params.set("procedure", selectedProcedure);
        if (selectedOrganization)
          params.set("organization", selectedOrganization);
        if (epPeriod !== "both") params.set("ep_period", epPeriod);

        const timelineUrl = `/api/timeline?${params.toString()}`;
        console.log("[MepMeetingsTimeline] Fetching timeline:", timelineUrl);
        const res = await fetch(timelineUrl);
        if (!res.ok) throw new Error("Failed to fetch timeline");
        const data = await res.json();
        console.log("[MepMeetingsTimeline] Timeline response:", {
          total_meetings: data.total_meetings,
          meps_involved: data.meps_involved,
          timeline_weeks: data.timeline?.length,
          sum_weekly_counts: data.timeline?.reduce((s: number, w: { count: number }) => s + w.count, 0),
          filters: data.filters,
        });
        setTimelineData(data);
        setError(null);
      } catch (err) {
        setError("Failed to load timeline.");
      } finally {
        setLoading(false);
      }
    }
    fetchTimeline();
  }, [
    selectedMep,
    selectedCommittee,
    selectedProcedure,
    selectedOrganization,
    epPeriod,
  ]);

  // Fetch OEIL procedure events when a procedure is selected
  useEffect(() => {
    if (!selectedProcedure) {
      setProcedureEvents(null);
      return;
    }

    async function fetchEvents() {
      setEventsLoading(true);
      try {
        const params = new URLSearchParams({ procedure: selectedProcedure });
        const res = await fetch(`/api/procedure-events?${params.toString()}`);
        if (res.ok) {
          const data = await res.json();
          setProcedureEvents(data);
        } else {
          setProcedureEvents(null);
        }
      } catch {
        setProcedureEvents(null);
      } finally {
        setEventsLoading(false);
      }
    }
    fetchEvents();
  }, [selectedProcedure]);

  // Document analysis handler
  const analyzeDocument = useCallback(
    async (documentUrl: string, documentRef: string) => {
      if (!documentUrl) return;

      const mepName = selectedMep?.name || mepSearch.trim() || "";

      const isDuplicate = analysisCards.some(
        (c) => c.documentUrl === documentUrl && c.mepName === mepName,
      );
      if (isDuplicate) {
        const existing = analysisCards.find(
          (c) => c.documentUrl === documentUrl && c.mepName === mepName && !c.loading,
        );
        if (existing) setExpandedCardId(existing.id);
        return;
      }

      const cardId = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const newCard: AnalysisCard = {
        id: cardId,
        loading: true,
        documentUrl,
        documentRef,
        mepName,
        result: null,
      };
      setAnalysisCards((prev) => [newCard, ...prev]);

      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 300000);
        const res = await fetch("http://localhost:5001/api/analyze-document", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            document_url: documentUrl,
            document_ref: documentRef,
            mep_name: mepName,
          }),
          signal: controller.signal,
        });
        clearTimeout(timeout);

        const data: AnalysisResult = await res.json();
        setAnalysisCards((prev) =>
          prev.map((c) =>
            c.id === cardId ? { ...c, loading: false, result: data } : c,
          ),
        );
      } catch (err) {
        setAnalysisCards((prev) =>
          prev.map((c) =>
            c.id === cardId
              ? {
                  ...c,
                  loading: false,
                  result: {
                    error: `Request failed: ${err instanceof Error ? err.message : "Unknown error"}`,
                    document_url: documentUrl,
                  },
                }
              : c,
          ),
        );
      }
    },
    [selectedMep, mepSearch, analysisCards],
  );

  const toggleCardExpanded = useCallback((cardId: string) => {
    setExpandedCardId((prev) => (prev === cardId ? null : cardId));
  }, []);

  const dismissCard = useCallback((cardId: string) => {
    setAnalysisCards((prev) => prev.filter((c) => c.id !== cardId));
  }, []);

  const clearAll = () => {
    setSelectedMep(null);
    setSelectedCommittee("");
    setSelectedProcedure("");
    setSelectedOrganization("");
    setMepSearch("");
    setCommitteeSearch("");
    setProcedureSearch("");
    setOrganizationSearch("");
    setEpPeriod("both");
    restoreProcedures();
  };

  const handleClearMep = () => {
    setSelectedMep(null);
    setMepSearch("");
    restoreProcedures();
  };

  return (
    <div style={{ padding: "1.5rem", height: "100%", overflow: "auto" }}>
      {/* Header */}
      <div style={{ marginBottom: "1.5rem" }}>
        <h2
          style={{
            fontSize: "1.25rem",
            fontWeight: 700,
            color: "#1e293b",
            marginBottom: "0.5rem",
          }}
        >
          MEP Meeting Timeline
        </h2>
        <p style={{ fontSize: "0.875rem", color: "#64748b" }}>
          Filter by MEP, committee, procedure, and/or organization.
        </p>
      </div>

      <FilterBar
        mepSearch={mepSearch}
        setMepSearch={setMepSearch}
        committeeSearch={committeeSearch}
        setCommitteeSearch={setCommitteeSearch}
        procedureSearch={procedureSearch}
        setProcedureSearch={setProcedureSearch}
        organizationSearch={organizationSearch}
        setOrganizationSearch={setOrganizationSearch}
        selectedMep={selectedMep}
        setSelectedMep={setSelectedMep}
        selectedCommittee={selectedCommittee}
        setSelectedCommittee={setSelectedCommittee}
        selectedProcedure={selectedProcedure}
        setSelectedProcedure={setSelectedProcedure}
        selectedOrganization={selectedOrganization}
        setSelectedOrganization={setSelectedOrganization}
        mepList={mepList}
        committees={committees}
        procedures={procedures}
        organizations={organizations}
        epPeriod={epPeriod}
        setEpPeriod={setEpPeriod}
      />

      <ActiveFilters
        selectedMep={selectedMep}
        selectedCommittee={selectedCommittee}
        selectedProcedure={selectedProcedure}
        selectedOrganization={selectedOrganization}
        epPeriod={epPeriod}
        onClearMep={handleClearMep}
        onClearCommittee={() => {
          setSelectedCommittee("");
          setCommitteeSearch("");
        }}
        onClearProcedure={() => {
          setSelectedProcedure("");
          setProcedureSearch("");
        }}
        onClearOrganization={() => {
          setSelectedOrganization("");
          setOrganizationSearch("");
        }}
        onClearEpPeriod={() => setEpPeriod("both")}
        onClearAll={clearAll}
      />

      {/* Error */}
      {error && (
        <div
          style={{
            padding: "1rem",
            background: "#fef3c7",
            border: "1px solid #fcd34d",
            borderRadius: "8px",
            color: "#92400e",
            fontSize: "0.875rem",
            marginBottom: "1.5rem",
          }}
        >
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div
          style={{
            color: "#64748b",
            fontSize: "0.875rem",
            padding: "2rem",
            textAlign: "center",
          }}
        >
          Loading...
        </div>
      )}

      {/* Results Info Card */}
      {timelineData && !loading && (
        <ResultsInfoCard
          timelineData={timelineData}
          selectedMep={selectedMep}
          selectedProcedure={selectedProcedure}
          selectedCommittee={selectedCommittee}
          procedureEvents={procedureEvents}
        />
      )}

      {/* Timeline Chart */}
      {timelineData && !loading && (
        <TimelineChart
          timelineData={timelineData}
          selectedMep={selectedMep}
          mepSearch={mepSearch}
          procedureEvents={procedureEvents}
          showKeyEvents={showKeyEvents}
          setShowKeyEvents={setShowKeyEvents}
          showDocGateway={showDocGateway}
          setShowDocGateway={setShowDocGateway}
          eventsLoading={eventsLoading}
          hasProgressBar={hasProgressBar}
          analyzeDocument={analyzeDocument}
        />
      )}

      {/* Empty State */}
      {!loading && !error && !timelineData && (
        <div
          style={{
            padding: "3rem",
            textAlign: "center",
            color: "#64748b",
            background: "white",
            borderRadius: "12px",
            border: "1px dashed #e2e8f0",
          }}
        >
          <svg
            style={{
              width: "48px",
              height: "48px",
              margin: "0 auto 1rem",
              color: "#cbd5e1",
            }}
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
          <p style={{ fontSize: "0.75rem", marginTop: "0.5rem" }}>
            Select an MEP to see their meetings, or filter by
            committee/procedure. Organization filter works with MEP selection.
          </p>
        </div>
      )}

      <AnalysisCards
        analysisCards={analysisCards}
        expandedCardId={expandedCardId}
        onToggleExpanded={toggleCardExpanded}
        onDismiss={dismissCard}
        onCloseDialog={() => setExpandedCardId(null)}
      />
    </div>
  );
}
