#!/usr/bin/env python3
"""
Document analyzer for EU Parliament legislative documents.

Downloads PDFs from europarl.europa.eu, extracts text, and uses an LLM
to produce document-type-appropriate summaries.

Document types detected from URL patterns:
  - amendments  (*-AM-*)   → filter by MEP name, summarize their position
  - draft_report (*-PR-*)  → summarize the lead committee's direction
  - opinion     (*-AD-*)   → summarize the opinion committee's stance
  - commission  (COM_COM*) → summarize the legislative proposal
  - other                  → general summary

Supports two LLM backends:
  - Ollama (local, free)
  - Anthropic Claude API (cloud, best quality)

Configuration via environment variables:
  LLM_PROVIDER        = "ollama" | "anthropic"  (default: "ollama")
  OLLAMA_MODEL         = model name              (default: "llama3.1")
  OLLAMA_BASE_URL      = Ollama API URL          (default: "http://localhost:11434")
  ANTHROPIC_API_KEY    = your API key
  ANTHROPIC_MODEL      = model name              (default: "claude-sonnet-4-20250514")
"""

import hashlib
import json
import logging
import os
import re
import subprocess
import tempfile
from datetime import datetime
from pathlib import Path

import requests

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Document type detection
# ---------------------------------------------------------------------------

DOC_TYPES = {
    "amendments": "Amendments",
    "draft_report": "Draft Report (Lead Committee)",
    "opinion": "Committee Opinion",
    "commission": "Commission Proposal",
    "swd": "Staff Working Document",
    "other": "Document",
}


def detect_document_type(url: str) -> str:
    """Detect the document type from the URL pattern.

    EP doceo URL patterns:
      ECON-AM-781235_EN  → amendments
      ECON-PR-778136_EN  → draft report (lead committee)
      LIBE-AD-775581_EN  → committee opinion (avis)
      COM_COM(2023)0369  → commission proposal
      SWD:2023:0233      → staff working document
    """
    url_upper = url.upper()

    # EP doceo patterns: COMMITTEE-TYPE-NUMBER
    if "-AM-" in url_upper:
        return "amendments"
    if "-PR-" in url_upper:
        return "draft_report"
    if "-AD-" in url_upper:
        return "opinion"

    # Commission documents
    if "COM_COM" in url_upper or "COM(" in url_upper:
        return "commission"

    # Staff working documents
    if "SWD:" in url_upper or "SWD(" in url_upper:
        return "swd"

    return "other"


# ---------------------------------------------------------------------------
# Cache
# ---------------------------------------------------------------------------

CACHE_DIR = Path(__file__).parent.parent / "data" / ".scraper_cache"
ANALYSIS_CACHE_FILE = CACHE_DIR / "document_analysis_cache.json"


