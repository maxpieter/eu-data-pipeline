"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import * as d3 from "d3";

interface MepInfo {
  id: number;
  name: string;
  country: string;
  political_group: string;
  meeting_count: number;
}

interface CommitteeInfo {
  acronym: string;
  count: number;
}

interface ProcedureInfo {
  procedure: string;
  count: number;
}

interface OrganizationInfo {
  name: string;
  count: number;
}

interface MeetingDetail {
  date: string;
  title: string;
  attendee_count: number;
  procedure: string | null;
}

interface TimelineEntry {
  week?: string;
  month?: string;
  count: number;
  meetings?: MeetingDetail[];
}

interface TimelineData {
  timeline: TimelineEntry[];
  total_meetings: number;
  meps_involved?: number;
  mep?: {
    id: number;
    name: string;
    country: string;
    political_group: string;
  };
  procedure?: string;
  committee?: string;
}

// Political group colors
const GROUP_COLORS: Record<string, string> = {
  "Group of the European People's Party (Christian Democrats)": "#1E40AF",
  "Group of the Progressive Alliance of Socialists and Democrats in the European Parliament":
    "#DC2626",
  "Renew Europe Group": "#FBBF24",
  "Group of the Greens/European Free Alliance": "#16A34A",
  "European Conservatives and Reformists Group": "#0891B2",
  "Identity and Democracy Group": "#7C3AED",
  "The Left group in the European Parliament - GUE/NGL": "#BE123C",
  "Non-attached Members": "#6B7280",
};

function getGroupColor(group: string): string {
  return GROUP_COLORS[group] || "#6B7280";
}

function getGroupShortName(group: string): string {
  if (group.includes("People's Party")) return "EPP";
  if (group.includes("Socialists")) return "S&D";
  if (group.includes("Renew")) return "Renew";
  if (group.includes("Greens")) return "Greens/EFA";
  if (group.includes("Conservatives")) return "ECR";
  if (group.includes("Identity")) return "ID";
  if (group.includes("Left")) return "The Left";
  if (group.includes("Non-attached")) return "NI";
  return group.slice(0, 10);
}

// Color scale for attendee count (1 = light, many = dark)
function getAttendeeColor(count: number): string {
  if (count <= 1) return "#93c5fd"; // light blue
  if (count <= 3) return "#60a5fa"; // medium blue
  if (count <= 10) return "#3b82f6"; // blue
  if (count <= 25) return "#2563eb"; // darker blue
  if (count <= 50) return "#1d4ed8"; // even darker
  return "#1e40af"; // darkest blue for 50+
}

function fuzzyMatch(text: string, query: string): number {
  const textLower = text.toLowerCase();
  const queryLower = query.toLowerCase();
  if (textLower === queryLower) return 100;
  if (textLower.startsWith(queryLower)) return 90;
  if (textLower.includes(queryLower)) return 70;
  let score = 0,
    queryIndex = 0,
    consecutive = 0;
  for (let i = 0; i < textLower.length && queryIndex < queryLower.length; i++) {
    if (textLower[i] === queryLower[queryIndex]) {
      score += 10 + consecutive * 5;
      consecutive++;
      queryIndex++;
    } else consecutive = 0;
  }
  return queryIndex === queryLower.length ? Math.min(60, score) : 0;
}

