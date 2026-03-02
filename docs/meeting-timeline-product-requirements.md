# Product Requirements Document
## Meeting Timeline UI Parity + Amendment Analysis

Version: `v0.2`  
Date: `2026-02-25`  
Status: `Verified decisions integrated (v0.2)`

## 1. Objective
Make the `/meeting-timeline` experience match the provided reference image, with clear behavior for:
- filter-driven meeting timeline rendering,
- procedure timeline overlay in the same visual style,
- amendment document markers and MEP-specific "click to analyze" flow.

## 2. Requested Core Rules (from user prompt)
The implementation must satisfy these rules:
1. Meetings should show when any filter is selected.
2. If procedure is also selected, show the procedure timeline in the same clean style as the reference image.
3. If an MEP is selected, documents that are amendments should appear as dark circular markers and support "click to analyze" to run an LLM pipeline.

## 3. Scope
In scope:
- Timeline page UI/UX parity with the reference image.
- Frontend filter and timeline behavior.
- Procedure events overlay and document marker logic.
- Amendment identification and marker styling.
- End-to-end "analyze MEP position" pipeline trigger and result display.

Out of scope:
- Rebuilding unrelated graph pages.
- Historical backfill/re-scrape of all OEIL data beyond normal fetch/cache behavior.

## 4. Current Main-Branch Gaps to Close
Observed on current `main`:
- Procedure events are drawn as top overlay only; bottom rail/event lane from reference is missing.
- No amendment-specific marker treatment.
- No "click to analyze MEP position" action.
- No LLM analysis backend contract currently exists.
- Procedure selection currently filters `/api/timeline` directly, which may not match the desired "also show procedure timeline" behavior.

## 5. UX and Visual Requirements

### REQ-UI-01 Layout Parity
The timeline area must include:
- filter bar (MEP, committee, procedure, organization),
- EP period segmented control (`Both`, `EP9`, `EP10`),
- active filter chips with remove and clear-all,
- summary card (selected entity and counts),
- chart card with "Meetings per Week",
- right-aligned legend/toggles for key events, documents, attendees,
- lower event rail with dated markers and count bubbles.

### REQ-UI-02 Visual Style
Use the clean reference style:
- light page background,
- white cards with subtle gray border,
- stacked blue meeting bars by attendee count intensity,
- dashed vertical event lines,
- compact tooltips with title/body/action link,
- non-overlapping marker layout (cluster and stack when same date bucket).

### REQ-UI-03 Marker Styles
- Key events: red family color.
- Documents: amber family color.
- Amendment documents (MEP selected): dark circular marker.
- If multiple docs share the same x-position, show stacked mini-circles and a count bubble.

## 6. Functional Behavior Requirements

### REQ-FN-01 Timeline Visibility Trigger
Meetings timeline is shown when at least one of the following is selected:
- MEP,
- committee,
- procedure,
- organization.

If no filters are active, show empty state prompt.

### REQ-FN-02 Filter Composition
Apply combined filters predictably and consistently across frontend and backend.

Verified behavior:
- Primary meetings bars are driven by active filters.
- Procedure selection narrows meeting bars to the selected procedure.
- Procedure selection additionally enables procedure event overlay.
- When procedure is selected together with other filters, bars reflect the intersection.

### REQ-FN-03 Procedure Timeline Overlay
When a procedure is selected:
- fetch procedure events (`key_events`, `documentation_gateway`),
- render event lines synchronized with week x-axis,
- render lower rail markers and clusters,
- support toggles for key events and documents,
- keep attendee legend visible.

### REQ-FN-04 Amendment Detection
Follow implementation pattern from `llm-analysis-documents` branch:
- document is considered amendment when `evt.link` contains `-AM-` (case-insensitive),
- document must also be a likely PDF link to be analyzable (`.pdf` or known document URL patterns).

Current implementation gate for analysis:
- `hasPdfLink && isAmendmentDoc && hasMepName`.

### REQ-FN-05 MEP-Gated Amendment CTA
The "Click to analyze MEP position" action appears only when:
- an MEP is selected, and
- hovered/clicked document is classified as amendment.

No MEP selected:
- marker remains visible,
- CTA hidden/disabled,
- tooltip explains that MEP selection is required.

