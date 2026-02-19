#!/usr/bin/env python3
"""
Local development server that wraps bip.py functionality.
Exposes all filter parameters via REST API.

Run with: python server.py
Then access: http://localhost:5001/api/graph?mode=full
"""

import os
import sys
import json
from flask import Flask, request, jsonify
from flask_cors import CORS

# Add project root to path
PROJECT_ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, PROJECT_ROOT)

# Import bip.py functions
from api.bip import (
    load_orgs_table,
    load_ep_lookup,
    attach_party_country,
    infer_commission_unmatched_org_nodes,
    guess_timestamp_column,
    filter_bipartite_by_degree,
    bipartite_k_core_prune,
    filter_edges_by_weight,
    build_d3_bipartite,
    MEETINGS_JSON,
    COMMISSION_CSV,
)
import pandas as pd

app = Flask(__name__)
CORS(app)


def build_graph(
    mode='full',
    org_min_degree=2,
    actor_min_degree=1,
    bipartite_k_core=0,
    min_edge_weight=1,
    keep_isolates=False,
):
    """Build graph data with specified filters."""

    # Load data
    orgs_df = load_orgs_table()
    meetings_df = pd.read_json(MEETINGS_JSON)
    commission_df = pd.read_csv(COMMISSION_CSV)

    # ORG nodes (master)
    org_nodes = orgs_df.copy()
    if "eu_transparency_register_id" in org_nodes.columns:
        org_nodes = org_nodes.rename(columns={"eu_transparency_register_id": "register_id"})
    if "register_id" not in org_nodes.columns:
        org_nodes["register_id"] = None
    if "interests_represented" not in org_nodes.columns:
        org_nodes["interests_represented"] = None

    org_nodes["type"] = "org"
    org_nodes["id"] = org_nodes["id"].astype(str)
    org_nodes["label"] = org_nodes["name"].astype(str)

    # Timestamps
    meetings_ts_col = guess_timestamp_column(meetings_df)
    commission_ts_col = guess_timestamp_column(commission_df)

    # Build nodes/edges per mode
    mep_nodes = pd.DataFrame()
    commission_nodes = pd.DataFrame()
    new_org_nodes = pd.DataFrame(columns=["id", "type", "name", "label"])

    if mode in ("mep", "full"):
        if "source_data" in meetings_df.columns:
            meetings_df["mep_name"] = meetings_df["source_data"].apply(
                lambda x: x.get("mep_name") if isinstance(x, dict) else None
            )
        elif "mep_name" not in meetings_df.columns:
            meetings_df["mep_name"] = None

        mep_nodes = meetings_df[["mep_id", "mep_name"]].drop_duplicates().rename(columns={"mep_id": "id"})
        mep_nodes["type"] = "mep"
        mep_nodes = attach_party_country(mep_nodes)
        mep_nodes["id"] = mep_nodes["id"].astype(str)
        mep_nodes["label"] = mep_nodes["mep_name"].fillna("").astype(str)

    if mode in ("commission", "full"):
        commission_df["OrgId"] = commission_df["OrgId"].astype(str)

        commission_nodes = pd.DataFrame({
            "id": commission_df["Host"].astype(str).drop_duplicates().values,
            "type": "commission_employee",
            "name": commission_df["Host"].astype(str).drop_duplicates().values,
            "label": commission_df["Host"].astype(str).drop_duplicates().values,
        })

        new_org_nodes = infer_commission_unmatched_org_nodes(commission_df, org_nodes)
        if len(new_org_nodes):
            new_org_nodes["id"] = new_org_nodes["id"].astype(str)

    # Build edges
    if mode == "mep":
        nodes = pd.concat([
            org_nodes[["id", "type", "name", "label", "interests_represented", "register_id"]],
            mep_nodes[["id", "type", "mep_name", "label", "party", "country"]],
        ], ignore_index=True)

        edges = meetings_df[["mep_id", "organization_id"]].rename(columns={"mep_id": "source", "organization_id": "target"})
        if meetings_ts_col and meetings_ts_col in meetings_df.columns:
            edges["timestamp"] = meetings_df[meetings_ts_col]
            ts_col = "timestamp"
        else:
            ts_col = None
        actor_label = "MEP"

    elif mode == "commission":
        nodes = pd.concat([
            org_nodes[["id", "type", "name", "label", "interests_represented", "register_id"]],
            new_org_nodes[["id", "type", "name", "label"]] if len(new_org_nodes) else pd.DataFrame(columns=["id","type","name","label"]),
            commission_nodes[["id", "type", "name", "label"]],
        ], ignore_index=True)

        edges = commission_df[["Host", "OrgId"]].rename(columns={"Host": "source", "OrgId": "target"})
        if commission_ts_col and commission_ts_col in commission_df.columns:
            edges["timestamp"] = commission_df[commission_ts_col]
            ts_col = "timestamp"
        else:
            ts_col = None
        actor_label = "Commission"

    else:  # full
        nodes = pd.concat([
            org_nodes[["id", "type", "name", "label", "interests_represented", "register_id"]],
            new_org_nodes[["id", "type", "name", "label"]] if len(new_org_nodes) else pd.DataFrame(columns=["id","type","name","label"]),
            mep_nodes[["id", "type", "mep_name", "label", "party", "country"]],
            commission_nodes[["id", "type", "name", "label"]],
        ], ignore_index=True)

        edges_mep = meetings_df[["mep_id", "organization_id"]].rename(columns={"mep_id": "source", "organization_id": "target"})
        if meetings_ts_col and meetings_ts_col in meetings_df.columns:
            edges_mep["timestamp"] = meetings_df[meetings_ts_col]

        edges_com = commission_df[["Host", "OrgId"]].rename(columns={"Host": "source", "OrgId": "target"})
        if commission_ts_col and commission_ts_col in commission_df.columns:
            edges_com["timestamp"] = commission_df[commission_ts_col]

        edges = pd.concat([edges_mep, edges_com], ignore_index=True)
        ts_col = "timestamp" if "timestamp" in edges.columns else None
        actor_label = "Actor"

    # Apply structural filtering
    edges = filter_bipartite_by_degree(
        edges,
        org_min_degree=org_min_degree,
        actor_min_degree=actor_min_degree,
        verbose=False,
        actor_label=actor_label,
    )

    if bipartite_k_core > 1:
        edges = bipartite_k_core_prune(edges, k=bipartite_k_core, verbose=False, actor_label=actor_label)

    # Edge weight filtering
    edges_agg = filter_edges_by_weight(
        edges,
        min_weight=min_edge_weight,
        ts_col=ts_col,
        verbose=False,
    )

    # Build D3 graph
    graph = build_d3_bipartite(
        nodes_df=nodes,
        edges_df=edges_agg,
        ts_col=None,  # Already aggregated
        keep_isolates=keep_isolates,
        verbose=False,
    )

    # Ensure data consistency: create missing org nodes for edges
    node_ids = {n['id'] for n in graph['nodes']}
    missing_orgs = set()
    for link in graph['links']:
        if link['source'] not in node_ids:
            missing_orgs.add(link['source'])
        if link['target'] not in node_ids:
            missing_orgs.add(link['target'])

    # Add placeholder nodes for missing organizations
    for org_id in missing_orgs:
        graph['nodes'].append({
            'id': org_id,
            'type': 'org',
            'label': org_id,  # Use ID as label since we don't have the name
            'name': org_id,
        })

    return graph


