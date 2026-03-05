#!/usr/bin/env python3
"""
Build meetings_data_clean.json from ep_meetings_all.csv + organizations_preprocessed.json.

Matching strategy (in priority order):
  1. lobbyist_id → org register ID (exact match)
  2. attendee name → org name (case-insensitive exact match)
  3. Unmatched → create synthetic org with deterministic hash ID

Also enriches each meeting with MEP metadata from ep_meps_scraped.csv.

Usage:
    python scripts/build_meetings_json.py
    python scripts/build_meetings_json.py --dry-run   # stats only, no file write
"""

import argparse
import csv
import hashlib
import json
import os
import sys

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(PROJECT_ROOT, "data")

MEETINGS_CSV = os.path.join(DATA_DIR, "ep_meetings_all.csv")
ORGS_JSON = os.path.join(DATA_DIR, "organizations_preprocessed.json")
MEPS_CSV = os.path.join(DATA_DIR, "ep_meps.csv")
OUTPUT_JSON = os.path.join(DATA_DIR, "meetings_data_clean.json")


def load_orgs(path):
    """Load org table and build lookup dicts."""
    with open(path, "r", encoding="utf-8") as f:
        orgs = json.load(f)

    by_id = {}
    by_name = {}
    for o in orgs:
        by_id[o["id"]] = o
        key = o["name"].strip().upper()
        if key not in by_name:
            by_name[key] = o
    return orgs, by_id, by_name