### REQ-FN-06 Analysis Trigger and UX States
On CTA click:
- trigger backend analysis request (`POST /api/analyze-document`),
- show loading state (`Analyzing...`) in a fixed card stack,
- on success, show "Analysis Ready" card and allow expansion,
- expanded view is a modal dialog with full analysis content and metadata,
- show explicit error state in card when analysis fails.

## 7. LLM Pipeline Requirements

### REQ-LLM-01 API Contract
Use branch-implemented endpoint:
- `POST /api/analyze-document`

No async job/poll endpoint required in current version.

### REQ-LLM-02 Request Payload
Minimum fields:
- `document_url` (required)
- `mep_name` (required for amendment docs)
- `document_ref` (optional)
- `force` (optional cache bypass)

### REQ-LLM-03 Response Payload
Minimum result:
- `analysis` (text summary)
- `doc_type` / `doc_type_label`
- `document_url` / `document_ref`
- `mep_name`
- `amendments_found` (for amendment docs)
- `analysis_text_length`, `full_document_length`
- `llm_provider`
- `analyzed_at`
- `error` (when applicable)

### REQ-LLM-04 Pipeline Steps
1. Retrieve amendment document content (from OEIL link or reference resolver).
2. Extract PDF text (`pdftotext` flow).
3. Detect document type from URL pattern (`-AM-`, `-PR-`, `-AD-`, `COM`, `SWD`).
4. For amendments: extract sections mentioning selected MEP.
5. Run LLM analysis and return response payload.
6. Persist cache.

### REQ-LLM-05 Caching
Cache by key:
- `mep_name + document_url` (with empty `mep_name` for non-amendment docs).

If cached, return cached result immediately unless force-refresh requested.

### REQ-LLM-06 Provider/Runtime
Use the branch-implemented provider switch:
- `LLM_PROVIDER=ollama|anthropic` (default `ollama`),
- Ollama defaults: `OLLAMA_MODEL=llama3.1`, `OLLAMA_BASE_URL=http://localhost:11434`,
- Anthropic defaults: `ANTHROPIC_MODEL=claude-sonnet-4-20250514`, key via `ANTHROPIC_API_KEY`.

## 8. Data and Backend Requirements

### REQ-DATA-01 Procedure Events Enrichment
Current required compatibility:
- document `link` must be present when available so URL-pattern amendment detection works (`-AM-` check).

Optional enhancement (not required for parity):
- add server-side `is_amendment` and stable document `id`.

### REQ-DATA-02 Timeline API Consistency
`/api/timeline` and frontend filtering logic must be aligned so the same active filters always produce deterministic bars and counts.

### REQ-DATA-03 Error Handling
If OEIL scrape fails:
- still render meetings timeline,
- show non-blocking notice for unavailable procedure events.

## 9. Non-Functional Requirements
- Render and interaction remain smooth with one-year weekly buckets.
- Event marker clustering avoids visual overlap and tooltip collision.
- Analysis job requests are idempotent for same cache key.
- All actionable elements keyboard accessible.

## 10. Acceptance Criteria (Must Pass)
1. With any single filter selected, timeline bars render and counts are non-zero when data exists.
2. With procedure selected, procedure events appear in chart and lower rail with toggle control.
3. With MEP + procedure selected, amendment docs are visually dark markers.
4. Amendment tooltip includes "Click to analyze MEP position" and triggers backend analysis request.
5. Analysis returns response from `POST /api/analyze-document` and appears in floating analysis cards without page reload.
6. Clicking a ready analysis card opens a full modal detail view.
7. No active filters shows empty state only.
8. Visual composition matches reference image style and information hierarchy.

## 11. Implementation Mapping (Current Codebase)
Likely touchpoints:
- `components/timeline/TimelineChart.tsx`
- `components/timeline/ResultsCard.tsx`
- `components/timeline/ActiveFilters.tsx`
- `components/timeline/FilterBar.tsx`
- `hooks/useTimelineData.ts`
- `lib/api.ts`
- `server.py`
- `scrapers/scrape_oeil_events.py`

## 12. Open Decisions to Confirm Before Build
No open product decisions for this scope.

## 13. Decision Log (Confirmed)
1. Procedure selection should narrow meeting bars.
2. Amendment detection, analysis surface, and LLM runtime/provider follow `llm-analysis-documents` branch implementation.