@app.route('/api/graph')
def get_graph():
    """
    GET /api/graph

    Query parameters:
    - mode: 'mep', 'commission', or 'full' (default: 'full')
    - org_min_degree: int (default: 2)
    - actor_min_degree: int (default: 1)
    - bipartite_k_core: int (default: 0)
    - min_edge_weight: int (default: 1)
    - keep_isolates: bool (default: false)
    """
    try:
        mode = request.args.get('mode', 'full')
        if mode not in ('mep', 'commission', 'full'):
            mode = 'full'

        org_min_degree = int(request.args.get('org_min_degree', 2))
        actor_min_degree = int(request.args.get('actor_min_degree', 1))
        bipartite_k_core = int(request.args.get('bipartite_k_core', 0))
        min_edge_weight = int(request.args.get('min_edge_weight', 1))
        keep_isolates = request.args.get('keep_isolates', 'false').lower() == 'true'

        graph = build_graph(
            mode=mode,
            org_min_degree=org_min_degree,
            actor_min_degree=actor_min_degree,
            bipartite_k_core=bipartite_k_core,
            min_edge_weight=min_edge_weight,
            keep_isolates=keep_isolates,
        )

        return jsonify(graph)

    except Exception as e:
        return jsonify({
            'error': str(e),
            'nodes': [],
            'links': []
        }), 500