def load_meps(path):
    """Load MEP metadata lookup from ep_meps_scraped.csv."""
    lookup = {}
    if not os.path.exists(path):
        return lookup
    with open(path, "r", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            try:
                mep_id = int(row["id"])
            except (KeyError, ValueError):
                continue
            lookup[mep_id] = {
                "name": row.get("name", ""),
                "country": row.get("country_name", "") or row.get("country", ""),
                "political_group": row.get("political_group", ""),
            }
    return lookup


def make_synthetic_id(name):
    """Deterministic synthetic org ID from attendee name."""
    return "org_" + hashlib.sha256(name.strip().encode("utf-8")).hexdigest()[:16]


def make_meeting_id(mep_id, title, date, attendee):
    """Deterministic meeting ID."""
    key = f"{mep_id}|{title}|{date}|{attendee}"
    return hashlib.sha256(key.encode("utf-8")).hexdigest()


def build_meetings(dry_run=False):
    print("Loading organizations...")
    orgs_list, org_by_id, org_by_name = load_orgs(ORGS_JSON)
    print(f"  {len(orgs_list)} organizations loaded")

    print("Loading MEP metadata...")
    mep_lookup = load_meps(MEPS_CSV)
    print(f"  {len(mep_lookup)} MEPs loaded")

    print("Processing meetings CSV...")
    meetings = []
    new_orgs = {}  # synthetic org_id -> org dict
    stats = {"by_regid": 0, "by_name": 0, "synthetic": 0, "total": 0}

    with open(MEETINGS_CSV, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            stats["total"] += 1

            try:
                mep_id = int(row.get("member_id", 0))
            except (ValueError, TypeError):
                continue

            attendee = row.get("attendees", "").strip()
            if not attendee:
                continue

            lobbyist_id = row.get("lobbyist_id", "").strip()
            title = row.get("title", "").strip()
            meeting_date = row.get("meeting_date", "").strip()

            # Match to organization
            org_id = None
            if lobbyist_id and lobbyist_id in org_by_id:
                org_id = lobbyist_id
                stats["by_regid"] += 1
            elif attendee.upper() in org_by_name:
                org_id = org_by_name[attendee.upper()]["id"]
                stats["by_name"] += 1
            else:
                # Create synthetic org
                org_id = make_synthetic_id(attendee)
                stats["synthetic"] += 1
                if org_id not in new_orgs and org_id not in org_by_id:
                    new_orgs[org_id] = {
                        "id": org_id,
                        "name": attendee,
                        "normalized_name": attendee.upper(),
                        "organization_type": "Unknown",
                        "interests_represented": None,
                        "policy_focus_areas": [],
                        "country": None,
                    }

            mep_info = mep_lookup.get(mep_id, {})

            meetings.append({
                "id": make_meeting_id(mep_id, title, meeting_date, attendee),
                "mep_id": mep_id,
                "organization_id": org_id,
                "meeting_date": meeting_date,
                "title": title,
                "location": None,
                "capacity": row.get("member_capacity", ""),
                "related_procedure": row.get("procedure_reference", "").strip() or None,
                "committee_acronym": None,
                "meeting_purpose": None,
                "policy_area": None,
                "meeting_type": None,
                "transparency_level": None,
                "source_data": {
                    "mep_name": row.get("member_name", mep_info.get("name", "")),
                    "mep_country": mep_info.get("country", ""),
                    "mep_political_group": mep_info.get("political_group", ""),
                    "original_meeting": {
                        "title": title,
                        "date": meeting_date,
                        "location": None,
                        "capacity": row.get("member_capacity", ""),
                        "meeting_with": attendee,
                        "transparency_register_id": lobbyist_id or None,
                        "related_procedure": row.get("procedure_reference", "").strip() or None,
                        "committee_acronym": None,
                    },
                    "original_meeting_with": attendee,
                    "original_transparency_register_id": lobbyist_id or None,
                    "final_transparency_register_id": lobbyist_id if lobbyist_id and lobbyist_id in org_by_id else None,
                },
                "processed_at": None,
                "created_at": None,
            })

    print(f"\n=== Results ===")
    print(f"CSV rows processed: {stats['total']}")
    print(f"Meetings generated: {len(meetings)}")
    print(f"Matched by register ID: {stats['by_regid']} ({stats['by_regid']/len(meetings)*100:.1f}%)")
    print(f"Matched by exact name: {stats['by_name']} ({stats['by_name']/len(meetings)*100:.1f}%)")
    print(f"Synthetic (new orgs): {stats['synthetic']} ({stats['synthetic']/len(meetings)*100:.1f}%)")
    print(f"New synthetic org entries: {len(new_orgs)}")

    unique_meps = len(set(m["mep_id"] for m in meetings))
    unique_orgs = len(set(m["organization_id"] for m in meetings))
    print(f"Unique MEPs: {unique_meps}")
    print(f"Unique organizations: {unique_orgs}")

    dates = sorted(set(m["meeting_date"] for m in meetings if m["meeting_date"]))
    print(f"Date range: {dates[0]} to {dates[-1]}")

    if dry_run:
        print("\n[DRY RUN] No files written.")
        return

    # Update organizations_preprocessed.json with new synthetic orgs
    if new_orgs:
        print(f"\nAppending {len(new_orgs)} synthetic orgs to organizations_preprocessed.json...")
        # Add minimal fields to match existing schema
        for org in new_orgs.values():
            org.setdefault("eu_transparency_register_id", org["id"])
            org.setdefault("official_name", org["name"])
            org.setdefault("acronym", None)
            org.setdefault("website", None)
            org.setdefault("description", None)
            org.setdefault("city", None)
            org.setdefault("address", None)
            org.setdefault("post_code", None)
            org.setdefault("form_of_entity", None)
            org.setdefault("employee_count_range", None)
            org.setdefault("annual_revenue_range", None)
            org.setdefault("totalBudget", None)
            org.setdefault("source_of_funding", None)
            org.setdefault("founding_year", None)
            org.setdefault("key_personnel", [])
            org.setdefault("organisationMembers", [])
            org.setdefault("EULegislativeProposals", None)
            org.setdefault("level_of_interest", None)
            org.setdefault("social_media", {})
            org.setdefault("logo_url", None)
            org.setdefault("total_meetings_count", 0)
            org.setdefault("unique_meps_met", 0)
            org.setdefault("influence_score", None)
            org.setdefault("transparency_score", None)
            org.setdefault("activity_level", None)
            org.setdefault("scraped_at", None)
            org.setdefault("created_at", None)
            org.setdefault("updated_at", None)

        # Remove existing synthetic orgs, add fresh ones
        existing_non_synthetic = [o for o in orgs_list if not o["id"].startswith("org_")]
        updated_orgs = existing_non_synthetic + list(new_orgs.values())
        with open(ORGS_JSON, "w", encoding="utf-8") as f:
            json.dump(updated_orgs, f, ensure_ascii=False)
        print(f"  Written {len(updated_orgs)} orgs ({len(existing_non_synthetic)} existing + {len(new_orgs)} new)")

    # Write meetings JSON
    print(f"\nWriting {len(meetings)} meetings to {OUTPUT_JSON}...")
    with open(OUTPUT_JSON, "w", encoding="utf-8") as f:
        json.dump(meetings, f, ensure_ascii=False)
    print(f"  Done. File size: {os.path.getsize(OUTPUT_JSON) / 1024 / 1024:.1f} MB")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Build meetings_data_clean.json from CSV + org data")
    parser.add_argument("--dry-run", action="store_true", help="Print stats without writing files")
    args = parser.parse_args()
    build_meetings(dry_run=args.dry_run)
