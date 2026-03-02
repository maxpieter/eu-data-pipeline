// Political group colors
export const GROUP_COLORS: Record<string, string> = {
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

export function getGroupColor(group: string): string {
  return GROUP_COLORS[group] || "#6B7280";
}

export function getGroupShortName(group: string): string {
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

export function getAttendeeColor(count: number): string {
  if (count <= 1) return "#93c5fd";
  if (count <= 3) return "#60a5fa";
  if (count <= 10) return "#3b82f6";
  if (count <= 25) return "#2563eb";
  if (count <= 50) return "#1d4ed8";
  return "#1e40af";
}

// Legislative procedure stages
export const LEGISLATIVE_STAGES = [
  { id: "proposal", label: "Proposal", color: "#8b5cf6" },
  { id: "first_reading", label: "First Reading", color: "#3b82f6" },
  { id: "second_reading", label: "Second Reading", color: "#f59e0b" },
  { id: "end_of_procedure", label: "End of Procedure", color: "#16a34a" },
];

export function classifyEventStage(eventDescription: string): string | null {
  const desc = eventDescription.toLowerCase();
  if (desc.includes("legislative proposal published")) return "proposal";
  if (
    desc.includes("committee referral") ||
    desc.includes("vote in committee, 1st reading") ||
    desc.includes("decision by parliament, 1st reading") ||
    desc.includes("council position") ||
    desc.includes("1st reading")
  )
    return "first_reading";
  if (desc.includes("2nd reading")) return "second_reading";
  if (
    desc.includes("act adopted by council") ||
    desc.includes("final act signed") ||
    desc.includes("final act published") ||
    desc.includes("end of procedure")
  )
    return "end_of_procedure";
  return null;
}

export function fuzzyMatch(text: string, query: string): number {
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