@app.route('/api/health')
def health():
    return jsonify({'status': 'ok'})


# ============ MEP Meetings Endpoints ============

import csv

MEETINGS_CSV_PATH = os.path.join(PROJECT_ROOT, 'data', 'ep_meetings_all.csv')
MEPS_CSV_PATH = os.path.join(PROJECT_ROOT, 'data', 'ep_meps.csv')

# Cache for data
_meetings_cache = None
_meps_cache = None

def load_meps_lookup():
    """Load MEPs data and return lookup dict by ID."""
    global _meps_cache
    if _meps_cache is None:
        _meps_cache = {}
        with open(MEPS_CSV_PATH, 'r', encoding='utf-8') as f:
            reader = csv.DictReader(f)
            for row in reader:
                mep_id = int(row['id'])
                # Parse memberships JSON to get current committees
                committees = []
                try:
                    memberships = json.loads(row.get('memberships', '[]'))
                    for m in memberships:
                        if m.get('classification', '').startswith('COMMITTEE_') and not m.get('end_date'):
                            committees.append(m.get('code', ''))
                except:
                    pass

                _meps_cache[mep_id] = {
                    'id': mep_id,
                    'name': row.get('name', ''),
                    'country': row.get('country_name', '') or row.get('country', ''),
                    'country_code': row.get('country_code', ''),
                    'political_group': row.get('political_group', ''),
                    'committees': list(set(committees)),  # dedupe
                }
    return _meps_cache

def load_meetings_data():
    """Load and cache meetings data from CSV, enriched with MEP info.

    COLLAPSING LOGIC: Meetings with the same (mep_id, title, date) are collapsed
    into a single record with an attendees list ONLY if there are more than 3
    attendees. This handles large stakeholder dialogues (50+ orgs) while keeping
    small meetings (1-3 attendees) as separate rows for granularity.
    """
    global _meetings_cache
    if _meetings_cache is None:
        meps = load_meps_lookup()

        # First pass: group all rows by unique meeting key
        meetings_grouped = {}

        with open(MEETINGS_CSV_PATH, 'r', encoding='utf-8') as f:
            reader = csv.DictReader(f)
            for row in reader:
                try:
                    mep_id = int(row.get('member_id', 0))
                except:
                    continue

                meeting_key = (
                    mep_id,
                    row.get('title', ''),
                    row.get('meeting_date', '')
                )

                if meeting_key not in meetings_grouped:
                    meetings_grouped[meeting_key] = []

                meetings_grouped[meeting_key].append(row)

        # Second pass: collapse only if >5 attendees, otherwise keep separate
        _meetings_cache = []

        for meeting_key, rows in meetings_grouped.items():
            mep_id, title, meeting_date = meeting_key
            mep_info = meps.get(mep_id, {})
            committees = mep_info.get('committees', [])

            if len(rows) > 3:
                # Collapse into single meeting with attendees list
                attendees = []
                for row in rows:
                    attendee = row.get('attendees', '').strip()
                    lobbyist_id = row.get('lobbyist_id', '').strip()
                    if attendee:
                        attendees.append({
                            'name': attendee,
                            'lobbyist_id': lobbyist_id if lobbyist_id else None
                        })

                first_row = rows[0]
                _meetings_cache.append({
                    'mep_id': mep_id,
                    'meeting_date': meeting_date,
                    'title': title,
                    'capacity': first_row.get('member_capacity', ''),
                    'related_procedure': first_row.get('procedure_reference', '') or None,
                    'committee_acronym': committees[0] if committees else None,
                    'mep_committees': committees,
                    'attendees': attendees,
                    'source_data': {
                        'mep_name': first_row.get('member_name', mep_info.get('name', '')),
                        'mep_country': mep_info.get('country', ''),
                        'mep_political_group': mep_info.get('political_group', ''),
                    }
                })
            else:
                # Keep as separate rows (1-5 attendees)
                for row in rows:
                    attendee = row.get('attendees', '').strip()
                    lobbyist_id = row.get('lobbyist_id', '').strip()
                    _meetings_cache.append({
                        'mep_id': mep_id,
                        'meeting_date': meeting_date,
                        'title': title,
                        'capacity': row.get('member_capacity', ''),
                        'related_procedure': row.get('procedure_reference', '') or None,
                        'committee_acronym': committees[0] if committees else None,
                        'mep_committees': committees,
                        'attendees': [{'name': attendee, 'lobbyist_id': lobbyist_id if lobbyist_id else None}] if attendee else [],
                        'source_data': {
                            'mep_name': row.get('member_name', mep_info.get('name', '')),
                            'mep_country': mep_info.get('country', ''),
                            'mep_political_group': mep_info.get('political_group', ''),
                        }
                    })

    return _meetings_cache


