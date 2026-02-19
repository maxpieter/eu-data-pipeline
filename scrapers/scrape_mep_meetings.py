#!/usr/bin/env python3
"""
scrape_mep_meetings.py - Scrape MEP meetings from the European Parliament website.

Two scraping modes:
1. Pagination-based: Scrape pages 1, 2, 3... of the meetings list
2. Date-range-based: Scrape by week/month intervals (more reliable for historical data)

Caching:
- Tracks scraped date ranges to avoid re-scraping (stored in data/.scraper_cache/)
- Uses full row deduplication (all fields including attendees) to prevent duplicates

Usage:
    python scrape_mep_meetings.py                    # pagination mode from page 1
    python scrape_mep_meetings.py 50 60              # pages 50-60 only
    python scrape_mep_meetings.py dates              # date-range mode from 2019-07
    python scrape_mep_meetings.py dates 2023-01-01   # start from specific date
    python scrape_mep_meetings.py dates --force      # ignore cache, re-scrape all
    python scrape_mep_meetings.py dedup              # deduplicate existing CSV
    python scrape_mep_meetings.py clear-cache        # clear scraper cache
    python scrape_mep_meetings.py test               # test single page fetch
"""

import csv
import io
import time
from datetime import datetime, timedelta
from pathlib import Path

import requests

from .scraper_cache import (
    MeetingsScraperCache,
    make_meeting_key,
    load_existing_meeting_keys,
)

# Output paths
OUTPUT_DIR = Path(__file__).parent.parent / "data"
OUTPUT_CSV = OUTPUT_DIR / "ep_meetings_all.csv"

# API endpoint with CSV export
BASE_URL = "https://www.europarl.europa.eu/meps/en/search-meetings"

# Request headers
HEADERS = {
    "User-Agent": "ThesisResearch-MEPmeetings-1.0",
    "Accept": "text/csv,application/csv,*/*",
    "Accept-Language": "en-GB,en;q=0.8",
}


def fetch_csv_page(page: int, session: requests.Session) -> str:
    """Fetch a single page of meetings as CSV."""
    url = f"{BASE_URL}?page={page}&exportFormat=CSV"
    resp = session.get(url, headers=HEADERS)
    resp.raise_for_status()
    return resp.text


def fetch_csv_by_date(from_date: str, to_date: str, page: int, session: requests.Session) -> str:
    """Fetch meetings for a date range. Dates in dd/MM/yyyy format."""
    url = f"{BASE_URL}?fromDate={from_date}&toDate={to_date}&page={page}&exportFormat=CSV"
    resp = session.get(url, headers=HEADERS)
    resp.raise_for_status()
    return resp.text


def load_existing_data():
    """Load existing CSV and return header, rows, and seen keys."""
    if not OUTPUT_CSV.exists():
        return None, [], set()

    with open(OUTPUT_CSV, "r", encoding="utf-8") as f:
        reader = csv.reader(f)
        rows = list(reader)

    if not rows:
        return None, [], set()

    header = rows[0]
    data_rows = rows[1:]

    # Build set of unique keys for deduplication
    seen_keys = set()
    for row in data_rows:
        key = make_meeting_key(row, header)
        seen_keys.add(key)

    return header, data_rows, seen_keys


