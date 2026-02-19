#!/usr/bin/env python3
"""
scrape_ep_bodies.py - Scrape EP corporate bodies from the European Parliament Open Data API.

Corporate bodies include:
- Committees (standing, temporary, special, sub, joint)
- Political groups (EU and national)
- Delegations (parliamentary, assembly, joint committee)
- Working groups
- EU institutions

Caching:
- Tracks scraped bodies to avoid duplicates
- Stores in data/.scraper_cache/

Usage:
    python scrape_ep_bodies.py              # scrape all bodies
    python scrape_ep_bodies.py --force      # ignore cache, re-scrape all
    python scrape_ep_bodies.py test         # test fetching a few bodies
    python scrape_ep_bodies.py clear-cache  # clear scraper cache
"""

import csv
import json
import time
from pathlib import Path

import requests

from .scraper_cache import save_cache, load_cache

# Output paths (scrapers/ -> project root -> data/)
OUTPUT_DIR = Path(__file__).parent.parent / "data"
OUTPUT_BODIES_CSV = OUTPUT_DIR / "ep_corporate_bodies.csv"

# API base URL
BASE_URL = "https://data.europarl.europa.eu/api/v2"

# Request headers
HEADERS = {
    "User-Agent": "ThesisResearch-EPdata-1.0",
    "Accept": "application/ld+json",
}

# Body classifications to fetch
BODY_CLASSIFICATIONS = [
    "COMMITTEE_PARLIAMENTARY_STANDING",
    "COMMITTEE_PARLIAMENTARY_TEMPORARY",
    "COMMITTEE_PARLIAMENTARY_SPECIAL",
    "COMMITTEE_PARLIAMENTARY_SUB",
    "COMMITTEE_PARLIAMENTARY_JOINT",
    "EU_POLITICAL_GROUP",
    "NATIONAL_POLITICAL_GROUP",
    "DELEGATION_PARLIAMENTARY",
    "DELEGATION_PARLIAMENTARY_ASSEMBLY",
    "DELEGATION_JOINT_COMMITTEE",
    "NATIONAL_CHAMBER",
    "EU_INSTITUTION",
    "WORKING_GROUP",
]


class BodiesScraperCache:
    """Cache for EP bodies scraper."""

    def __init__(self):
        self.scraper_name = "ep_bodies"
        self.cache = load_cache(self.scraper_name)
        self._ensure_structure()

    def _ensure_structure(self):
        if "scraped_body_ids" not in self.cache:
            self.cache["scraped_body_ids"] = []
        if "last_scrape" not in self.cache:
            self.cache["last_scrape"] = None

    def is_body_scraped(self, body_id: str) -> bool:
        return str(body_id) in self.cache.get("scraped_body_ids", [])

    def mark_body_scraped(self, body_id: str):
        body_id = str(body_id)
        if body_id not in self.cache["scraped_body_ids"]:
            self.cache["scraped_body_ids"].append(body_id)

    def get_scraped_body_ids(self) -> set[str]:
        return set(self.cache.get("scraped_body_ids", []))

    def mark_scrape_complete(self):
        from datetime import datetime
        self.cache["last_scrape"] = datetime.now().isoformat()

    def get_last_scrape(self):
        return self.cache.get("last_scrape")

    def save(self):
        save_cache(self.scraper_name, self.cache)

    def clear(self):
        self.cache = {}
        self._ensure_structure()
        self.save()


def fetch_current_bodies(session: requests.Session) -> list[dict]:
    """Fetch all current corporate bodies."""
    bodies = []
    offset = 0
    limit = 100

    while True:
        url = f"{BASE_URL}/corporate-bodies/show-current"
        params = {
            "format": "application/ld+json",
            "offset": offset,
            "limit": limit,
        }

        resp = session.get(url, headers=HEADERS, params=params)
        resp.raise_for_status()
        data = resp.json()

        results = data.get("data", [])
        if not results:
            break

        for body in results:
            code = body.get("label", "")
            bodies.append({
                "org_id": body.get("id", "").replace("org/", ""),
                "label": code,
                "classification": body.get("type", ""),
            })

        print(f"  Fetched {len(results)} current bodies (offset {offset})")

        if len(results) < limit:
            break

        offset += limit
        time.sleep(0.3)

    return bodies