def _load_analysis_cache() -> dict:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    if ANALYSIS_CACHE_FILE.exists():
        try:
            with open(ANALYSIS_CACHE_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except (json.JSONDecodeError, IOError):
            return {}
    return {}


def _save_analysis_cache(cache: dict):
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache["_last_updated"] = datetime.now().isoformat()
    with open(ANALYSIS_CACHE_FILE, "w", encoding="utf-8") as f:
        json.dump(cache, f, indent=2, ensure_ascii=False)


def _cache_key(mep_name: str, document_url: str) -> str:
    raw = f"{mep_name.lower().strip()}|{document_url.strip()}"
    return hashlib.md5(raw.encode()).hexdigest()


# ---------------------------------------------------------------------------
# PDF download & text extraction
# ---------------------------------------------------------------------------


def download_pdf(url: str) -> bytes:
    """Download a PDF from a URL. Returns raw bytes."""
    resp = requests.get(
        url,
        timeout=60,
        headers={
            "User-Agent": "Mozilla/5.0 (research-tool; EU Parliament data)",
        },
    )
    resp.raise_for_status()

    if "application/pdf" not in resp.headers.get("Content-Type", ""):
        if resp.headers.get("Content-Type", "").startswith("text/html"):
            raise ValueError(
                "URL returned HTML instead of PDF. "
                "The document may not be available as a direct PDF download."
            )

    return resp.content


def extract_text_from_pdf(pdf_bytes: bytes) -> str:
    """Extract text from PDF bytes using pdftotext (poppler)."""
    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp_pdf:
        tmp_pdf.write(pdf_bytes)
        tmp_pdf_path = tmp_pdf.name

    try:
        txt_path = tmp_pdf_path.replace(".pdf", ".txt")
        result = subprocess.run(
            ["pdftotext", "-layout", tmp_pdf_path, txt_path],
            capture_output=True,
            text=True,
            timeout=30,
        )
        if result.returncode != 0:
            raise RuntimeError(f"pdftotext failed: {result.stderr}")

        with open(txt_path, "r", encoding="utf-8") as f:
            text = f.read()

        os.unlink(txt_path)
        return text

    finally:
        os.unlink(tmp_pdf_path)


# ---------------------------------------------------------------------------
# Text extraction strategies per document type
# ---------------------------------------------------------------------------


def extract_mep_amendments(full_text: str, mep_name: str) -> str:
    """Extract only the amendments that mention a specific MEP."""
    name_parts = mep_name.strip().split()
    search_patterns = [
        mep_name,
        name_parts[-1] if name_parts else mep_name,
    ]
    if len(name_parts) >= 3:
        search_patterns.append(" ".join(name_parts[-2:]))

    amendment_pattern = re.compile(r"(Amendment\s+\d+)", re.IGNORECASE)
    parts = amendment_pattern.split(full_text)

    relevant_blocks = []
    for i in range(1, len(parts) - 1, 2):
        header = parts[i]
        body = parts[i + 1] if i + 1 < len(parts) else ""
        block = header + body

        block_lower = block.lower()
        for pattern in search_patterns:
            if pattern.lower() in block_lower:
                relevant_blocks.append(block.strip())
                break

    if not relevant_blocks:
        paragraphs = full_text.split("\n\n")
        for para in paragraphs:
            para_lower = para.lower()
            for pattern in search_patterns:
                if pattern.lower() in para_lower:
                    relevant_blocks.append(para.strip())
                    break

    if not relevant_blocks:
        return ""

    return "\n\n---\n\n".join(relevant_blocks)


def truncate_text(text: str, max_chars: int = 30000) -> str:
    """Truncate text to fit in LLM context, keeping beginning and end."""
    if len(text) <= max_chars:
        return text
    half = max_chars // 2
    return text[:half] + "\n\n[... middle section truncated ...]\n\n" + text[-half:]


# ---------------------------------------------------------------------------
# System prompts & user prompts per document type
# ---------------------------------------------------------------------------

SYSTEM_PROMPTS = {
    "amendments": """You analyze EU Parliament amendments to identify who benefits.
For each amendment group, state: what it changes, who gains, who loses.
Be direct and skeptical. Cite amendment numbers. Max 200 words.
IMPORTANT: Always respond in English only, regardless of the document language.""",
    "draft_report": """You are an expert analyst of European Union legislative procedures.
You specialize in analyzing committee draft reports from the European Parliament.

When given a draft report from a lead committee, you identify:
1. The overall political direction the committee wants to give to the legislation
2. Key changes proposed compared to the Commission's original text
3. The main policy priorities and red lines
4. Any significant compromises or contested points

IMPORTANT: For every claim, cite the specific reference (e.g. Amendment 12, Art. 3(2), Recital 5).
Be concise — use short bullet points, not full paragraphs. Aim for ~300 words total.""",
    "opinion": """You are an expert analyst of European Union legislative procedures.
You specialize in analyzing committee opinions from the European Parliament.

When given an opinion from a non-lead committee, you provide:
1. **Committee Perspective**: A thorough explanation of the committee's angle — what is their mandate, what are their concerns, and what overall direction do they want to push the legislation in. This section should give the reader a solid understanding of the committee's stance.
2. **Proposed Amendments**: List the key amendments with their specific references. For each, briefly state what it changes and why.

IMPORTANT: For every claim, cite the specific reference (e.g. Amendment 12, Art. 3(2), Recital 5).
Use short bullet points for amendments. The perspective section can be a short paragraph.""",
    "commission": """You are an expert analyst of European Union legislative procedures.
You specialize in analyzing European Commission legislative proposals.

When given a Commission proposal, you provide:
1. A clear summary of what the regulation/directive aims to do
2. The key provisions and obligations it introduces
3. Who is affected (member states, companies, citizens, institutions)
4. The main policy objectives and the problem it aims to solve

IMPORTANT: For every claim, cite the specific reference (e.g. Art. 3(2), Recital 5, Chapter II).
Be concise — use short bullet points, not full paragraphs. Aim for ~300 words total.""",
    "swd": """You are an expert analyst of European Union legislative procedures.
You specialize in analyzing Commission Staff Working Documents (impact assessments).

When given an SWD, you summarize:
1. The policy options considered
2. The expected economic, social, and environmental impacts
3. The preferred option and why
4. Key data points and findings

IMPORTANT: For every claim, cite the specific reference (e.g. Section 3.2, Table 4, p.15).
Be concise — use short bullet points, not full paragraphs. Aim for ~300 words total.""",
    "other": """You are an expert analyst of European Union legislative procedures.
When given a legislative document, provide a clear and concise summary of its content,
key provisions, and significance in the legislative process.
IMPORTANT: For every claim, cite the specific reference (e.g. Art. 3, Recital 5, Section 2).
Be concise — use short bullet points, not full paragraphs. Aim for ~300 words total.""",
}


def _build_prompt(
    doc_type: str, text: str, mep_name: str = "", document_ref: str = ""
) -> str:
    """Build the user prompt based on document type."""
    ref_context = f" (document {document_ref})" if document_ref else ""

    if doc_type == "amendments":
        return f"""Amendments by **{mep_name}**{ref_context}:

{text}

Summarize in max 200 words:
1. **Strategy**: What is this MEP pushing for? (1-2 sentences)
2. **Key changes & who benefits**: Group related amendments. For each: what changes, who gains, who loses. Cite amendment numbers.
3. **Co-signatories**: List them. What does the pattern suggest?

Use bullet points. Be brief."""

    if doc_type == "draft_report":
        return f"""Analyze this draft report from the lead committee{ref_context}.

{text}

Please provide:
1. **Overall Direction**: What stamp is the lead committee putting on this legislation?
2. **Contested Points**: Any areas of significant debate or compromise

Use bullet points. Keep it under 300 words. Cite specific references throughout."""

    if doc_type == "opinion":
        return f"""Analyze this committee opinion{ref_context}.

{text}

Please provide:
1. **Committee Perspective**: Explain this committee's angle — their mandate, concerns, and the overall direction they want to push the legislation in. Be thorough here.
2. **Proposed Amendments**: List the key amendments with their specific references (Amendment N, Art. X). For each, briefly state what it changes and why.

Use bullet points for amendments. Cite specific references throughout."""

    if doc_type == "commission":
        return f"""Summarize this European Commission legislative proposal{ref_context}.

{text}

Please provide:
1. **Objective**: What problem does this proposal aim to solve?
2. **Key Provisions**: The main rules and obligations it introduces
3. **Scope**: Who is affected and how?
4. **Implementation**: Key timelines, enforcement mechanisms, or institutional arrangements

Use bullet points. Keep it under 300 words."""

    if doc_type == "swd":
        return f"""Summarize this Staff Working Document{ref_context}.

{text}

Please provide:
1. **Context**: What policy question is being assessed?
2. **Options Considered**: The main policy alternatives
3. **Key Findings**: Important data points and projected impacts
4. **Preferred Option**: Which approach is recommended and why?

Use bullet points. Keep it under 300 words."""

    # other
    return f"""Summarize this EU legislative document{ref_context}.

{text}

Provide a clear, structured summary. Use bullet points. Keep it under 300 words."""


# ---------------------------------------------------------------------------
# LLM backends
# ---------------------------------------------------------------------------


def query_ollama(prompt: str, system_prompt: str) -> str:
    """Query a local Ollama instance."""
    model = os.environ.get("OLLAMA_MODEL", "llama3.1")
    base_url = os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434")

    resp = requests.post(
        f"{base_url}/api/chat",
        json={
            "model": model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": prompt},
            ],
            "stream": False,
            "options": {
                "num_predict": 512,
            },
        },
        timeout=600,
    )
    resp.raise_for_status()
    data = resp.json()
    return data.get("message", {}).get("content", "")


