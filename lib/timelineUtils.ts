/**
 * Shared utility constants and pure helper functions for the MEP Meeting
 * Timeline feature.
 *
 * Kept outside React components and hooks so they can be imported by both
 * the custom hook and the chart/UI sub-components without circular-dependency
 * risk.
 */

// EP parliamentary term boundary dates
export const EP9_END_DATE = "2024-07-15";
export const EP10_START_DATE = "2024-07-16";

// Political group colours keyed by full group name
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

/** Returns the hex colour for a political group, or a neutral grey fallback. */
export function getGroupColor(group: string): string {
  return GROUP_COLORS[group] || "#6B7280";
}

/** Returns a short abbreviation for a political group. */
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

/**
 * Returns a blue shade scaled by attendee count.
 * Light blue for 1 attendee, darkest blue for 50+.
 */
export function getAttendeeColor(count: number): string {
  if (count <= 1) return "#93c5fd";
  if (count <= 3) return "#60a5fa";
  if (count <= 10) return "#3b82f6";
  if (count <= 25) return "#2563eb";
  if (count <= 50) return "#1d4ed8";
  return "#1e40af";
}
