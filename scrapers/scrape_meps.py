#!/usr/bin/env python3
"""
scrape_meps.py - Scrape MEP data from the European Parliament Open Data API.

Scrapes:
- MEP IDs from EP9 and EP10 parliamentary terms
- Detailed MEP info (name, country, gender, memberships)
- Enriches with corporate body labels from ep_corporate_bodies.csv

Prerequisites:
- Run scrape_ep_bodies.py first to get corporate bodies lookup

Caching:
- Tracks which MEPs have been scraped to avoid duplicates
- Stores in data/.scraper_cache/

Usage:
    python scrape_meps.py                   # scrape all MEPs
    python scrape_meps.py --force           # ignore cache, re-scrape all
    python scrape_meps.py test              # test single MEP fetch
    python scrape_meps.py update-labels     # update MEPs with body labels
    python scrape_meps.py update-countries  # update country codes from API
    python scrape_meps.py update-countries --start=600  # resume from MEP #600
    python scrape_meps.py clear-cache       # clear scraper cache
"""

import csv
import json
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import requests

try:
    from .scraper_cache import MepScraperCache
except ImportError:
    from scraper_cache import MepScraperCache

# Output paths (scrapers/ -> project root -> data/)
OUTPUT_DIR = Path(__file__).parent.parent / "data"
OUTPUT_MEPS_CSV = OUTPUT_DIR / "ep_meps.csv"
OUTPUT_BODIES_CSV = OUTPUT_DIR / "ep_corporate_bodies.csv"

# API base URL
BASE_URL = "https://data.europarl.europa.eu/api/v2"

# Request headers
HEADERS = {
    "User-Agent": "ThesisResearch-MEPdata-1.0",
    "Accept": "application/ld+json",
}

# CSV fieldnames
MEP_FIELDS = [
    "id",
    "name",
    "given_name",
    "family_name",
    "country_code",
    "country_name",
    "political_group",
    "gender",
    "memberships",
]

# Country code to name mapping (ISO 3166-1 alpha-3)
COUNTRY_NAMES = {
    "AUT": "Austria",
    "BEL": "Belgium",
    "BGR": "Bulgaria",
    "HRV": "Croatia",
    "CYP": "Cyprus",
    "CZE": "Czechia",
    "DNK": "Denmark",
    "EST": "Estonia",
    "FIN": "Finland",
    "FRA": "France",
    "DEU": "Germany",
    "GRC": "Greece",
    "HUN": "Hungary",
    "IRL": "Ireland",
    "ITA": "Italy",
    "LVA": "Latvia",
    "LTU": "Lithuania",
    "LUX": "Luxembourg",
    "MLT": "Malta",
    "NLD": "Netherlands",
    "POL": "Poland",
    "PRT": "Portugal",
    "ROU": "Romania",
    "SVK": "Slovakia",
    "SVN": "Slovenia",
    "ESP": "Spain",
    "SWE": "Sweden",
    "GBR": "United Kingdom",
}