_anthropic_client = None


def _get_anthropic_client():
    """Return a reused Anthropic client (avoids leaked semaphores on shutdown)."""
    global _anthropic_client
    if _anthropic_client is None:
        try:
            import anthropic
        except ImportError:
            raise ImportError(
                "The 'anthropic' package is required for Claude API. "
                "Install it with: pip install anthropic"
            )

        api_key = os.environ.get("ANTHROPIC_API_KEY")
        if not api_key:
            raise ValueError("ANTHROPIC_API_KEY environment variable is not set")

        _anthropic_client = anthropic.Anthropic(api_key=api_key)
    return _anthropic_client


def query_anthropic(prompt: str, system_prompt: str) -> str:
    """Query the Anthropic Claude API."""
    client = _get_anthropic_client()
    model = os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-4-20250514")

    message = client.messages.create(
        model=model,
        max_tokens=512,
        system=system_prompt,
        messages=[{"role": "user", "content": prompt}],
    )
    return message.content[0].text


def query_llm(prompt: str, system_prompt: str) -> str:
    """Route to the configured LLM provider."""
    provider = os.environ.get("LLM_PROVIDER", "ollama").lower()

    if provider == "anthropic":
        return query_anthropic(prompt, system_prompt)
    elif provider == "ollama":
        return query_ollama(prompt, system_prompt)
    else:
        raise ValueError(
            f"Unknown LLM_PROVIDER: {provider}. Use 'ollama' or 'anthropic'."
        )


