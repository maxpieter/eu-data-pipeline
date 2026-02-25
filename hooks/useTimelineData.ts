"use client";

import { useEffect, useState, useMemo } from "react";
import { fuzzyMatchScore as fuzzyMatch } from "@/lib/search";
import {
  fetchMeps,
  fetchCommittees,
  fetchMeetingProcedures,
  fetchOrganizations,
  fetchMepProcedures,
  fetchTimeline,
  fetchProcedureEvents,
} from "@/lib/api";
import type {
  MepInfo,
  CommitteeInfo,
  ProcedureInfo,
  OrganizationInfo,
  TimelineData,
  ProcedureEventsData,
} from "@/lib/api";
import { getGroupShortName } from "@/lib/timelineUtils";

// Re-export types so consumers only need to import from this hook file
export type {
  MepInfo,
  CommitteeInfo,
  ProcedureInfo,
  OrganizationInfo,
  TimelineData,
  ProcedureEventsData,
};
export type { OeilEvent, MeetingDetail, TimelineEntry } from "@/lib/api";

export type EpPeriod = "both" | "ep9" | "ep10";

export interface UseTimelineDataReturn {
  // ---- raw data lists ----
  mepList: MepInfo[];
  committees: CommitteeInfo[];
  procedures: ProcedureInfo[];
  organizations: OrganizationInfo[];
  timelineData: TimelineData | null;
  procedureEvents: ProcedureEventsData | null;

  // ---- selections ----
  selectedMep: MepInfo | null;
  setSelectedMep: (mep: MepInfo | null) => void;
  selectedCommittee: string;
  setSelectedCommittee: (v: string) => void;
  selectedProcedure: string;
  setSelectedProcedure: (v: string) => void;
  selectedOrganization: string;
  setSelectedOrganization: (v: string) => void;

  // ---- search query strings ----
  mepSearch: string;
  setMepSearch: (v: string) => void;
  committeeSearch: string;
  setCommitteeSearch: (v: string) => void;
  procedureSearch: string;
  setProcedureSearch: (v: string) => void;
  organizationSearch: string;
  setOrganizationSearch: (v: string) => void;

  // ---- dropdown open/close ----
  mepDropdownOpen: boolean;
  setMepDropdownOpen: (v: boolean) => void;
  committeeDropdownOpen: boolean;
  setCommitteeDropdownOpen: (v: boolean) => void;
  procedureDropdownOpen: boolean;
  setProcedureDropdownOpen: (v: boolean) => void;
  organizationDropdownOpen: boolean;
  setOrganizationDropdownOpen: (v: boolean) => void;

  // ---- EP period ----
  epPeriod: EpPeriod;
  setEpPeriod: (v: EpPeriod) => void;

  // ---- loading / error ----
  loading: boolean;
  error: string | null;
  eventsLoading: boolean;

  // ---- OEIL overlay toggles ----
  showKeyEvents: boolean;
  setShowKeyEvents: (v: boolean) => void;
  showDocGateway: boolean;
  setShowDocGateway: (v: boolean) => void;

  // ---- filtered (memoized) lists ----
  filteredMeps: MepInfo[];
  filteredCommittees: CommitteeInfo[];
  filteredProcedures: ProcedureInfo[];
  filteredOrganizations: OrganizationInfo[];

  // ---- actions ----
  clearAll: () => Promise<void>;
  /** Clears the selected MEP and restores global procedure list. */
  clearMep: () => Promise<void>;
}

/**
 * Custom hook that owns all data-fetching, filter state, and derived lists for
 * the MEP Meeting Timeline feature.
 *
 * Components that consume this hook only need to pass the returned values as
 * props; they contain no fetching or business logic themselves.
 */