@app.route('/api/meps')
def get_meps():
    """
    GET /api/meps
    Returns list of all MEPs with their meeting counts.
    """
    try:
        meetings = load_meetings_data()

        # Aggregate MEP info
        meps = {}
        for m in meetings:
            mep_id = m.get('mep_id')
            if mep_id is None:
                continue

            source_data = m.get('source_data', {})
            if mep_id not in meps:
                meps[mep_id] = {
                    'id': mep_id,
                    'name': source_data.get('mep_name', 'Unknown'),
                    'country': source_data.get('mep_country', ''),
                    'political_group': source_data.get('mep_political_group', ''),
                    'meeting_count': 0,
                }
            meps[mep_id]['meeting_count'] += 1

        # Sort by meeting count descending
        mep_list = sorted(meps.values(), key=lambda x: x['meeting_count'], reverse=True)

        return jsonify({
            'meps': mep_list,
            'total': len(mep_list),
        })

    except Exception as e:
        return jsonify({'error': str(e), 'meps': []}), 500


# EP Period cutoff date (EP9 ends 2024-07-15, EP10 starts 2024-07-16)
EP9_END_DATE = '2024-07-15'
EP10_START_DATE = '2024-07-16'


@app.route('/api/timeline')
def get_timeline():
    """
    GET /api/timeline
    Returns meeting timeline with optional filters. All filters are optional and combinable.

    Query parameters:
    - mep: MEP ID
    - committee: committee acronym
    - procedure: procedure reference
    - organization: organization name (substring match)
    - ep_period: 'ep9', 'ep10', or 'both' (default: both)
    """
    try:
        meetings = load_meetings_data()

        # Get all filter parameters
        mep_filter = request.args.get('mep')
        committee_filter = request.args.get('committee')
        procedure_filter = request.args.get('procedure')
        organization_filter = request.args.get('organization')
        ep_period = request.args.get('ep_period', 'both')

        # Need at least one filter
        if not any([mep_filter, committee_filter, procedure_filter, organization_filter]):
            return jsonify({'error': 'At least one filter required', 'timeline': []}), 400

        filtered = meetings

        # Apply filters
        if mep_filter:
            try:
                mep_id = int(mep_filter)
                filtered = [m for m in filtered if m.get('mep_id') == mep_id]
            except ValueError:
                return jsonify({'error': 'Invalid MEP ID', 'timeline': []}), 400

        if committee_filter:
            filtered = [m for m in filtered if committee_filter in m.get('mep_committees', [])]

        if procedure_filter:
            filtered = [m for m in filtered if m.get('related_procedure') == procedure_filter]

        if organization_filter:
            org_lower = organization_filter.lower()
            filtered = [m for m in filtered
                       if any(org_lower in att.get('name', '').lower() for att in m.get('attendees', []))]

        # Apply EP period filter
        if ep_period == 'ep9':
            filtered = [m for m in filtered if m.get('meeting_date', '') <= EP9_END_DATE]
        elif ep_period == 'ep10':
            filtered = [m for m in filtered if m.get('meeting_date', '') >= EP10_START_DATE]
        # 'both' or any other value means no date filtering

        # Aggregate by week
        from datetime import datetime
        weekly_data = {}
        meps_involved = set()

        for m in filtered:
            date = m.get('meeting_date')
            mep_id = m.get('mep_id')
            if date:
                try:
                    dt = datetime.strptime(date, '%Y-%m-%d')
                    week_key = f"{dt.isocalendar()[0]}-W{dt.isocalendar()[1]:02d}"
                except:
                    continue

                if week_key not in weekly_data:
                    weekly_data[week_key] = {'count': 0, 'meetings': []}
                weekly_data[week_key]['count'] += 1
                weekly_data[week_key]['meetings'].append({
                    'date': date,
                    'title': m.get('title', ''),
                    'attendee_count': len(m.get('attendees', [])),
                    'procedure': m.get('related_procedure'),
                })
            if mep_id:
                meps_involved.add(mep_id)

        timeline = [
            {'week': k, 'count': v['count'], 'meetings': v['meetings']}
            for k, v in sorted(weekly_data.items())
        ]

        # Get MEP info if filtering by MEP
        mep_info = None
        if mep_filter and filtered:
            source_data = filtered[0].get('source_data', {})
            mep_info = {
                'id': int(mep_filter),
                'name': source_data.get('mep_name', 'Unknown'),
                'country': source_data.get('mep_country', ''),
                'political_group': source_data.get('mep_political_group', ''),
            }

        return jsonify({
            'timeline': timeline,
            'total_meetings': len(filtered),
            'meps_involved': len(meps_involved),
            'mep': mep_info,
            'filters': {
                'mep': mep_filter,
                'committee': committee_filter,
                'procedure': procedure_filter,
                'organization': organization_filter,
                'ep_period': ep_period,
            }
        })

    except Exception as e:
        return jsonify({'error': str(e), 'timeline': []}), 500