def scrape_all_meetings(start_page: int = 1, end_page: int = None, delay: float = 0.5):
    """
    Scrape all meetings by paginating through CSV export.
    Appends to existing file and deduplicates.

    Args:
        start_page: Page to start from (default: 1)
        end_page: Page to stop at (default: None = continue until empty)
        delay: Seconds between requests
    """
    session = requests.Session()

    # Load existing data to avoid duplicates
    header, all_rows, seen_keys = load_existing_data()
    if all_rows:
        print(f"Loaded {len(all_rows)} existing meetings from {OUTPUT_CSV}")
        print(f"Unique keys: {len(seen_keys)}")
        print()

    page = start_page
    empty_pages = 0
    new_count = 0
    dup_count = 0

    print("Starting to scrape all MEP meetings via CSV export...")
    print(f"Output will be saved to: {OUTPUT_CSV}")
    print()

    while True:
        if end_page and page > end_page:
            print(f"Reached end_page limit ({end_page})")
            break

        try:
            print(f"Fetching page {page}...", end=" ", flush=True)
            csv_text = fetch_csv_page(page, session)

            # Parse CSV
            reader = csv.reader(io.StringIO(csv_text))
            rows = list(reader)

            if not rows:
                empty_pages += 1
                print("empty response")
                if empty_pages >= 3:
                    print("3 consecutive empty pages - stopping")
                    break
                page += 1
                time.sleep(delay)
                continue

            # First row is header
            if header is None:
                header = rows[0]
                print(f"Header: {header}")

            # Data rows (skip header on each page)
            data_rows = rows[1:] if rows[0] == header else rows

            if not data_rows:
                empty_pages += 1
                print("no data rows")
                if empty_pages >= 3:
                    print("3 consecutive empty pages - stopping")
                    break
            else:
                empty_pages = 0
                # Deduplicate using full key
                page_new = 0
                page_dup = 0
                for row in data_rows:
                    key = make_meeting_key(row, header)
                    if key not in seen_keys:
                        seen_keys.add(key)
                        all_rows.append(row)
                        page_new += 1
                    else:
                        page_dup += 1

                new_count += page_new
                dup_count += page_dup
                print(f"found {len(data_rows)} ({page_new} new, {page_dup} dups) - total: {len(all_rows)}")

            page += 1
            time.sleep(delay)

        except requests.exceptions.HTTPError as e:
            if e.response.status_code == 404:
                print("404 - reached end")
                break
            print(f"HTTP error: {e}")
            break
        except Exception as e:
            print(f"Error: {e}")
            break

    print()
    print("=" * 50)
    print(f"Total meetings in file: {len(all_rows)}")
    print(f"New meetings added: {new_count}")
    print(f"Duplicates skipped: {dup_count}")

    # Save to CSV
    OUTPUT_DIR.mkdir(exist_ok=True)
    with open(OUTPUT_CSV, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(header)
        writer.writerows(all_rows)

    print(f"Saved to: {OUTPUT_CSV}")

    # Print summary stats
    if all_rows and header:
        print()
        print("Sample of first 3 rows:")
        for row in all_rows[:3]:
            print(f"  {dict(zip(header, row))}")

        # Date range
        date_idx = header.index("meeting_date") if "meeting_date" in header else -1
        if date_idx >= 0:
            dates = sorted([r[date_idx] for r in all_rows if r[date_idx]])
            if dates:
                print(f"\nDate range: {dates[0]} to {dates[-1]}")

    return all_rows


def scrape_by_date_ranges(
    start_date: str = "2019-07-01",
    end_date: str = None,
    delay: float = 0.3,
    interval: str = "week",
    force: bool = False,
):
    """
    Scrape all meetings using date ranges to get complete historical data.

    Args:
        start_date: Start date in YYYY-MM-DD format (default: 2019-07-01 when obligation started)
        end_date: End date in YYYY-MM-DD (default: today + 1 year for future meetings)
        delay: Seconds between requests
        interval: "week" or "month" - size of date chunks
        force: If True, ignore cache and re-scrape all ranges
    """
    session = requests.Session()
    cache = MeetingsScraperCache()

    # Parse dates
    start = datetime.strptime(start_date, "%Y-%m-%d")
    if end_date:
        end = datetime.strptime(end_date, "%Y-%m-%d")
    else:
        end = datetime.now() + timedelta(days=365)

    # Load existing data
    header, all_rows, seen_keys = load_existing_data()
    if all_rows:
        print(f"Loaded {len(all_rows)} existing meetings from {OUTPUT_CSV}")
        print(f"Unique keys: {len(seen_keys)}")

    # Show cache info
    last_scrape = cache.get_last_full_scrape()
    if last_scrape and not force:
        print(f"Last full scrape: {last_scrape}")
        cached_ranges = len(cache.cache.get("scraped_date_ranges", []))
        print(f"Cached date ranges: {cached_ranges}")

    new_count = 0
    dup_count = 0
    skipped_ranges = 0

    print()
    print(f"Scraping MEP meetings from {start.date()} to {end.date()} ({interval}ly)")
    print(f"Output: {OUTPUT_CSV}")
    if force:
        print("FORCE mode: ignoring cache, re-scraping all ranges")
    print()

    # Iterate through intervals
    current = start
    while current < end:
        # Calculate interval end
        if interval == "week":
            interval_end = min(current + timedelta(days=7), end)
        else:  # month
            if current.month == 12:
                interval_end = min(datetime(current.year + 1, 1, 1) - timedelta(days=1), end)
            else:
                interval_end = min(datetime(current.year, current.month + 1, 1) - timedelta(days=1), end)

        from_str = current.strftime("%d/%m/%Y")
        to_str = interval_end.strftime("%d/%m/%Y")

        # Check cache - skip if already scraped (unless forcing)
        if not force and cache.is_date_range_scraped(from_str, to_str):
            skipped_ranges += 1
            current = interval_end + timedelta(days=1)
            continue

        # Paginate within this interval
        page = 1
        interval_new = 0
        max_pages = 100  # Safety limit to prevent infinite loops

        while page <= max_pages:
            try:
                print(f"{current.strftime('%Y-%m-%d')} to {interval_end.strftime('%Y-%m-%d')} p{page}...", end=" ", flush=True)
                csv_text = fetch_csv_by_date(from_str, to_str, page, session)

                reader = csv.reader(io.StringIO(csv_text))
                rows = list(reader)

                if not rows or len(rows) <= 1:
                    print("empty")
                    break

                # Set header from first response
                if header is None:
                    header = rows[0]
                    print(f"Header: {header}")

                # Data rows (skip header)
                data_rows = rows[1:] if rows[0] == header else rows

                if not data_rows:
                    print("no data")
                    break

                # Deduplicate using full key (includes attendees)
                page_new = 0
                page_dup = 0
                for row in data_rows:
                    key = make_meeting_key(row, header)
                    if key not in seen_keys:
                        seen_keys.add(key)
                        all_rows.append(row)
                        page_new += 1
                    else:
                        page_dup += 1

                new_count += page_new
                dup_count += page_dup
                interval_new += page_new
                print(f"{len(data_rows)} rows ({page_new} new, {page_dup} dup)")

                # Stop conditions:
                # 1. Less than expected rows per page (< 1000 suggests last page)
                # 2. All rows are duplicates (0 new) - pagination might be looping
                # 3. No data rows
                if len(data_rows) < 1000:
                    break
                if page_new == 0:
                    print(f"  -> All duplicates on page {page}, stopping pagination for this range")
                    break

                page += 1
                time.sleep(delay)

            except requests.exceptions.HTTPError as e:
                print(f"HTTP error: {e}")
                break
            except Exception as e:
                print(f"Error: {e}")
                break

        # Mark this range as scraped
        cache.mark_date_range_scraped(from_str, to_str)

        # Move to next interval
        current = interval_end + timedelta(days=1)
        time.sleep(delay)

    # Mark full scrape complete and save cache
    cache.mark_full_scrape_complete()
    cache.save()

    print()
    print("=" * 50)
    print(f"Total meetings: {len(all_rows)}")
    print(f"New: {new_count}, Duplicates skipped: {dup_count}")
    if skipped_ranges > 0:
        print(f"Cached ranges skipped: {skipped_ranges}")

    # Save
    OUTPUT_DIR.mkdir(exist_ok=True)
    with open(OUTPUT_CSV, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(header)
        writer.writerows(all_rows)

    print(f"Saved to: {OUTPUT_CSV}")

    # Date range summary
    if all_rows and header:
        date_idx = header.index("meeting_date") if "meeting_date" in header else -1
        if date_idx >= 0:
            dates = sorted([r[date_idx] for r in all_rows if r[date_idx]])
            if dates:
                print(f"Date range: {dates[0]} to {dates[-1]}")

    return all_rows


def deduplicate_existing():
    """Deduplicate the existing CSV file."""
    if not OUTPUT_CSV.exists():
        print("No CSV file to deduplicate")
        return

    header, all_rows, seen_keys = load_existing_data()
    original_count = len(all_rows)

    # Rebuild without duplicates
    unique_rows = []
    seen = set()
    for row in all_rows:
        key = make_meeting_key(row, header)
        if key not in seen:
            seen.add(key)
            unique_rows.append(row)

    removed = original_count - len(unique_rows)
    print(f"Original rows: {original_count}")
    print(f"Unique rows: {len(unique_rows)}")
    print(f"Duplicates removed: {removed}")

    if removed > 0:
        with open(OUTPUT_CSV, "w", newline="", encoding="utf-8") as f:
            writer = csv.writer(f)
            writer.writerow(header)
            writer.writerows(unique_rows)
        print(f"Saved deduplicated file to: {OUTPUT_CSV}")


def test_single_page():
    """Test fetching a single page to see the structure."""
    session = requests.Session()
    print("Fetching page 1 as test...")

    csv_text = fetch_csv_page(1, session)
    reader = csv.reader(io.StringIO(csv_text))
    rows = list(reader)

    print(f"Total rows (including header): {len(rows)}")
    print(f"Header: {rows[0]}")
    print(f"\nFirst 3 data rows:")
    for row in rows[1:4]:
        print(f"  {dict(zip(rows[0], row))}")


def clear_cache():
    """Clear the scraper cache."""
    cache = MeetingsScraperCache()
    cache.clear()
    print("Cache cleared")


if __name__ == "__main__":
    import sys

    if len(sys.argv) > 1 and sys.argv[1] == "test":
        test_single_page()
    elif len(sys.argv) > 1 and sys.argv[1] == "dedup":
        deduplicate_existing()
    elif len(sys.argv) > 1 and sys.argv[1] == "clear-cache":
        clear_cache()
    elif len(sys.argv) > 1 and sys.argv[1] == "dates":
        # Usage: python playaround.py dates [start_date] [end_date] [interval] [--force]
        # Examples:
        #   python playaround.py dates                           # scrape all weekly from 2019
        #   python playaround.py dates 2023-01-01                # start from 2023
        #   python playaround.py dates 2023-01-01 2024-01-01     # specific range
        #   python playaround.py dates 2019-07-01 2026-01-01 month  # monthly chunks
        #   python playaround.py dates --force                   # ignore cache, re-scrape all
        start_date = "2019-07-01"
        end_date = None
        interval = "week"
        force = "--force" in sys.argv

        args = [a for a in sys.argv[2:] if not a.startswith("--")]
        if len(args) > 0:
            start_date = args[0]
        if len(args) > 1:
            end_date = args[1]
        if len(args) > 2:
            interval = args[2]

        scrape_by_date_ranges(start_date=start_date, end_date=end_date, interval=interval, force=force)
    else:
        # Usage: python playaround.py [start_page] [end_page]
        # Examples:
        #   python playaround.py          # scrape all from page 1
        #   python playaround.py 50       # start from page 50
        #   python playaround.py 50 60    # scrape pages 50-60 only
        start_page = 1
        end_page = None

        if len(sys.argv) > 1 and sys.argv[1].isdigit():
            start_page = int(sys.argv[1])
        if len(sys.argv) > 2 and sys.argv[2].isdigit():
            end_page = int(sys.argv[2])

        scrape_all_meetings(start_page=start_page, end_page=end_page)