# ---------------------------------------------------------------------------
# Two-pass amendment analysis
# ---------------------------------------------------------------------------


def _analyze_amendments(
    amendment_text: str, mep_name: str, document_ref: str = ""
) -> str:
    """Single-pass amendment analysis. Cheaper than the old two-pass approach."""
    system_prompt = SYSTEM_PROMPTS["amendments"]
    prompt = _build_prompt("amendments", amendment_text, mep_name, document_ref)
    return query_llm(prompt, system_prompt)


# ---------------------------------------------------------------------------
# Main analysis pipeline
# ---------------------------------------------------------------------------


def analyze_document(
    document_url: str,
    mep_name: str = "",
    document_ref: str = "",
    force: bool = False,
) -> dict:
    """Full pipeline: download PDF → extract text → LLM → summary.

    The analysis strategy depends on the document type (detected from URL):
      - amendments: filter by MEP name, summarize their position (requires mep_name)
      - draft_report: summarize the lead committee's direction
      - opinion: summarize the opinion committee's stance
      - commission: summarize the proposal
      - other: general summary

    Args:
        document_url: URL of the PDF document
        mep_name: Full name of the MEP (required for amendments, optional otherwise)
        document_ref: Optional document reference string
        force: If True, bypass cache

    Returns:
        Dict with 'analysis', 'doc_type', 'document_url', etc.
    """
    doc_type = detect_document_type(document_url)

    # Check cache
    cache_mep = mep_name if doc_type == "amendments" else ""
    key = _cache_key(cache_mep, document_url)
    if not force:
        cache = _load_analysis_cache()
        if key in cache and isinstance(cache[key], dict):
            logger.info(f"Cache hit for {document_url}")
            return cache[key]

    logger.info(f"Analyzing {document_url} (type: {doc_type})")

    # Step 1: Download PDF
    try:
        pdf_bytes = download_pdf(document_url)
    except Exception as e:
        return {
            "error": f"Failed to download PDF: {str(e)}",
            "mep_name": mep_name,
            "document_url": document_url,
            "doc_type": doc_type,
            "doc_type_label": DOC_TYPES.get(doc_type, "Document"),
        }

    # Step 2: Extract text
    try:
        full_text = extract_text_from_pdf(pdf_bytes)
    except Exception as e:
        return {
            "error": f"Failed to extract text from PDF: {str(e)}",
            "mep_name": mep_name,
            "document_url": document_url,
            "doc_type": doc_type,
            "doc_type_label": DOC_TYPES.get(doc_type, "Document"),
        }

    if not full_text.strip():
        return {
            "error": "PDF appears to be empty or image-only (no extractable text)",
            "mep_name": mep_name,
            "document_url": document_url,
            "doc_type": doc_type,
            "doc_type_label": DOC_TYPES.get(doc_type, "Document"),
        }

    # Step 3: Prepare text for LLM based on document type
    if doc_type == "amendments":
        if not mep_name:
            return {
                "error": "MEP name is required to analyze amendment documents. "
                "Select an MEP first.",
                "document_url": document_url,
                "doc_type": doc_type,
                "doc_type_label": DOC_TYPES.get(doc_type, "Document"),
            }
        analysis_text = extract_mep_amendments(full_text, mep_name)
        if not analysis_text:
            return {
                "error": f"No amendments by {mep_name} found in this document",
                "mep_name": mep_name,
                "document_url": document_url,
                "doc_type": doc_type,
                "doc_type_label": DOC_TYPES.get(doc_type, "Document"),
                "full_document_length": len(full_text),
            }
        text_for_llm = analysis_text
    else:
        # For non-amendment docs, use the full text (truncated if needed)
        text_for_llm = truncate_text(full_text)

    # Step 4: Query LLM
    try:
        if doc_type == "amendments":
            analysis = _analyze_amendments(text_for_llm, mep_name, document_ref)
        else:
            system_prompt = SYSTEM_PROMPTS.get(doc_type, SYSTEM_PROMPTS["other"])
            prompt = _build_prompt(doc_type, text_for_llm, mep_name, document_ref)
            analysis = query_llm(prompt, system_prompt)
    except Exception as e:
        return {
            "error": f"LLM query failed: {str(e)}",
            "mep_name": mep_name,
            "document_url": document_url,
            "doc_type": doc_type,
            "doc_type_label": DOC_TYPES.get(doc_type, "Document"),
        }

    # Build result
    result = {
        "analysis": analysis,
        "mep_name": mep_name,
        "document_url": document_url,
        "document_ref": document_ref,
        "doc_type": doc_type,
        "doc_type_label": DOC_TYPES.get(doc_type, "Document"),
        "amendments_found": text_for_llm.count("Amendment")
        if doc_type == "amendments"
        else None,
        "amendments_text_length": len(text_for_llm)
        if doc_type == "amendments"
        else None,
        "analysis_text_length": len(text_for_llm),
        "full_document_length": len(full_text),
        "llm_provider": os.environ.get("LLM_PROVIDER", "ollama"),
        "analyzed_at": datetime.now().isoformat(),
    }

    # Save to cache
    cache = _load_analysis_cache()
    cache[key] = result
    _save_analysis_cache(cache)

    return result


