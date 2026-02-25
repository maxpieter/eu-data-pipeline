#!/usr/bin/env python3
"""
Shared caching utilities for all scrapers.
Tracks what has been scraped to avoid duplicate work.
"""

import json
import hashlib
from datetime import datetime
from pathlib import Path
from typing import Optional

CACHE_DIR = Path(__file__).parent.parent / "data" / ".scraper_cache"


def get_cache_path(scraper_name: str) -> Path:
    """Get cache file path for a scraper."""
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    return CACHE_DIR / f"{scraper_name}_cache.json"


def load_cache(scraper_name: str) -> dict:
    """Load cache for a scraper."""
    cache_path = get_cache_path(scraper_name)
    if cache_path.exists():
        try:
            with open(cache_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except (json.JSONDecodeError, IOError):
            return {}
    return {}


def save_cache(scraper_name: str, cache: dict):
    """Save cache for a scraper."""
    cache_path = get_cache_path(scraper_name)
    cache["_last_updated"] = datetime.now().isoformat()
    with open(cache_path, "w", encoding="utf-8") as f:
        json.dump(cache, f, indent=2, ensure_ascii=False)


def make_row_hash(row: list, header: list) -> str:
    """Create a hash for a CSV row based on ALL fields (not just key fields).

    This prevents duplicate rows even if they have slightly different formatting.
    """
    # Normalize: strip whitespace, lowercase
    normalized = [str(v).strip().lower() for v in row]
    content = "|".join(normalized)
    return hashlib.md5(content.encode()).hexdigest()


def make_meeting_key(row: list, header: list) -> str:
    """Create unique key for a meeting based on identifying fields.

    Key fields: member_id, meeting_date, title, attendees
    This ensures the same meeting with same attendee isn't added twice,
    but allows different attendees at the same meeting to be recorded separately.
    """
    try:
        member_id = row[header.index("member_id")] if "member_id" in header else ""
        meeting_date = row[header.index("meeting_date")] if "meeting_date" in header else ""
        title = row[header.index("title")] if "title" in header else ""
        attendees = row[header.index("attendees")] if "attendees" in header else ""
        lobbyist_id = row[header.index("lobbyist_id")] if "lobbyist_id" in header else ""

        # Normalize
        key_parts = [
            str(member_id).strip(),
            str(meeting_date).strip(),
            str(title).strip().lower(),
            str(attendees).strip().lower(),
            str(lobbyist_id).strip(),
        ]
        return "|".join(key_parts)
    except (ValueError, IndexError):
        # Fallback to all fields
        return "|".join(str(v).strip() for v in row)


class MeetingsScraperCache:
    """Cache for MEP meetings scraper.

    Tracks:
    - Date ranges that have been fully scraped
    - Individual meeting keys to avoid duplicates
    """

    def __init__(self):
        self.scraper_name = "mep_meetings"
        self.cache = load_cache(self.scraper_name)
        self._ensure_structure()

    def _ensure_structure(self):
        """Ensure cache has required structure."""
        if "scraped_date_ranges" not in self.cache:
            self.cache["scraped_date_ranges"] = []
        if "last_full_scrape" not in self.cache:
            self.cache["last_full_scrape"] = None

    def is_date_range_scraped(self, from_date: str, to_date: str) -> bool:
        """Check if a date range has already been scraped."""
        key = f"{from_date}|{to_date}"
        return key in self.cache.get("scraped_date_ranges", [])

    def mark_date_range_scraped(self, from_date: str, to_date: str):
        """Mark a date range as scraped."""
        key = f"{from_date}|{to_date}"
        if key not in self.cache["scraped_date_ranges"]:
            self.cache["scraped_date_ranges"].append(key)

    def mark_full_scrape_complete(self):
        """Mark that a full scrape was completed."""
        self.cache["last_full_scrape"] = datetime.now().isoformat()

    def get_last_full_scrape(self) -> Optional[str]:
        """Get timestamp of last full scrape."""
        return self.cache.get("last_full_scrape")

    def save(self):
        """Save cache to disk."""
        save_cache(self.scraper_name, self.cache)

    def clear(self):
        """Clear all cached data."""
        self.cache = {}
        self._ensure_structure()
        self.save()


class MepScraperCache:
    """Cache for MEP info scraper.

    Tracks:
    - Which MEP IDs have been scraped
    - Last scrape timestamp
    """

    def __init__(self):
        self.scraper_name = "mep_info"
        self.cache = load_cache(self.scraper_name)
        self._ensure_structure()

    def _ensure_structure(self):
        """Ensure cache has required structure."""
        if "scraped_mep_ids" not in self.cache:
            self.cache["scraped_mep_ids"] = []
        if "last_scrape" not in self.cache:
            self.cache["last_scrape"] = None

    def is_mep_scraped(self, mep_id: str) -> bool:
        """Check if an MEP has been scraped."""
        return str(mep_id) in self.cache.get("scraped_mep_ids", [])

    def mark_mep_scraped(self, mep_id: str):
        """Mark an MEP as scraped."""
        mep_id = str(mep_id)
        if mep_id not in self.cache["scraped_mep_ids"]:
            self.cache["scraped_mep_ids"].append(mep_id)

    def get_scraped_mep_ids(self) -> set[str]:
        """Get all scraped MEP IDs."""
        return set(self.cache.get("scraped_mep_ids", []))

    def save(self):
        """Save cache to disk."""
        save_cache(self.scraper_name, self.cache)

    def clear(self):
        """Clear all cached data."""
        self.cache = {}
        self._ensure_structure()
        self.save()


def load_existing_meeting_keys(csv_path: Path) -> set[str]:
    """Load existing meeting keys from CSV file.

    Returns a set of unique keys for fast duplicate checking.
    """
    import csv

    if not csv_path.exists():
        return set()

    keys = set()
    with open(csv_path, "r", encoding="utf-8") as f:
        reader = csv.reader(f)
        rows = list(reader)

    if not rows:
        return set()

    header = rows[0]
    for row in rows[1:]:
        key = make_meeting_key(row, header)
        keys.add(key)

    return keys


if __name__ == "__main__":
    # Test the cache
    print("Testing MeetingsScraperCache...")
    cache = MeetingsScraperCache()
    print(f"Last full scrape: {cache.get_last_full_scrape()}")
    print(f"Scraped ranges: {len(cache.cache.get('scraped_date_ranges', []))}")

    print("\nTesting MepScraperCache...")
    mep_cache = MepScraperCache()
    print(f"Scraped MEPs: {len(mep_cache.get_scraped_mep_ids())}")
