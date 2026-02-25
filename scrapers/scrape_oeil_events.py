#!/usr/bin/env python3
"""
Scraper for OEIL (Legislative Observatory) procedure events.

Extracts Key Events and Documentation Gateway items from OEIL procedure pages.
These events can be overlaid on the meeting timeline to show legislative milestones.

Usage:
    python -m scrapers.scrape_oeil_events 2023/0212(COD)
"""

import re
import sys
import json
import requests
from datetime import datetime
from bs4 import BeautifulSoup

from scrapers.scraper_cache import load_cache, save_cache

OEIL_BASE_URL = "https://oeil.europarl.europa.eu/oeil/en/procedure-file"
CACHE_NAME = "oeil_events"
CACHE_TTL_HOURS = 24


def _parse_date(date_str: str) -> str | None:
    """Convert DD/MM/YYYY to ISO YYYY-MM-DD. Returns None on failure."""
    date_str = date_str.strip()
    for fmt in ("%d/%m/%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(date_str, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return None


def _find_section_heading(soup: BeautifulSoup, keyword: str):
    """Find an h2/h3 section heading containing the keyword.

    Searches only heading tags to avoid matching large container divs.
    Checks that the heading text is short (a real heading, not a container).
    """
    for tag in soup.find_all(["h2", "h3"]):
        text = tag.get_text(strip=True).lower()
        if keyword in text and len(text) < 80:
            return tag
    return None


def _extract_key_events(soup: BeautifulSoup) -> list[dict]:
    """Extract Key Events table from the OEIL page."""
    events = []

    heading = _find_section_heading(soup, "key events")
    if not heading:
        return events

    # Find the next table after the heading
    table = heading.find_next("table")
    if not table:
        return events

    rows = table.find_all("tr")
    for row in rows:
        cells = row.find_all(["td", "th"])
        if len(cells) < 2:
            continue

        cell_texts = [c.get_text(strip=True) for c in cells]

        # Skip header rows
        if any(h in cell_texts[0].lower() for h in ["date", "datum"]):
            continue

        date_iso = _parse_date(cell_texts[0])
        if not date_iso:
            continue

        event_desc = cell_texts[1] if len(cells) > 1 else ""
        reference = cell_texts[2] if len(cells) > 2 else ""

        # Extract any link from the reference cell
        ref_link = None
        if len(cells) > 2:
            link_tag = cells[2].find("a")
            if link_tag and link_tag.get("href"):
                ref_link = link_tag["href"]

        events.append({
            "date": date_iso,
            "event": event_desc,
            "reference": reference,
            "link": ref_link,
            "category": "key_event",
        })

    return events


def _extract_documentation_gateway(soup: BeautifulSoup) -> list[dict]:
    """Extract Documentation Gateway tables from the OEIL page."""
    docs = []

    heading = _find_section_heading(soup, "documentation gateway")
    if not heading:
        return docs

    # Collect all tables between this heading and the next h2 heading
    tables = []
    element = heading.find_next()
    while element:
        # Stop at the next h2 section heading (but not our own)
        if element.name == "h2" and element != heading:
            text = element.get_text(strip=True).lower()
            if "documentation gateway" not in text and len(text) < 80:
                break
        if element.name == "table":
            tables.append(element)
        element = element.find_next()

    # Track which institution subsection we're in
    current_source = ""

    for table in tables:
        # Check for a preceding institution heading
        prev = table.find_previous(["h3", "h4", "h5", "strong", "b"])
        if prev:
            source_text = prev.get_text(strip=True)
            if any(kw in source_text.lower() for kw in [
                "parliament", "commission", "national", "council",
                "other institution", "ecb", "committee of the regions",
                "economic and social"
            ]):
                current_source = source_text

        rows = table.find_all("tr")
        for row in rows:
            cells = row.find_all(["td", "th"])
            if len(cells) < 2:
                continue

            cell_texts = [c.get_text(strip=True) for c in cells]

            # Skip header rows (first cell is a column name like "Document type")
            first_lower = cell_texts[0].lower()
            if first_lower in [
                "document type", "institution/body", "source",
            ] or first_lower == "date":
                continue

            # Try to find a date in any cell
            date_iso = None
            doc_type = ""
            reference = ""
            committee = ""

            for i, text in enumerate(cell_texts):
                parsed = _parse_date(text)
                if parsed:
                    date_iso = parsed
                elif re.match(r'^(PE|COM|SWD|SEC|CON|CES|GEDA|A\d|T\d|SP\(|\d{4,})', text):
                    reference = text
                elif re.match(r'^[A-Z]{3,5}$', text):
                    committee = text
                elif not doc_type and len(text) > 3:
                    doc_type = text

            if not date_iso:
                continue

            # Extract links
            ref_link = None
            for cell in cells:
                link_tag = cell.find("a")
                if link_tag and link_tag.get("href"):
                    ref_link = link_tag["href"]
                    break

            docs.append({
                "date": date_iso,
                "doc_type": doc_type,
                "reference": reference,
                "committee": committee,
                "source": current_source,
                "link": ref_link,
                "category": "documentation",
            })

    return docs


def scrape_procedure_events(ref: str) -> dict:
    """Scrape OEIL procedure page for key events and documentation gateway items.

    Args:
        ref: Procedure reference, e.g. '2023/0212(COD)'

    Returns:
        Dict with 'key_events' and 'documentation_gateway' lists
    """
    url = f"{OEIL_BASE_URL}?reference={ref}"

    resp = requests.get(url, timeout=30, headers={
        "User-Agent": "Mozilla/5.0 (research-tool; EU Parliament data)",
        "Accept": "text/html",
    })
    resp.raise_for_status()

    soup = BeautifulSoup(resp.text, "html.parser")

    # Extract procedure title: on OEIL pages, the first h2 is the code,
    # the second h2 is the human-readable title
    title = ""
    h2s = soup.find_all("h2")
    if len(h2s) >= 2:
        title = h2s[1].get_text(strip=True)

    key_events = _extract_key_events(soup)
    documentation = _extract_documentation_gateway(soup)

    return {
        "procedure": ref,
        "title": title,
        "key_events": key_events,
        "documentation_gateway": documentation,
        "scraped_at": datetime.now().isoformat(),
    }


def get_procedure_events(ref: str, force: bool = False) -> dict:
    """Get procedure events with caching.

    Args:
        ref: Procedure reference, e.g. '2023/0212(COD)'
        force: If True, bypass cache

    Returns:
        Dict with 'key_events' and 'documentation_gateway' lists
    """
    cache = load_cache(CACHE_NAME)

    if not force and ref in cache:
        entry = cache[ref]
        # Re-scrape old entries missing the title field
        if "title" not in entry:
            force = True
        else:
            # Check TTL
            scraped_at = entry.get("scraped_at", "")
            if scraped_at:
                try:
                    age = datetime.now() - datetime.fromisoformat(scraped_at)
                    if age.total_seconds() < CACHE_TTL_HOURS * 3600:
                        return entry
                except ValueError:
                    pass

    # Scrape fresh data
    result = scrape_procedure_events(ref)

    # Save to cache
    cache[ref] = result
    save_cache(CACHE_NAME, cache)

    return result


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python -m scrapers.scrape_oeil_events <procedure_ref>")
        print("Example: python -m scrapers.scrape_oeil_events 2023/0212(COD)")
        sys.exit(1)

    ref = sys.argv[1]
    print(f"Scraping OEIL events for {ref}...")
    result = get_procedure_events(ref, force=True)
    print(json.dumps(result, indent=2))
    print(f"\nFound {len(result['key_events'])} key events, "
          f"{len(result['documentation_gateway'])} documentation items")