@app.route('/api/meps/<int:mep_id>/timeline')
def get_mep_timeline(mep_id):
    """
    GET /api/meps/<mep_id>/timeline
    Returns monthly meeting counts for a specific MEP.

    Query parameters:
    - committee: filter by committee acronym
    - procedure: filter by related procedure
    - organization: filter by organization name (fuzzy match)
    """
    try:
        meetings = load_meetings_data()

        # Get filter parameters
        committee_filter = request.args.get('committee')
        procedure_filter = request.args.get('procedure')
        organization_filter = request.args.get('organization')

        # Filter meetings for this MEP
        mep_meetings = [m for m in meetings if m.get('mep_id') == mep_id]

        if not mep_meetings:
            return jsonify({'error': f'MEP {mep_id} not found', 'timeline': []}), 404

        # Apply filters
        if committee_filter:
            # Filter by MEP's committee memberships (since meetings don't have committee info)
            mep_meetings = [m for m in mep_meetings if committee_filter in m.get('mep_committees', [])]
        if procedure_filter:
            mep_meetings = [m for m in mep_meetings if m.get('related_procedure') == procedure_filter]
        if organization_filter:
            # Filter by organization name (case-insensitive substring match)
            org_lower = organization_filter.lower()
            mep_meetings = [m for m in mep_meetings
                          if any(org_lower in att.get('name', '').lower() for att in m.get('attendees', []))]

        # Get MEP info from first meeting (before filtering)
        all_mep_meetings = [m for m in meetings if m.get('mep_id') == mep_id]
        source_data = all_mep_meetings[0].get('source_data', {})
        mep_info = {
            'id': mep_id,
            'name': source_data.get('mep_name', 'Unknown'),
            'country': source_data.get('mep_country', ''),
            'political_group': source_data.get('mep_political_group', ''),
        }

        # Aggregate by week with individual meeting details
        from datetime import datetime
        weekly_data = {}
        for m in mep_meetings:
            date = m.get('meeting_date')
            if date:
                # Get ISO week: YYYY-WXX
                try:
                    dt = datetime.strptime(date, '%Y-%m-%d')
                    week_key = f"{dt.isocalendar()[0]}-W{dt.isocalendar()[1]:02d}"
                except:
                    continue

                if week_key not in weekly_data:
                    weekly_data[week_key] = {'count': 0, 'meetings': []}
                weekly_data[week_key]['count'] += 1
                weekly_data[week_key]['meetings'].append({
                    'date': date,
                    'title': m.get('title', ''),
                    'attendee_count': len(m.get('attendees', [])),
                    'procedure': m.get('related_procedure'),
                })

        # Sort by week
        timeline = [
            {'week': k, 'count': v['count'], 'meetings': v['meetings']}
            for k, v in sorted(weekly_data.items())
        ]

        return jsonify({
            'mep': mep_info,
            'timeline': timeline,
            'total_meetings': len(mep_meetings),
            'filters': {
                'committee': committee_filter,
                'procedure': procedure_filter,
            }
        })

    except Exception as e:
        return jsonify({'error': str(e), 'timeline': []}), 500


