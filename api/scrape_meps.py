#!/usr/bin/env python3
"""
Scrape MEP data from European Parliament Open Data API.
- Gets all MEPs from EP9 and EP10
- Fetches detailed info including committee memberships
- Creates corporate bodies lookup table
"""

import csv
import json
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import requests

# Output paths
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
MEP_FIELDS = ["id", "name", "given_name", "family_name", "country_code", "country_name", "political_group", "gender", "memberships"]

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
    # UK was a member until 2020
    "GBR": "United Kingdom",
}


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

        resp = session.get(url, headers=HEADERS, params=params)
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
        resp = session.get(url, headers=HEADERS, params=params)
        resp.raise_for_status()
        return resp.json()
    except requests.exceptions.HTTPError as e:
        print(f"  Error fetching MEP {mep_id}: {e}")
        return None


def fetch_corporate_bodies(session: requests.Session) -> list[dict]:
    """Fetch all current corporate bodies (committees, delegations, etc.)."""
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
            # label contains the code/notation (e.g., "STOA", "AFET")
            code = body.get("label", "")

            bodies.append({
                "org_id": body.get("id", "").replace("org/", ""),
                "label": code,
                "classification": body.get("type", ""),
            })

        print(f"  Fetched {len(results)} bodies (offset {offset})")

        if len(results) < limit:
            break

        offset += limit
        time.sleep(0.3)

    # Also fetch all body classifications (separate endpoint)
    print("  Fetching all body classifications...")
    classified_bodies = fetch_all_body_classifications(session)
    bodies.extend(classified_bodies)
    print(f"  Added {len(classified_bodies)} classified bodies")

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