def fetch_bodies_by_classification(session: requests.Session, classification: str) -> list[dict]:
    """Fetch bodies for a specific classification."""
    bodies = []
    offset = 0
    limit = 100

    while True:
        url = f"{BASE_URL}/corporate-bodies"
        params = {
            "body-classification": classification,
            "format": "application/ld+json",
            "offset": offset,
            "limit": limit,
        }

        try:
            resp = session.get(url, headers=HEADERS, params=params)
            resp.raise_for_status()
            data = resp.json()
        except Exception as e:
            print(f"    Error fetching {classification}: {e}")
            break

        results = data.get("data", [])
        if not results:
            break

        for body in results:
            bodies.append({
                "org_id": body.get("id", "").replace("org/", ""),
                "label": body.get("label", ""),
                "classification": classification,
            })

        if len(results) < limit:
            break

        offset += limit
        time.sleep(0.2)

    return bodies


def fetch_all_classified_bodies(session: requests.Session) -> list[dict]:
    """Fetch bodies for all relevant classifications."""
    all_bodies = []

    for cls in BODY_CLASSIFICATIONS:
        print(f"    Fetching {cls}...", end=" ", flush=True)
        bodies = fetch_bodies_by_classification(session, cls)
        print(f"{len(bodies)} bodies")
        all_bodies.extend(bodies)
        time.sleep(0.3)

    return all_bodies


def load_existing_bodies() -> dict[str, dict]:
    """Load existing bodies from CSV as lookup dict."""
    if not OUTPUT_BODIES_CSV.exists():
        return {}

    lookup = {}
    with open(OUTPUT_BODIES_CSV, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            lookup[row["org_id"]] = {
                "label": row["label"],
                "classification": row["classification"],
            }

    return lookup


def scrape_all(force: bool = False):
    """Main scraping function.

    Args:
        force: If True, re-scrape all bodies even if cached
    """
    session = requests.Session()
    OUTPUT_DIR.mkdir(exist_ok=True)
    cache = BodiesScraperCache()

    # Show cache info
    if not force:
        last_scrape = cache.get_last_scrape()
        if last_scrape:
            print(f"Last scrape: {last_scrape}")
            cached_count = len(cache.get_scraped_body_ids())
            print(f"Cached bodies: {cached_count}")
    else:
        print("FORCE mode: ignoring cache, re-scraping all bodies")

    print()
    print("=" * 50)
    print("Fetching corporate bodies...")
    print("=" * 50)

    # Fetch current bodies
    print("\nFetching current bodies...")
    current_bodies = fetch_current_bodies(session)
    print(f"  Found {len(current_bodies)} current bodies")

    # Fetch all classified bodies
    print("\nFetching bodies by classification...")
    classified_bodies = fetch_all_classified_bodies(session)
    print(f"  Found {len(classified_bodies)} classified bodies")

    # Merge (classified bodies have more info, prefer them)
    all_bodies = {}
    for body in current_bodies:
        all_bodies[body["org_id"]] = body
    for body in classified_bodies:
        all_bodies[body["org_id"]] = body  # Overwrites with better classification

    bodies_list = list(all_bodies.values())

    # Mark all as scraped
    for body in bodies_list:
        cache.mark_body_scraped(body["org_id"])

    cache.mark_scrape_complete()
    cache.save()

    # Save to CSV
    print()
    print("=" * 50)
    print("Saving...")
    print("=" * 50)

    with open(OUTPUT_BODIES_CSV, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=["org_id", "label", "classification"])
        writer.writeheader()
        writer.writerows(bodies_list)

    print(f"Saved {len(bodies_list)} bodies to: {OUTPUT_BODIES_CSV}")

    # Summary by classification
    print("\nBodies by classification:")
    class_counts = {}
    for body in bodies_list:
        cls = body["classification"]
        class_counts[cls] = class_counts.get(cls, 0) + 1

    for cls, count in sorted(class_counts.items(), key=lambda x: -x[1]):
        print(f"  {cls}: {count}")


def test_bodies():
    """Test fetching a few bodies to see the structure."""
    session = requests.Session()

    url = f"{BASE_URL}/corporate-bodies/show-current"
    params = {"format": "application/ld+json", "limit": 10}

    print("Fetching sample corporate bodies...")
    resp = session.get(url, headers=HEADERS, params=params)
    resp.raise_for_status()
    data = resp.json()

    print("\nTop-level keys:", list(data.keys()))

    results = data.get("data", [])
    print(f"\nNumber of results: {len(results)}")

    for i, body in enumerate(results[:5]):
        print(f"\n[{i}] {json.dumps(body, indent=2)}")


def clear_cache():
    """Clear the bodies scraper cache."""
    cache = BodiesScraperCache()
    cache.clear()
    print("Bodies scraper cache cleared")


if __name__ == "__main__":
    import sys

    if len(sys.argv) > 1 and sys.argv[1] == "test":
        test_bodies()
    elif len(sys.argv) > 1 and sys.argv[1] == "clear-cache":
        clear_cache()
    else:
        force = "--force" in sys.argv
        scrape_all(force=force)