@app.route('/api/committees')
def get_committees():
    """
    GET /api/committees
    Returns list of all committees with meeting counts.
    """
    try:
        meetings = load_meetings_data()

        committees = {}
        for m in meetings:
            comm = m.get('committee_acronym')
            if comm:
                if comm not in committees:
                    committees[comm] = {'acronym': comm, 'count': 0}
                committees[comm]['count'] += 1

        # Sort by count descending
        committee_list = sorted(committees.values(), key=lambda x: x['count'], reverse=True)

        return jsonify({
            'committees': committee_list,
            'total': len(committee_list),
        })

    except Exception as e:
        return jsonify({'error': str(e), 'committees': []}), 500


@app.route('/api/procedures')
def get_procedures():
    """
    GET /api/procedures
    Returns list of all procedures with meeting counts.
    """
    try:
        meetings = load_meetings_data()

        procedures = {}
        for m in meetings:
            proc = m.get('related_procedure')
            if proc:
                if proc not in procedures:
                    procedures[proc] = {'procedure': proc, 'count': 0}
                procedures[proc]['count'] += 1

        # Sort by count descending
        procedure_list = sorted(procedures.values(), key=lambda x: x['count'], reverse=True)

        return jsonify({
            'procedures': procedure_list,
            'total': len(procedure_list),
        })

    except Exception as e:
        return jsonify({'error': str(e), 'procedures': []}), 500


@app.route('/api/organizations')
def get_organizations():
    """
    GET /api/organizations
    Returns list of all organizations with meeting counts.
    """
    try:
        meetings = load_meetings_data()

        organizations = {}
        for m in meetings:
            for attendee in m.get('attendees', []):
                org_name = attendee.get('name', '').strip()
                if org_name:
                    if org_name not in organizations:
                        organizations[org_name] = {'name': org_name, 'count': 0}
                    organizations[org_name]['count'] += 1

        # Sort by count descending
        org_list = sorted(organizations.values(), key=lambda x: x['count'], reverse=True)

        return jsonify({
            'organizations': org_list,
            'total': len(org_list),
        })

    except Exception as e:
        return jsonify({'error': str(e), 'organizations': []}), 500


@app.route('/api/meps/<int:mep_id>/procedures')
def get_mep_procedures(mep_id):
    """
    GET /api/meps/<mep_id>/procedures
    Returns procedures for a specific MEP with meeting counts.
    """
    try:
        meetings = load_meetings_data()

        # Filter meetings for this MEP
        mep_meetings = [m for m in meetings if m.get('mep_id') == mep_id]

        if not mep_meetings:
            return jsonify({'error': f'MEP {mep_id} not found', 'procedures': []}), 404

        # Count procedures
        procedures = {}
        for m in mep_meetings:
            proc = m.get('related_procedure')
            if proc:
                if proc not in procedures:
                    procedures[proc] = {'procedure': proc, 'count': 0}
                procedures[proc]['count'] += 1

        # Sort by count descending
        procedure_list = sorted(procedures.values(), key=lambda x: x['count'], reverse=True)

        return jsonify({
            'procedures': procedure_list,
            'total': len(procedure_list),
        })

    except Exception as e:
        return jsonify({'error': str(e), 'procedures': []}), 500


@app.route('/api/procedures/<path:procedure_id>/timeline')
def get_procedure_timeline(procedure_id):
    """
    GET /api/procedures/<procedure_id>/timeline
    Returns monthly meeting counts for a procedure across ALL MEPs.

    Query parameters:
    - committee: filter by committee acronym
    - organization: filter by organization name
    """
    try:
        meetings = load_meetings_data()
        committee_filter = request.args.get('committee')
        organization_filter = request.args.get('organization')

        # Filter meetings for this procedure
        proc_meetings = [m for m in meetings if m.get('related_procedure') == procedure_id]

        if not proc_meetings:
            return jsonify({'error': f'Procedure {procedure_id} not found', 'timeline': []}), 404

        # Apply additional filters
        if committee_filter:
            proc_meetings = [m for m in proc_meetings if committee_filter in m.get('mep_committees', [])]
        if organization_filter:
            org_lower = organization_filter.lower()
            proc_meetings = [m for m in proc_meetings
                           if any(org_lower in att.get('name', '').lower() for att in m.get('attendees', []))]

        # Aggregate by month
        monthly_counts = {}
        meps_involved = set()
        for m in proc_meetings:
            date = m.get('meeting_date')
            mep_id = m.get('mep_id')
            if date:
                month_key = date[:7]
                monthly_counts[month_key] = monthly_counts.get(month_key, 0) + 1
            if mep_id:
                meps_involved.add(mep_id)

        timeline = [
            {'month': k, 'count': v}
            for k, v in sorted(monthly_counts.items())
        ]

        return jsonify({
            'procedure': procedure_id,
            'timeline': timeline,
            'total_meetings': len(proc_meetings),
            'meps_involved': len(meps_involved),
        })

    except Exception as e:
        return jsonify({'error': str(e), 'timeline': []}), 500