def fetch_all_body_classifications(session: requests.Session) -> list[dict]:
    """Fetch bodies for all relevant classifications."""
    classifications = [
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

    all_bodies = []
    for cls in classifications:
        print(f"    Fetching {cls}...", end=" ", flush=True)
        bodies = fetch_bodies_by_classification(session, cls)
        print(f"{len(bodies)} bodies")
        all_bodies.extend(bodies)
        time.sleep(0.3)

    return all_bodies


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
    # Format: "http://publications.europa.eu/resource/authority/country/ESP"
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
        membership["classification"] = classification.replace("def/ep-entities/", "") if classification else ""

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


def load_existing_ids() -> set[str]:
    """Load only the IDs from existing CSV."""
    if not OUTPUT_MEPS_CSV.exists():
        return set()

    existing_ids = set()
    with open(OUTPUT_MEPS_CSV, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            existing_ids.add(str(row.get("id", "")))

    return existing_ids


def append_meps_to_csv(meps: list[dict]):
    """Append new MEPs to CSV file."""
    file_exists = OUTPUT_MEPS_CSV.exists()

    with open(OUTPUT_MEPS_CSV, "a", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=MEP_FIELDS)

        if not file_exists:
            writer.writeheader()

        for mep in meps:
            row = {**mep, "memberships": json.dumps(mep["memberships"], ensure_ascii=False)}
            writer.writerow(row)


def scrape_all():
    """Main scraping function."""
    session = requests.Session()
    OUTPUT_DIR.mkdir(exist_ok=True)

    # Load existing IDs to skip (memory efficient)
    existing_ids = load_existing_ids()
    if existing_ids:
        print(f"Found {len(existing_ids)} existing MEPs in CSV (will skip)")
        print()

    # Step 1: Fetch corporate bodies
    print("=" * 50)
    print("Step 1: Fetching corporate bodies...")
    print("=" * 50)
    bodies = fetch_corporate_bodies(session)
    print(f"Total corporate bodies: {len(bodies)}")

    with open(OUTPUT_BODIES_CSV, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=["org_id", "label", "classification"])
        writer.writeheader()
        writer.writerows(bodies)
    print(f"Saved to: {OUTPUT_BODIES_CSV}")

    org_lookup = {b["org_id"]: b for b in bodies}

    # Step 2: Fetch all MEP IDs from EP9 and EP10
    print()
    print("=" * 50)
    print("Step 2: Fetching MEP IDs for EP9 and EP10...")
    print("=" * 50)

    all_mep_ids = set()
    for term in [9, 10]:
        ids = fetch_mep_ids(term, session)
        all_mep_ids.update(ids)
        print(f"  Term {term}: {len(ids)} MEPs")
        time.sleep(0.5)

    print(f"Total unique MEPs: {len(all_mep_ids)}")

    # Step 3: Fetch detailed info for each MEP (parallelized)
    print()
    print("=" * 50)
    print("Step 3: Fetching detailed MEP info (parallel)...")
    print("=" * 50)

    # Filter out already scraped MEPs
    mep_ids_to_fetch = sorted([mid for mid in all_mep_ids if mid not in existing_ids])
    skipped = len(all_mep_ids) - len(mep_ids_to_fetch)
    if skipped > 0:
        print(f"  Skipping {skipped} MEPs already in CSV")

    total = len(mep_ids_to_fetch)
    if total == 0:
        print("  No new MEPs to fetch!")
        return

    print(f"  Fetching {total} MEPs with 10 parallel workers...")

    meps = []
    completed = 0
    errors = 0

    def fetch_and_parse(mep_id: str) -> dict | None:
        mep_data = fetch_mep_details(mep_id, session)
        if mep_data:
            return parse_mep_data(mep_data, org_lookup)
        return None

    max_workers = 5  # Reduced to avoid rate limiting
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        future_to_mep = {executor.submit(fetch_and_parse, mep_id): mep_id for mep_id in mep_ids_to_fetch}

        for future in as_completed(future_to_mep):
            completed += 1
            mep_id = future_to_mep[future]

            try:
                mep = future.result()
                if mep:
                    meps.append(mep)
                else:
                    errors += 1
            except Exception as e:
                errors += 1
                print(f"  Error for MEP {mep_id}: {e}")

            if completed % 100 == 0 or completed == total:
                print(f"  Progress: {completed}/{total} ({errors} errors)")

    print(f"Successfully fetched {len(meps)} MEPs ({errors} errors)")

    # Step 4: Append new MEPs to CSV
    print()
    print("=" * 50)
    print("Step 4: Saving MEP data...")
    print("=" * 50)

    append_meps_to_csv(meps)
    total_in_csv = len(existing_ids) + len(meps)
    print(f"Appended {len(meps)} new MEPs to: {OUTPUT_MEPS_CSV}")
    print(f"Total MEPs in CSV: {total_in_csv}")

    # Summary
    print()
    print("=" * 50)
    print("SUMMARY")
    print("=" * 50)
    print(f"Corporate bodies: {len(bodies)}")
    print(f"MEPs fetched: {len(meps)}")
    print(f"Total in CSV: {total_in_csv}")

    classification_counts = {}
    for mep in meps:
        for m in mep["memberships"]:
            c = m["classification"]
            classification_counts[c] = classification_counts.get(c, 0) + 1

    if classification_counts:
        print("\nMemberships by classification:")
        for c, count in sorted(classification_counts.items(), key=lambda x: -x[1]):
            print(f"  {c}: {count}")


def test_single_mep():
    """Test fetching a single MEP."""
    session = requests.Session()
    mep_id = "257027"

    print(f"Fetching MEP {mep_id}...")
    data = fetch_mep_details(mep_id, session)

    if data:
        print("\nRaw response:")
        print(json.dumps(data, indent=2, ensure_ascii=False)[:3000])

        print("\nParsed:")
        mep = parse_mep_data(data, {})
        print(json.dumps(mep, indent=2, ensure_ascii=False))


def update_mep_labels():
    """Update existing MEP CSV with labels from corporate bodies."""
    session = requests.Session()

    # Load corporate bodies from CSV
    org_lookup = {}
    if OUTPUT_BODIES_CSV.exists():
        with open(OUTPUT_BODIES_CSV, "r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                org_lookup[row["org_id"]] = {
                    "label": row["label"],
                }
        print(f"Loaded {len(org_lookup)} corporate bodies from CSV")

    # Also fetch all body classifications from API
    print("Fetching all body classifications from API...")
    try:
        all_bodies = fetch_all_body_classifications(session)
        for b in all_bodies:
            org_lookup[b["org_id"]] = {
                "label": b["label"],
            }
        print(f"Added {len(all_bodies)} classified bodies")

        # Save all bodies to CSV
        print(f"Saving bodies to {OUTPUT_BODIES_CSV}...")
        with open(OUTPUT_BODIES_CSV, "w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=["org_id", "label", "classification"])
            writer.writeheader()
            writer.writerows(all_bodies)
        print(f"Saved {len(all_bodies)} bodies")

    except Exception as e:
        print(f"Warning: Could not fetch body classifications: {e}")

    print(f"Total in lookup: {len(org_lookup)}")

    # Load and update MEPs
    if not OUTPUT_MEPS_CSV.exists():
        print("MEPs CSV not found.")
        return

    updated_rows = []
    with open(OUTPUT_MEPS_CSV, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            # Parse memberships JSON
            memberships = json.loads(row.get("memberships", "[]"))

            # Update each membership with code from lookup
            political_group = ""
            for m in memberships:
                org_info = org_lookup.get(m.get("org_id", ""), {})
                m["code"] = org_info.get("label", m.get("code", ""))

                # Extract political group name
                if m.get("classification") in ("POLITICAL_GROUP", "EU_POLITICAL_GROUP"):
                    political_group = org_info.get("label", "") or m.get("org_id", "")

            row["memberships"] = json.dumps(memberships, ensure_ascii=False)
            if political_group:
                row["political_group"] = political_group
            updated_rows.append(row)

    # Write back
    with open(OUTPUT_MEPS_CSV, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=MEP_FIELDS)
        writer.writeheader()
        writer.writerows(updated_rows)

    print(f"Updated {len(updated_rows)} MEPs with labels")

    # Show sample
    if updated_rows:
        print(f"\nSample MEP: {updated_rows[0].get('name')}")
        print(f"Political group: {updated_rows[0].get('political_group')}")
        sample = json.loads(updated_rows[0]["memberships"])
        print("\nSample memberships:")
        for m in sample[:5]:
            print(f"  {m.get('classification')}: {m.get('code')}")


def test_corporate_bodies():
    """Test fetching corporate bodies to see raw structure."""
    session = requests.Session()

    url = f"{BASE_URL}/corporate-bodies/show-current"
    params = {"format": "application/ld+json", "limit": 20}

    print("Fetching corporate bodies...")
    resp = session.get(url, headers=HEADERS, params=params)
    resp.raise_for_status()
    data = resp.json()

    print("\nTop-level keys:", list(data.keys()))

    results = data.get("data", [])
    print(f"\nNumber of results in 'data': {len(results)}")

    # Show all bodies
    for i, body in enumerate(results[:20]):
        print(f"\n[{i}] {body}")

    # Check if there's an 'included' section with more details
    included = data.get("included", [])
    if included:
        print(f"\n\n'included' has {len(included)} items")
        for i, item in enumerate(included[:5]):
            print(f"\nIncluded[{i}]: {item}")


def update_countries():
    """Update existing MEP CSV with country codes from API."""
    session = requests.Session()

    if not OUTPUT_MEPS_CSV.exists():
        print("No MEP CSV found. Run full scrape first.")
        return

    # Load existing MEPs
    print("Loading existing MEPs...")
    existing_meps = []
    with open(OUTPUT_MEPS_CSV, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            existing_meps.append(row)

    print(f"Found {len(existing_meps)} MEPs to update")

    # Fetch country for each MEP
    print("\nFetching country data from API...")
    updated = 0
    errors = 0

    for i, mep in enumerate(existing_meps):
        mep_id = mep.get("id")
        if not mep_id:
            continue

        try:
            time.sleep(0.1)  # Rate limiting
            data = fetch_mep_details(mep_id, session)

            if data:
                mep_data = data.get("data", data)
                if isinstance(mep_data, list) and mep_data:
                    mep_data = mep_data[0]

                # Extract country from citizenship
                citizenship = mep_data.get("citizenship", "")
                if isinstance(citizenship, str):
                    country_code = citizenship.split("/")[-1]
                elif isinstance(citizenship, list) and citizenship:
                    country_code = citizenship[0].split("/")[-1]
                else:
                    country_code = ""

                mep["country_code"] = country_code
                mep["country_name"] = COUNTRY_NAMES.get(country_code, country_code)
                updated += 1
            else:
                errors += 1

        except Exception as e:
            errors += 1
            print(f"  Error for MEP {mep_id}: {e}")

        if (i + 1) % 50 == 0:
            print(f"  Progress: {i + 1}/{len(existing_meps)} ({updated} updated, {errors} errors)")

    print(f"\nUpdated {updated} MEPs ({errors} errors)")

    # Write back with new fields
    with open(OUTPUT_MEPS_CSV, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=MEP_FIELDS)
        writer.writeheader()
        writer.writerows(existing_meps)

    print(f"Saved to: {OUTPUT_MEPS_CSV}")

    # Show sample
    if existing_meps:
        sample = existing_meps[0]
        print(f"\nSample: {sample.get('name')}")
        print(f"  Country code: {sample.get('country_code')}")
        print(f"  Country name: {sample.get('country_name')}")


if __name__ == "__main__":
    import sys

    if len(sys.argv) > 1 and sys.argv[1] == "test":
        test_single_mep()
    elif len(sys.argv) > 1 and sys.argv[1] == "test-bodies":
        test_corporate_bodies()
    elif len(sys.argv) > 1 and sys.argv[1] == "update-labels":
        update_mep_labels()
    elif len(sys.argv) > 1 and sys.argv[1] == "update-countries":
        update_countries()
    else:
        scrape_all()