def load_bodies_lookup() -> dict[str, dict]:
    """Load corporate bodies from CSV as lookup dict.

    Returns dict mapping org_id -> {label, classification}
    """
    if not OUTPUT_BODIES_CSV.exists():
        print(f"Warning: {OUTPUT_BODIES_CSV} not found. Run scrape_ep_bodies.py first.")
        return {}

    lookup = {}
    with open(OUTPUT_BODIES_CSV, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            lookup[row["org_id"]] = {
                "label": row["label"],
                "classification": row.get("classification", ""),
            }

    return lookup


def fetch_mep_ids(term: int, session: requests.Session) -> list[str]:
    """Fetch all MEP IDs for a given parliamentary term."""
    mep_ids = []
    offset = 0
    limit = 100

    while True:
        url = f"{BASE_URL}/meps"
        params = {
            "parliamentary-term": term,
            "format": "application/ld+json",
            "offset": offset,
            "limit": limit,
        }

        resp = session.get(url, headers=HEADERS, params=params, timeout=30)
        resp.raise_for_status()
        data = resp.json()

        results = data.get("data", [])
        if not results:
            break

        for mep in results:
            mep_id = mep.get("identifier") or mep.get("id", "").split("/")[-1]
            if mep_id:
                mep_ids.append(str(mep_id))

        print(f"  Term {term}: fetched {len(results)} MEPs (offset {offset})")

        if len(results) < limit:
            break

        offset += limit
        time.sleep(0.3)

    return mep_ids


def fetch_mep_details(mep_id: str, session: requests.Session) -> dict | None:
    """Fetch detailed info for a single MEP."""
    url = f"{BASE_URL}/meps/{mep_id}"
    params = {"format": "application/ld+json"}

    try:
        time.sleep(0.2)  # Small delay to avoid rate limiting
        resp = session.get(url, headers=HEADERS, params=params, timeout=15)
        resp.raise_for_status()
        return resp.json()
    except requests.exceptions.Timeout:
        print(f"  Timeout fetching MEP {mep_id}")
        return None
    except requests.exceptions.RequestException as e:
        print(f"  Error fetching MEP {mep_id}: {e}")
        return None


def parse_mep_data(mep_data: dict, org_lookup: dict) -> dict:
    """Parse MEP JSON-LD response into flat structure."""
    data = mep_data.get("data", mep_data)

    if isinstance(data, list) and data:
        data = data[0]

    mep = {
        "id": data.get("identifier", ""),
        "name": "",
        "given_name": "",
        "family_name": "",
        "country_code": "",
        "country_name": "",
        "political_group": "",
        "gender": "",
        "memberships": [],
    }

    # Name
    if "label" in data:
        mep["name"] = data["label"]
    elif "prefLabel" in data:
        label = data["prefLabel"]
        mep["name"] = label.get("en", "") if isinstance(label, dict) else label

    mep["given_name"] = data.get("givenName", "")
    mep["family_name"] = data.get("familyName", "")

    if not mep["name"] and mep["given_name"]:
        mep["name"] = f"{mep['given_name']} {mep['family_name']}".strip()

    # Country - extract from citizenship field
    citizenship = data.get("citizenship", "")
    if isinstance(citizenship, str):
        country_code = citizenship.split("/")[-1]
    elif isinstance(citizenship, list) and citizenship:
        country_code = citizenship[0].split("/")[-1]
    else:
        country_code = ""

    mep["country_code"] = country_code
    mep["country_name"] = COUNTRY_NAMES.get(country_code, country_code)

    # Gender
    gender = data.get("hasGender", "")
    if isinstance(gender, dict):
        gender = gender.get("id", "").split("/")[-1]
    elif isinstance(gender, str):
        gender = gender.split("/")[-1]
    mep["gender"] = gender

    # Memberships
    memberships = data.get("hasMembership", [])
    if not isinstance(memberships, list):
        memberships = [memberships] if memberships else []

    for m in memberships:
        membership = {
            "org_id": "",
            "role": "",
            "classification": "",
            "start_date": "",
            "end_date": "",
            "code": "",
        }

        # Organization
        org = m.get("organization", "")
        if isinstance(org, dict):
            org = org.get("id", "")
        membership["org_id"] = org.replace("org/", "") if org else ""

        # Role
        role = m.get("role", "")
        if isinstance(role, dict):
            role = role.get("id", "")
        membership["role"] = role.replace("def/ep-roles/", "") if role else ""

        # Classification
        classification = m.get("membershipClassification", "")
        if isinstance(classification, dict):
            classification = classification.get("id", "")
        membership["classification"] = (
            classification.replace("def/ep-entities/", "") if classification else ""
        )

        # Time period
        period = m.get("memberDuring", {})
        if isinstance(period, dict):
            membership["start_date"] = period.get("startDate", "")
            membership["end_date"] = period.get("endDate", "")

        # Enrich with org lookup
        org_info = org_lookup.get(membership["org_id"], {})
        membership["code"] = org_info.get("label", "")

        # Extract political group
        if membership["classification"] in ("POLITICAL_GROUP", "EU_POLITICAL_GROUP"):
            mep["political_group"] = org_info.get("label", "") or membership["org_id"]

        mep["memberships"].append(membership)

    return mep


def load_existing_meps() -> tuple[set[str], list[dict]]:
    """Load existing MEPs from CSV and cache.

    Returns:
        Tuple of (set of existing IDs, list of existing MEP dicts)
    """
    existing_ids = set()
    existing_meps = []

    # Load from CSV
    if OUTPUT_MEPS_CSV.exists():
        with open(OUTPUT_MEPS_CSV, "r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                mep_id = str(row.get("id", ""))
                existing_ids.add(mep_id)

                # Normalize old schema (single 'country' column) to new schema
                if "country" in row and "country_code" not in row:
                    row["country_code"] = row.pop("country", "")
                    row["country_name"] = COUNTRY_NAMES.get(
                        row["country_code"], row["country_code"]
                    )

                existing_meps.append(row)

    # Also load from cache
    cache = MepScraperCache()
    existing_ids.update(cache.get_scraped_mep_ids())

    return existing_ids, existing_meps


def write_meps_csv(meps: list[dict]):
    """Write all MEPs to CSV file (overwrites existing)."""
    with open(OUTPUT_MEPS_CSV, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=MEP_FIELDS)
        writer.writeheader()

        for mep in meps:
            # Serialize memberships if it's a list
            memberships = mep.get("memberships", [])
            if isinstance(memberships, list):
                memberships = json.dumps(memberships, ensure_ascii=False)

            row = {field: mep.get(field, "") for field in MEP_FIELDS}
            row["memberships"] = memberships
            writer.writerow(row)


def scrape_all(force: bool = False):
    """Main scraping function.

    Args:
        force: If True, re-scrape all MEPs even if they exist in cache/CSV
    """
    session = requests.Session()
    OUTPUT_DIR.mkdir(exist_ok=True)
    cache = MepScraperCache()

    # Load corporate bodies lookup
    org_lookup = load_bodies_lookup()
    if org_lookup:
        print(f"Loaded {len(org_lookup)} corporate bodies for enrichment")
    else:
        print(
            "No corporate bodies loaded - run scrape_ep_bodies.py first for better data"
        )
    print()

    # Load existing MEPs
    if force:
        existing_ids = set()
        existing_meps = []
        print("FORCE mode: ignoring cache, re-scraping all MEPs")
    else:
        existing_ids, existing_meps = load_existing_meps()
        if existing_ids:
            print(f"Found {len(existing_ids)} existing MEPs in CSV/cache (will skip)")
    print()

    # Fetch all MEP IDs from EP9 and EP10
    print("=" * 50)
    print("Fetching MEP IDs for EP9 and EP10...")
    print("=" * 50)

    all_mep_ids = set()
    for term in [9, 10]:
        ids = fetch_mep_ids(term, session)
        all_mep_ids.update(ids)
        print(f"  Term {term}: {len(ids)} MEPs")
        time.sleep(0.5)

    print(f"Total unique MEPs: {len(all_mep_ids)}")

    # Filter out already scraped MEPs
    mep_ids_to_fetch = sorted([mid for mid in all_mep_ids if mid not in existing_ids])
    skipped = len(all_mep_ids) - len(mep_ids_to_fetch)
    if skipped > 0:
        print(f"Skipping {skipped} MEPs already in CSV/cache")

    total = len(mep_ids_to_fetch)
    if total == 0:
        print("No new MEPs to fetch!")
        return

    # Fetch detailed info (parallelized)
    print()
    print("=" * 50)
    print(f"Fetching {total} MEPs (5 parallel workers)...")
    print("=" * 50)

    meps = []
    completed = 0
    errors = 0

    def fetch_and_parse(mep_id: str) -> dict | None:
        mep_data = fetch_mep_details(mep_id, session)
        if mep_data:
            return parse_mep_data(mep_data, org_lookup)
        return None

    max_workers = 5
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        future_to_mep = {
            executor.submit(fetch_and_parse, mep_id): mep_id
            for mep_id in mep_ids_to_fetch
        }

        for future in as_completed(future_to_mep):
            completed += 1
            mep_id = future_to_mep[future]

            try:
                mep = future.result()
                if mep:
                    meps.append(mep)
                    cache.mark_mep_scraped(mep_id)
                else:
                    errors += 1
            except Exception as e:
                errors += 1
                print(f"  Error for MEP {mep_id}: {e}")

            if completed % 100 == 0 or completed == total:
                print(f"  Progress: {completed}/{total} ({errors} errors)")

    cache.save()
    print(f"Successfully fetched {len(meps)} MEPs ({errors} errors)")

    # Save to CSV (rewrite full file to ensure consistent schema)
    print()
    print("=" * 50)
    print("Saving MEP data...")
    print("=" * 50)

    all_meps = existing_meps + meps
    write_meps_csv(all_meps)
    print(f"Added {len(meps)} new MEPs to: {OUTPUT_MEPS_CSV}")
    print(f"Total MEPs in CSV: {len(all_meps)}")

    # Summary
    print()
    print("=" * 50)
    print("SUMMARY")
    print("=" * 50)
    print(f"MEPs fetched: {len(meps)}")
    print(f"Total in CSV: {len(all_meps)}")

    classification_counts = {}
    for mep in meps:
        for m in mep["memberships"]:
            c = m["classification"]
            classification_counts[c] = classification_counts.get(c, 0) + 1

    if classification_counts:
        print("\nMemberships by classification:")
        for c, count in sorted(classification_counts.items(), key=lambda x: -x[1])[:10]:
            print(f"  {c}: {count}")


def test_single_mep():
    """Test fetching a single MEP."""
    session = requests.Session()
    mep_id = "257027"

    print(f"Fetching MEP {mep_id}...")
    data = fetch_mep_details(mep_id, session)

    if data:
        print("\nRaw response (truncated):")
        print(json.dumps(data, indent=2, ensure_ascii=False)[:2000])

        org_lookup = load_bodies_lookup()
        print(f"\nParsed (using {len(org_lookup)} bodies for lookup):")
        mep = parse_mep_data(data, org_lookup)
        print(json.dumps(mep, indent=2, ensure_ascii=False))


def update_mep_labels():
    """Update existing MEP CSV with labels from corporate bodies."""
    org_lookup = load_bodies_lookup()
    if not org_lookup:
        print("No corporate bodies found. Run scrape_ep_bodies.py first.")
        return

    print(f"Loaded {len(org_lookup)} corporate bodies")

    if not OUTPUT_MEPS_CSV.exists():
        print("MEPs CSV not found.")
        return

    _, existing_meps = load_existing_meps()  # Handles schema migration
    print(f"Found {len(existing_meps)} MEPs")

    for row in existing_meps:
        memberships_raw = row.get("memberships", "[]")
        if isinstance(memberships_raw, str):
            memberships = json.loads(memberships_raw)
        else:
            memberships = memberships_raw

        political_group = ""
        for m in memberships:
            org_info = org_lookup.get(m.get("org_id", ""), {})
            m["code"] = org_info.get("label", m.get("code", ""))

            if m.get("classification") in ("POLITICAL_GROUP", "EU_POLITICAL_GROUP"):
                political_group = org_info.get("label", "") or m.get("org_id", "")

        row["memberships"] = (
            memberships  # Keep as list, write_meps_csv handles serialization
        )
        if political_group:
            row["political_group"] = political_group

    write_meps_csv(existing_meps)
    print(f"Updated {len(existing_meps)} MEPs with labels")


def update_countries(start_from: int = 0):
    """Update existing MEP CSV with country codes from API.

    Args:
        start_from: Skip the first N MEPs (for resuming after being rate-limited)
    """
    session = requests.Session()

    if not OUTPUT_MEPS_CSV.exists():
        print("No MEP CSV found. Run full scrape first.")
        return

    print("Loading existing MEPs...")
    _, existing_meps = load_existing_meps()  # This handles schema migration

    # Filter to MEPs missing country info
    meps_to_update = [m for m in existing_meps if not m.get("country_code")]
    print(
        f"Found {len(existing_meps)} MEPs total, {len(meps_to_update)} missing country info"
    )

    if not meps_to_update:
        print("All MEPs already have country info!")
        # Still rewrite to ensure consistent schema
        write_meps_csv(existing_meps)
        print(f"Rewrote CSV with consistent schema to: {OUTPUT_MEPS_CSV}")
        return

    print("\nFetching country data from API...")
    updated = 0
    errors = 0
    skipped = 0

    # Create lookup for quick updates
    mep_lookup = {m.get("id"): m for m in existing_meps}

    for i, mep in enumerate(meps_to_update):
        if i < start_from:
            skipped += 1
            continue

        mep_id = mep.get("id")
        if not mep_id:
            continue

        try:
            print(f"  [{i+1}/{len(meps_to_update)}] Fetching MEP {mep_id}...", end=" ", flush=True)
            data = fetch_mep_details(mep_id, session)

            if data:
                mep_data = data.get("data", data)
                if isinstance(mep_data, list) and mep_data:
                    mep_data = mep_data[0]

                citizenship = mep_data.get("citizenship", "")
                if isinstance(citizenship, str):
                    country_code = citizenship.split("/")[-1]
                elif isinstance(citizenship, list) and citizenship:
                    country_code = citizenship[0].split("/")[-1]
                else:
                    country_code = ""

                # Update in the lookup (which references same dict as existing_meps)
                mep_lookup[mep_id]["country_code"] = country_code
                mep_lookup[mep_id]["country_name"] = COUNTRY_NAMES.get(
                    country_code, country_code
                )
                print(f"{country_code}")
                updated += 1
            else:
                print("FAILED")
                errors += 1

        except Exception as e:
            errors += 1
            print(f"ERROR: {e}")

        # Save progress every 100 MEPs
        if (i + 1) % 100 == 0:
            write_meps_csv(existing_meps)
            print(f"  [Saved progress at {i + 1}]")

    print(f"\nUpdated {updated} MEPs ({errors} errors, {skipped} skipped)")

    write_meps_csv(existing_meps)
    print(f"Saved to: {OUTPUT_MEPS_CSV}")


def clear_cache():
    """Clear the MEP scraper cache."""
    cache = MepScraperCache()
    cache.clear()
    print("MEP scraper cache cleared")


if __name__ == "__main__":
    import sys

    if len(sys.argv) > 1 and sys.argv[1] == "test":
        test_single_mep()
    elif len(sys.argv) > 1 and sys.argv[1] == "update-labels":
        update_mep_labels()
    elif len(sys.argv) > 1 and sys.argv[1] == "update-countries":
        # Parse --start=N argument
        start_from = 0
        for arg in sys.argv[2:]:
            if arg.startswith("--start="):
                start_from = int(arg.split("=")[1])
        update_countries(start_from=start_from)
    elif len(sys.argv) > 1 and sys.argv[1] == "clear-cache":
        clear_cache()
    else:
        force = "--force" in sys.argv
        scrape_all(force=force)