@app.route('/api/committees/<committee_id>/timeline')
def get_committee_timeline(committee_id):
    """
    GET /api/committees/<committee_id>/timeline
    Returns monthly meeting counts for a committee across ALL MEPs.

    Query parameters:
    - organization: filter by organization name
    """
    try:
        meetings = load_meetings_data()
        organization_filter = request.args.get('organization')

        # Filter meetings by MEPs who are members of this committee
        comm_meetings = [m for m in meetings if committee_id in m.get('mep_committees', [])]

        if not comm_meetings:
            return jsonify({'error': f'Committee {committee_id} not found', 'timeline': []}), 404

        # Apply additional filters
        if organization_filter:
            org_lower = organization_filter.lower()
            comm_meetings = [m for m in comm_meetings
                           if any(org_lower in att.get('name', '').lower() for att in m.get('attendees', []))]

        # Aggregate by month
        monthly_counts = {}
        meps_involved = set()
        for m in comm_meetings:
            date = m.get('meeting_date')
            mep_id = m.get('mep_id')
            if date:
                month_key = date[:7]
                monthly_counts[month_key] = monthly_counts.get(month_key, 0) + 1
            if mep_id:
                meps_involved.add(mep_id)

        timeline = [
            {'month': k, 'count': v}
            for k, v in sorted(monthly_counts.items())
        ]

        return jsonify({
            'committee': committee_id,
            'timeline': timeline,
            'total_meetings': len(comm_meetings),
            'meps_involved': len(meps_involved),
        })

    except Exception as e:
        return jsonify({'error': str(e), 'timeline': []}), 500


@app.route('/api/organizations/<path:org_name>/timeline')
def get_organization_timeline(org_name):
    """
    GET /api/organizations/<org_name>/timeline
    Returns monthly meeting counts for an organization across ALL MEPs.
    """
    try:
        meetings = load_meetings_data()

        # Filter meetings by organization name (case-insensitive substring match)
        org_lower = org_name.lower()
        org_meetings = [
            m for m in meetings
            if any(org_lower in att.get('name', '').lower() for att in m.get('attendees', []))
        ]

        if not org_meetings:
            return jsonify({'error': f'Organization "{org_name}" not found', 'timeline': []}), 404

        # Aggregate by month
        monthly_counts = {}
        meps_involved = set()
        for m in org_meetings:
            date = m.get('meeting_date')
            mep_id = m.get('mep_id')
            if date:
                month_key = date[:7]
                monthly_counts[month_key] = monthly_counts.get(month_key, 0) + 1
            if mep_id:
                meps_involved.add(mep_id)

        timeline = [
            {'month': k, 'count': v}
            for k, v in sorted(monthly_counts.items())
        ]

        return jsonify({
            'organization': org_name,
            'timeline': timeline,
            'total_meetings': len(org_meetings),
            'meps_involved': len(meps_involved),
        })

    except Exception as e:
        return jsonify({'error': str(e), 'timeline': []}), 500


if __name__ == '__main__':
    print("Starting local development server...")
    print("API endpoint: http://localhost:5001/api/graph")
    print("\nAvailable parameters:")
    print("  mode: mep, commission, full (default: full)")
    print("  org_min_degree: int (default: 2)")
    print("  actor_min_degree: int (default: 1)")
    print("  bipartite_k_core: int (default: 0)")
    print("  min_edge_weight: int (default: 1)")
    print("  keep_isolates: true/false (default: false)")
    print("\nExample: http://localhost:5001/api/graph?mode=mep&org_min_degree=3")
    app.run(host='0.0.0.0', port=5001, debug=True)