# ---------------------------------------------------------------------------
# CLI for testing
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import sys

    logging.basicConfig(level=logging.INFO)

    if len(sys.argv) < 2:
        print(
            "Usage: python -m api.document_analyzer <document_url> [mep_name] [document_ref]"
        )
        print()
        print("Examples:")
        print("  # Amendment analysis (requires MEP name):")
        print(
            "  python -m api.document_analyzer "
            '"https://www.europarl.europa.eu/doceo/document/ECON-AM-781235_EN.pdf" '
            '"Fernando Navarrete Rojas"'
        )
        print()
        print("  # Commission proposal summary (no MEP needed):")
        print(
            "  python -m api.document_analyzer "
            '"https://www.europarl.europa.eu/RegData/docs_autres_institutions/'
            'commission_europeenne/com/2023/0369/COM_COM(2023)0369_EN.pdf"'
        )
        sys.exit(1)

    url = sys.argv[1]
    mep = sys.argv[2] if len(sys.argv) > 2 else ""
    ref = sys.argv[3] if len(sys.argv) > 3 else ""

    doc_type = detect_document_type(url)
    print(f"Document type: {DOC_TYPES.get(doc_type, doc_type)}")
    if mep:
        print(f"MEP: {mep}")
    print(f"URL: {url}")
    print(f"Provider: {os.environ.get('LLM_PROVIDER', 'ollama')}")
    print()

    result = analyze_document(url, mep, ref, force=True)

    if "error" in result:
        print(f"ERROR: {result['error']}")
    else:
        if result.get("amendments_found"):
            print(f"Amendments found: {result['amendments_found']}")
        print(
            f"Text analyzed: {result['analysis_text_length']} chars "
            f"(from {result['full_document_length']} total)"
        )
        print()
        print(result["analysis"])