export function useTimelineData(): UseTimelineDataReturn {
  // ---- raw data ----
  const [mepList, setMepList] = useState<MepInfo[]>([]);
  const [committees, setCommittees] = useState<CommitteeInfo[]>([]);
  const [procedures, setProcedures] = useState<ProcedureInfo[]>([]);
  const [organizations, setOrganizations] = useState<OrganizationInfo[]>([]);
  const [timelineData, setTimelineData] = useState<TimelineData | null>(null);

  // ---- OEIL procedure events ----
  const [procedureEvents, setProcedureEvents] =
    useState<ProcedureEventsData | null>(null);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [showKeyEvents, setShowKeyEvents] = useState(true);
  const [showDocGateway, setShowDocGateway] = useState(true);

  // ---- selections ----
  const [selectedMep, setSelectedMep] = useState<MepInfo | null>(null);
  const [selectedCommittee, setSelectedCommittee] = useState<string>("");
  const [selectedProcedure, setSelectedProcedure] = useState<string>("");
  const [selectedOrganization, setSelectedOrganization] = useState<string>("");

  // ---- search inputs ----
  const [mepSearch, setMepSearch] = useState("");
  const [committeeSearch, setCommitteeSearch] = useState("");
  const [procedureSearch, setProcedureSearch] = useState("");
  const [organizationSearch, setOrganizationSearch] = useState("");

  // ---- dropdown visibility ----
  const [mepDropdownOpen, setMepDropdownOpen] = useState(false);
  const [committeeDropdownOpen, setCommitteeDropdownOpen] = useState(false);
  const [procedureDropdownOpen, setProcedureDropdownOpen] = useState(false);
  const [organizationDropdownOpen, setOrganizationDropdownOpen] =
    useState(false);

  // ---- EP period ----
  const [epPeriod, setEpPeriod] = useState<EpPeriod>("both");

  // ---- UI state ----
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ---- filtered lists (memoized) ----
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

  // ---- effects ----

  // Initial data load
  useEffect(() => {
    async function fetchData() {
      try {
        const [meps, fetchedCommittees, fetchedProcedures, fetchedOrgs] =
          await Promise.all([
            fetchMeps(),
            fetchCommittees(),
            fetchMeetingProcedures(),
            fetchOrganizations(),
          ]);
        setMepList(meps);
        setCommittees(fetchedCommittees);
        setProcedures(fetchedProcedures);
        setOrganizations(fetchedOrgs);
        setError(null);
      } catch {
        setError("Failed to load data. Make sure server.py is running.");
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  // Fetch MEP-specific procedures when MEP is selected, restore global when cleared
  useEffect(() => {
    async function updateProcedures() {
      try {
        if (selectedMep) {
          const fetchedProcedures = await fetchMepProcedures(selectedMep.id);
          setProcedures(fetchedProcedures);
        } else {
          const fetchedProcedures = await fetchMeetingProcedures();
          setProcedures(fetchedProcedures);
        }
      } catch (err) {
        console.error("Failed to fetch procedures:", err);
      }
    }
    updateProcedures();
  }, [selectedMep]);

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

    async function fetchTimelineData() {
      setLoading(true);
      setTimelineData(null);
      try {
        const data = await fetchTimeline({
          ...(selectedMep ? { mep: selectedMep.id } : {}),
          ...(selectedCommittee ? { committee: selectedCommittee } : {}),
          ...(selectedProcedure ? { procedure: selectedProcedure } : {}),
          ...(selectedOrganization
            ? { organization: selectedOrganization }
            : {}),
          ...(epPeriod !== "both" ? { ep_period: epPeriod } : {}),
        });
        setTimelineData(data);
        setError(null);
      } catch {
        setError("Failed to load timeline.");
      } finally {
        setLoading(false);
      }
    }
    fetchTimelineData();
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
        const data = await fetchProcedureEvents(selectedProcedure);
        setProcedureEvents(data);
      } catch {
        setProcedureEvents(null);
      } finally {
        setEventsLoading(false);
      }
    }
    fetchEvents();
  }, [selectedProcedure]);

  // ---- clearMep action ----
  const clearMep = async () => {
    setSelectedMep(null);
    setMepSearch("");
    try {
      const fetchedProcedures = await fetchMeetingProcedures();
      setProcedures(fetchedProcedures);
    } catch (err) {
      console.error("Failed to restore procedures:", err);
    }
  };

  // ---- clearAll action ----
  const clearAll = async () => {
    setSelectedMep(null);
    setSelectedCommittee("");
    setSelectedProcedure("");
    setSelectedOrganization("");
    setMepSearch("");
    setCommitteeSearch("");
    setProcedureSearch("");
    setOrganizationSearch("");
    setEpPeriod("both");
    try {
      const fetchedProcedures = await fetchMeetingProcedures();
      setProcedures(fetchedProcedures);
    } catch (err) {
      console.error("Failed to restore procedures:", err);
    }
  };

  return {
    mepList,
    committees,
    procedures,
    organizations,
    timelineData,
    procedureEvents,

    selectedMep,
    setSelectedMep,
    selectedCommittee,
    setSelectedCommittee,
    selectedProcedure,
    setSelectedProcedure,
    selectedOrganization,
    setSelectedOrganization,

    mepSearch,
    setMepSearch,
    committeeSearch,
    setCommitteeSearch,
    procedureSearch,
    setProcedureSearch,
    organizationSearch,
    setOrganizationSearch,

    mepDropdownOpen,
    setMepDropdownOpen,
    committeeDropdownOpen,
    setCommitteeDropdownOpen,
    procedureDropdownOpen,
    setProcedureDropdownOpen,
    organizationDropdownOpen,
    setOrganizationDropdownOpen,

    epPeriod,
    setEpPeriod,

    loading,
    error,
    eventsLoading,

    showKeyEvents,
    setShowKeyEvents,
    showDocGateway,
    setShowDocGateway,

    filteredMeps,
    filteredCommittees,
    filteredProcedures,
    filteredOrganizations,

    clearAll,
    clearMep,
  };
}