export default function MepMeetingsGraph() {
  const timelineRef = useRef<SVGSVGElement>(null);

  // Data
  const [mepList, setMepList] = useState<MepInfo[]>([]);
  const [committees, setCommittees] = useState<CommitteeInfo[]>([]);
  const [procedures, setProcedures] = useState<ProcedureInfo[]>([]);
  const [organizations, setOrganizations] = useState<OrganizationInfo[]>([]);
  const [timelineData, setTimelineData] = useState<TimelineData | null>(null);

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

  // Dropdown visibility
  const [mepDropdownOpen, setMepDropdownOpen] = useState(false);
  const [committeeDropdownOpen, setCommitteeDropdownOpen] = useState(false);
  const [procedureDropdownOpen, setProcedureDropdownOpen] = useState(false);
  const [organizationDropdownOpen, setOrganizationDropdownOpen] = useState(false);

  // UI
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filtered lists
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

  // Fetch initial data
  useEffect(() => {
    async function fetchData() {
      try {
        const [mepsRes, committeesRes, proceduresRes, organizationsRes] = await Promise.all([
          fetch("/api/meps"),
          fetch("/api/committees"),
          fetch("/api/procedures"),
          fetch("/api/organizations"),
        ]);
        if (!mepsRes.ok || !committeesRes.ok || !proceduresRes.ok || !organizationsRes.ok)
          throw new Error("Failed to fetch");
        const [mepsData, committeesData, proceduresData, organizationsData] = await Promise.all([
          mepsRes.json(),
          committeesRes.json(),
          proceduresRes.json(),
          organizationsRes.json(),
        ]);
        setMepList(mepsData.meps || []);
        setCommittees(committeesData.committees || []);
        setProcedures(proceduresData.procedures || []);
        setOrganizations(organizationsData.organizations || []);
        setError(null);
      } catch (err) {
        setError("Failed to load data. Make sure server.py is running.");
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  // Fetch MEP-specific procedures when MEP is selected
  useEffect(() => {
    if (!selectedMep) return;

    async function fetchMepProcedures() {
      try {
        const res = await fetch(`/api/meps/${selectedMep.id}/procedures`);
        if (res.ok) {
          const data = await res.json();
          setProcedures(data.procedures || []);
        }
      } catch (err) {
        console.error("Failed to fetch MEP procedures:", err);
      }
    }
    fetchMepProcedures();
  }, [selectedMep]);

  // Fetch timeline based on selections
  useEffect(() => {
    // Need at least one filter
    if (!selectedMep && !selectedCommittee && !selectedProcedure && !selectedOrganization) {
      setTimelineData(null);
      return;
    }

    async function fetchTimeline() {
      setLoading(true);
      try {
        let url = "";

        if (selectedMep) {
          // MEP-specific timeline with filters
          const params = new URLSearchParams();
          if (selectedCommittee) params.set("committee", selectedCommittee);
          if (selectedProcedure) params.set("procedure", selectedProcedure);
          if (selectedOrganization) params.set("organization", selectedOrganization);
          url = `/api/meps/${selectedMep.id}/timeline${params.toString() ? "?" + params.toString() : ""}`;
        } else if (selectedProcedure) {
          // Procedure timeline (all MEPs)
          url = `/api/procedures/${encodeURIComponent(selectedProcedure)}/timeline`;
        } else if (selectedCommittee) {
          // Committee timeline (all MEPs)
          url = `/api/committees/${selectedCommittee}/timeline`;
        } else if (selectedOrganization) {
          // For organization-only filter, we need MEP first
          // Show a message that MEP is required for organization filter
          setTimelineData(null);
          setLoading(false);
          return;
        }

        const res = await fetch(url);
        if (!res.ok) throw new Error("Failed to fetch timeline");
        const data = await res.json();
        setTimelineData(data);
        setError(null);
      } catch (err) {
        setError("Failed to load timeline.");
      } finally {
        setLoading(false);
      }
    }
    fetchTimeline();
  }, [selectedMep, selectedCommittee, selectedProcedure, selectedOrganization]);

  // Render timeline
  useEffect(() => {
    if (!timelineRef.current || !timelineData?.timeline?.length) {
      if (timelineRef.current)
        d3.select(timelineRef.current).selectAll("*").remove();
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

    // Use week or month depending on data
    const getTimeKey = (d: TimelineEntry) => d.week || d.month || '';

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
    const barColor = "#3b82f6"; // Fallback color

    // Axes - show every Nth tick to avoid crowding
    const tickInterval = Math.max(1, Math.ceil(data.length / 20));
    g.append("g")
      .attr("transform", `translate(0,${innerHeight})`)
      .call(
        d3
          .axisBottom(x)
          .tickValues(
            data
              .filter((_, i) => i % tickInterval === 0)
              .map(getTimeKey),
          ),
      )
      .selectAll("text")
      .attr("transform", "rotate(-45)")
      .style("text-anchor", "end")
      .style("font-size", "11px")
      .style("fill", "#64748b");

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

    // Render stacked bars - each meeting is a segment colored by attendee count
    data.forEach((periodData) => {
      const meetings = periodData.meetings || [];
      const barX = x(getTimeKey(periodData))!;
      const barWidth = x.bandwidth();

      // Sort meetings by attendee count (largest at bottom)
      const sortedMeetings = [...meetings].sort(
        (a, b) => b.attendee_count - a.attendee_count,
      );

      // Calculate segment heights
      const totalHeight = innerHeight - y(periodData.count);
      const segmentHeight = meetings.length > 0 ? totalHeight / meetings.length : totalHeight;

      // Draw each meeting as a segment
      sortedMeetings.forEach((meeting, i) => {
        const segmentY = y(periodData.count) + i * segmentHeight;

        g.append("rect")
          .attr("class", "meeting-segment")
          .attr("x", barX)
          .attr("y", segmentY)
          .attr("width", barWidth)
          .attr("height", Math.max(segmentHeight - 1, 1)) // -1 for gap
          .attr("fill", getAttendeeColor(meeting.attendee_count))
          .attr("rx", 1)
          .style("cursor", "pointer")
          .on("mouseover", function (event) {
            d3.select(this).attr("stroke", "#1e293b").attr("stroke-width", 2);

            // Tooltip
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

      // If no meetings array, fall back to single bar
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

    // Add legend for color scale
    const legendX = innerWidth - 120;
    const legendY = 10;
    const legendItems = [
      { label: "1", color: "#93c5fd" },
      { label: "2-3", color: "#60a5fa" },
      { label: "4-10", color: "#3b82f6" },
      { label: "11-25", color: "#2563eb" },
      { label: "26-50", color: "#1d4ed8" },
      { label: "50+", color: "#1e40af" },
    ];

    const legend = g.append("g").attr("class", "legend");
    legend
      .append("text")
      .attr("x", legendX)
      .attr("y", legendY)
      .style("font-size", "10px")
      .style("fill", "#64748b")
      .text("Attendees:");

    legendItems.forEach((item, i) => {
      legend
        .append("rect")
        .attr("x", legendX + i * 18)
        .attr("y", legendY + 8)
        .attr("width", 16)
        .attr("height", 10)
        .attr("fill", item.color)
        .attr("rx", 2);
    });
  }, [timelineData, selectedMep]);

  // Autocomplete dropdown component
  const AutocompleteDropdown = ({
    items,
    isOpen,
    onSelect,
    renderItem,
  }: {
    items: any[];
    isOpen: boolean;
    onSelect: (item: any) => void;
    renderItem: (item: any) => React.ReactNode;
  }) => {
    if (!isOpen || items.length === 0) return null;
    return (
      <div
        style={{
          position: "absolute",
          top: "100%",
          left: 0,
          right: 0,
          marginTop: "4px",
          background: "white",
          borderRadius: "8px",
          border: "1px solid #e2e8f0",
          boxShadow: "0 10px 25px -5px rgba(0,0,0,0.1)",
          maxHeight: "240px",
          overflowY: "auto",
          zIndex: 50,
        }}
      >
        {items.map((item, i) => (
          <div
            key={i}
            onClick={() => onSelect(item)}
            style={{
              padding: "0.5rem 0.75rem",
              cursor: "pointer",
              fontSize: "0.875rem",
              borderBottom: "1px solid #f1f5f9",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "#f1f5f9")}
            onMouseLeave={(e) =>
              (e.currentTarget.style.background = "transparent")
            }
          >
            {renderItem(item)}
          </div>
        ))}
      </div>
    );
  };

  const clearAll = async () => {
    setSelectedMep(null);
    setSelectedCommittee("");
    setSelectedProcedure("");
    setSelectedOrganization("");
    setMepSearch("");
    setCommitteeSearch("");
    setProcedureSearch("");
    setOrganizationSearch("");
    // Restore global procedures
    try {
      const res = await fetch("/api/procedures");
      if (res.ok) {
        const data = await res.json();
        setProcedures(data.procedures || []);
      }
    } catch (err) {
      console.error("Failed to restore procedures:", err);
    }
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

      {/* Three Search Fields */}
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
          <label
            style={{
              display: "block",
              fontSize: "0.75rem",
              fontWeight: 600,
              color: "#475569",
              marginBottom: "0.5rem",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
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
            style={{
              width: "100%",
              padding: "0.625rem",
              fontSize: "0.875rem",
              border: `1px solid ${selectedMep ? "#3b82f6" : "#e2e8f0"}`,
              borderRadius: "8px",
              background: selectedMep ? "#eff6ff" : "white",
              color: "#1e293b",
            }}
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
                <span style={{ fontSize: "0.75rem", color: "#94a3b8" }}>
                  {mep.meeting_count}
                </span>
              </div>
            )}
          />
        </div>

        {/* Committee Search */}
        <div style={{ position: "relative" }}>
          <label
            style={{
              display: "block",
              fontSize: "0.75rem",
              fontWeight: 600,
              color: "#475569",
              marginBottom: "0.5rem",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
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
            style={{
              width: "100%",
              padding: "0.625rem",
              fontSize: "0.875rem",
              border: `1px solid ${selectedCommittee ? "#3b82f6" : "#e2e8f0"}`,
              borderRadius: "8px",
              background: selectedCommittee ? "#eff6ff" : "white",
              color: "#1e293b",
            }}
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
                <span style={{ color: "#94a3b8" }}>{c.count} meetings</span>
              </div>
            )}
          />
        </div>

        {/* Procedure Search */}
        <div style={{ position: "relative" }}>
          <label
            style={{
              display: "block",
              fontSize: "0.75rem",
              fontWeight: 600,
              color: "#475569",
              marginBottom: "0.5rem",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
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
            style={{
              width: "100%",
              padding: "0.625rem",
              fontSize: "0.875rem",
              border: `1px solid ${selectedProcedure ? "#3b82f6" : "#e2e8f0"}`,
              borderRadius: "8px",
              background: selectedProcedure ? "#eff6ff" : "white",
              color: "#1e293b",
            }}
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
                <span style={{ color: "#94a3b8" }}>{p.count} meetings</span>
              </div>
            )}
          />
        </div>

        {/* Organization Search */}
        <div style={{ position: "relative" }}>
          <label
            style={{
              display: "block",
              fontSize: "0.75rem",
              fontWeight: 600,
              color: "#475569",
              marginBottom: "0.5rem",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
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
            style={{
              width: "100%",
              padding: "0.625rem",
              fontSize: "0.875rem",
              border: `1px solid ${selectedOrganization ? "#3b82f6" : "#e2e8f0"}`,
              borderRadius: "8px",
              background: selectedOrganization ? "#eff6ff" : "white",
              color: "#1e293b",
            }}
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
                <span style={{ fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "200px" }}>{org.name}</span>
                <span style={{ color: "#94a3b8", flexShrink: 0 }}>{org.count} meetings</span>
              </div>
            )}
          />
        </div>
      </div>

      {/* Active Filters */}
      {(selectedMep || selectedCommittee || selectedProcedure || selectedOrganization) && (
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
          {selectedMep && (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.25rem",
                padding: "0.25rem 0.5rem",
                background: getGroupColor(selectedMep.political_group),
                color: "white",
                borderRadius: "9999px",
                fontSize: "0.75rem",
                fontWeight: 500,
              }}
            >
              {selectedMep.name}
              <button
                onClick={async () => {
                  setSelectedMep(null);
                  setMepSearch("");
                  // Restore global procedures
                  try {
                    const res = await fetch("/api/procedures");
                    if (res.ok) {
                      const data = await res.json();
                      setProcedures(data.procedures || []);
                    }
                  } catch (err) {
                    console.error("Failed to restore procedures:", err);
                  }
                }}
                style={{
                  background: "none",
                  border: "none",
                  color: "white",
                  cursor: "pointer",
                  padding: "0 0.25rem",
                }}
              >
                ×
              </button>
            </span>
          )}
          {selectedCommittee && (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.25rem",
                padding: "0.25rem 0.5rem",
                background: "#3b82f6",
                color: "white",
                borderRadius: "9999px",
                fontSize: "0.75rem",
                fontWeight: 500,
              }}
            >
              {selectedCommittee}
              <button
                onClick={() => {
                  setSelectedCommittee("");
                  setCommitteeSearch("");
                }}
                style={{
                  background: "none",
                  border: "none",
                  color: "white",
                  cursor: "pointer",
                  padding: "0 0.25rem",
                }}
              >
                ×
              </button>
            </span>
          )}
          {selectedProcedure && (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.25rem",
                padding: "0.25rem 0.5rem",
                background: "#10b981",
                color: "white",
                borderRadius: "9999px",
                fontSize: "0.75rem",
                fontWeight: 500,
              }}
            >
              {selectedProcedure}
              <button
                onClick={() => {
                  setSelectedProcedure("");
                  setProcedureSearch("");
                }}
                style={{
                  background: "none",
                  border: "none",
                  color: "white",
                  cursor: "pointer",
                  padding: "0 0.25rem",
                }}
              >
                ×
              </button>
            </span>
          )}
          {selectedOrganization && (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.25rem",
                padding: "0.25rem 0.5rem",
                background: "#f59e0b",
                color: "white",
                borderRadius: "9999px",
                fontSize: "0.75rem",
                fontWeight: 500,
                maxWidth: "200px",
              }}
            >
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {selectedOrganization}
              </span>
              <button
                onClick={() => {
                  setSelectedOrganization("");
                  setOrganizationSearch("");
                }}
                style={{
                  background: "none",
                  border: "none",
                  color: "white",
                  cursor: "pointer",
                  padding: "0 0.25rem",
                  flexShrink: 0,
                }}
              >
                ×
              </button>
            </span>
          )}
          <button
            onClick={clearAll}
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
      )}

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
                {selectedProcedure || selectedCommittee || "All Meetings"}
              </div>
              <div style={{ fontSize: "0.875rem", color: "#64748b" }}>
                {selectedProcedure
                  ? "Procedure"
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
      )}

      {/* Timeline Chart */}
      {timelineData && !loading && (
        <div
          style={{
            background: "white",
            borderRadius: "12px",
            border: "1px solid #e2e8f0",
            padding: "1rem",
            boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
          }}
        >
          <h3
            style={{
              fontSize: "0.875rem",
              fontWeight: 600,
              color: "#1e293b",
              marginBottom: "1rem",
            }}
          >
            Meetings per Month
          </h3>
          <div style={{ width: "100%", minHeight: "400px" }}>
            <svg ref={timelineRef} style={{ width: "100%", height: "400px" }} />
          </div>
        </div>
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
    </div>
  );
}
