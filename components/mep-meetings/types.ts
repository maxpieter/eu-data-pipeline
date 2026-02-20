export interface MepInfo {
  id: number;
  name: string;
  country: string;
  political_group: string;
  meeting_count: number;
}

export interface CommitteeInfo {
  acronym: string;
  count: number;
}

export interface ProcedureInfo {
  procedure: string;
  count: number;
}

export interface OrganizationInfo {
  name: string;
  count: number;
}

export interface OeilEvent {
  date: string;
  event?: string;
  doc_type?: string;
  reference: string;
  committee?: string;
  source?: string;
  link?: string | null;
  category: "key_event" | "documentation";
}

export interface AnalysisResult {
  analysis?: string;
  error?: string;
  mep_name?: string;
  document_url: string;
  document_ref?: string;
  doc_type?: string;
  doc_type_label?: string;
  amendments_found?: number;
  amendments_text_length?: number;
  analysis_text_length?: number;
  full_document_length?: number;
  llm_provider?: string;
  analyzed_at?: string;
}

export interface AnalysisCard {
  id: string;
  loading: boolean;
  documentUrl: string;
  documentRef: string;
  mepName: string;
  result: AnalysisResult | null;
}

export interface ProcedureEventsData {
  procedure: string;
  title: string;
  key_events: OeilEvent[];
  documentation_gateway: OeilEvent[];
}

export interface MeetingDetail {
  date: string;
  title: string;
  attendee_count: number;
  procedure: string | null;
}

export interface TimelineEntry {
  week?: string;
  month?: string;
  count: number;
  meetings?: MeetingDetail[];
}

export interface TimelineData {
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

export type EpPeriod = "both" | "ep9" | "ep10";
