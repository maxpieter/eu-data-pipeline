#!/usr/bin/env python3
"""
Local development server that wraps bip.py functionality.
ALL filtering is now automatic based on edge count.

Run with: python server.py
Then access: http://localhost:5001/api/graph?mode=full
"""

import os
import sys
import json
from flask import Flask, request, jsonify
from flask_cors import CORS
import numpy as np
from datetime import datetime

from scipy.sparse import coo_matrix
from sklearn.cluster import SpectralCoclustering

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
    filter_edges_by_weight,
    filter_bipartite_by_degree,
    bipartite_k_core_prune,
    build_d3_bipartite,
    MEETINGS_JSON,
    COMMISSION_CSV,
)
import pandas as pd

app = Flask(__name__)
CORS(app)


def determine_pruning_params(edge_count):
    """
    Automatically determine ALL filtering parameters based on edge count.

    UPDATED RULES - Keep more edges for better network density:
    - < 5k edges: org≥1, actor≥1, k=1, weight≥1 (minimal filtering)
    - 5k-20k edges: org≥2, actor≥1, k=2, weight≥1 (light filtering)
    - 20k-40k edges: org≥3, actor≥2, k=2, weight≥1 (medium filtering)
    - 40k-70k edges: org≥4, actor≥2, k=3, weight≥1 (strong filtering)
    - 70k+ edges: org≥5, actor≥3, k=3, weight≥2 (very strong filtering)

    Returns: (org_min_degree, actor_min_degree, k_core, min_edge_weight)
    """
    if edge_count < 5000:
        return 1, 1, 1, 1  # Keep almost everything
    elif edge_count < 30000:
        return 1, 1, 2, 2  # Light filtering - focus on node quality
    elif edge_count < 40000:
        return 2, 2, 2, 2  # Medium filtering - remove low-degree nodes
    elif edge_count < 70000:
        return 2, 2, 2, 2  # Strong filtering - keep network core
    else:
        return 5, 5, 3, 2  # Very strong - only major players


def parse_date_range(start_str, end_str):
    """Parse YYYY-MM-DD start/end (inclusive). Returns (start_ts, end_ts) as pandas Timestamps or (None, None)."""
    if not start_str and not end_str:
        return None, None

    def _parse(s):
        return pd.to_datetime(s, errors='coerce').normalize()

    start_ts = _parse(start_str) if start_str else None
    end_ts = _parse(end_str) if end_str else None

    if start_ts is not None and pd.isna(start_ts):
        start_ts = None
    if end_ts is not None and pd.isna(end_ts):
        end_ts = None

    if end_ts is not None:
        # inclusive end-of-day
        end_ts = end_ts + pd.Timedelta(days=1) - pd.Timedelta(milliseconds=1)

    return start_ts, end_ts


def filter_df_by_timerange(df, ts_col, start_ts, end_ts):
    """Filter df to [start_ts, end_ts] on ts_col. If ts_col missing/None, returns df unchanged."""
    if df is None or ts_col is None or ts_col not in df.columns:
        return df

    ts = pd.to_datetime(df[ts_col], errors='coerce')
    mask = ts.notna()
    if start_ts is not None:
        mask &= (ts >= start_ts)
    if end_ts is not None:
        mask &= (ts <= end_ts)
    return df.loc[mask].copy()


def detect_communities(nodes, edges):
    """
    Detect communities using **native bipartite co-clustering** (spectral co-clustering)
    and assign colors to the top 6 communities.

    This is designed for bipartite graphs (actors ↔ orgs) and avoids
    collapsing the network to a one-mode projection.

    Returns: dict mapping node_id -> community_id (0-5 for top 6, -1 for others)
    """
    # Split bipartite sets
    org_ids = [n["id"] for n in nodes if n.get("type") == "org"]
    actor_ids = [n["id"] for n in nodes if n.get("type") != "org"]

    # If one side is empty, we can't do bipartite community detection.
    if len(org_ids) == 0 or len(actor_ids) == 0:
        node_to_community = {n["id"]: -1 for n in nodes}
        return node_to_community, []

    # Index maps
    actor_index = {nid: i for i, nid in enumerate(actor_ids)}
    org_index = {nid: j for j, nid in enumerate(org_ids)}

    # Build sparse biadjacency matrix (actors x orgs)
    rows = []
    cols = []
    vals = []
    for e in edges:
        s = str(e.get("source"))
        t = str(e.get("target"))
        w = float(e.get("weight", 1))

        # Robustness: edges might be oriented either way.
        if s in actor_index and t in org_index:
            rows.append(actor_index[s])
            cols.append(org_index[t])
            vals.append(w)
        elif t in actor_index and s in org_index:
            rows.append(actor_index[t])
            cols.append(org_index[s])
            vals.append(w)

    if len(vals) == 0:
        node_to_community = {n["id"]: -1 for n in nodes}
        return node_to_community, []

    X = coo_matrix(
        (np.asarray(vals, dtype=float), (np.asarray(rows, dtype=int), np.asarray(cols, dtype=int))),
        shape=(len(actor_ids), len(org_ids)),
    ).tocsr()

    # Choose number of co-clusters.
    # Bound by min(n_rows, n_cols) to avoid sklearn errors.
    max_possible = max(2, min(X.shape[0], X.shape[1]))
    n_clusters = min(12, max_possible)
    if n_clusters < 2:
        node_to_community = {n["id"]: -1 for n in nodes}
        return node_to_community, []

    model = SpectralCoclustering(n_clusters=n_clusters, random_state=42)
    model.fit(X)

    actor_labels = model.row_labels_
    org_labels = model.column_labels_

    # Combined cluster sizes across both partitions
    cluster_sizes = {c: 0 for c in range(n_clusters)}
    for c in actor_labels:
        cluster_sizes[int(c)] += 1
    for c in org_labels:
        cluster_sizes[int(c)] += 1

    # Sort clusters by combined size and map top 6 -> 0..5
    sorted_clusters = sorted(cluster_sizes.items(), key=lambda kv: kv[1], reverse=True)
    top6 = [c for c, _sz in sorted_clusters[:6]]
    remap = {c: i for i, c in enumerate(top6)}

    node_to_community = {}
    for nid, lbl in zip(actor_ids, actor_labels):
        node_to_community[nid] = remap.get(int(lbl), -1)
    for nid, lbl in zip(org_ids, org_labels):
        node_to_community[nid] = remap.get(int(lbl), -1)

    total_nodes = len(nodes)
    community_stats = [
        {
            "id": i,
            "size": int(cluster_sizes[c]),
            "percentage": round(cluster_sizes[c] / total_nodes * 100, 1),
        }
        for i, c in enumerate(top6)
    ]

    return node_to_community, community_stats



def build_graph(
    mode='full',
    keep_isolates=False,
    start=None,
    end=None,
):
    """Build graph data with fully automatic filtering based on initial edge count."""

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

    # Apply timeline filter (inclusive)
    start_ts, end_ts = parse_date_range(start, end)
    if start_ts is not None or end_ts is not None:
        meetings_df = filter_df_by_timerange(meetings_df, meetings_ts_col, start_ts, end_ts)
        commission_df = filter_df_by_timerange(commission_df, commission_ts_col, start_ts, end_ts)
        print(f"Timeline filter applied: {start or '…'} → {end or '…'}")

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

    # Get initial edge count to determine ALL filtering parameters
    initial_edge_count = len(edges)
    print(f"Initial edge count: {initial_edge_count:,}")

    # Automatically determine ALL filtering parameters based on edge count
    org_min_degree, actor_min_degree, bipartite_k_core, min_edge_weight = determine_pruning_params(initial_edge_count)
    print(f"Auto-selected filtering: org_degree={org_min_degree}, actor_degree={actor_min_degree}, k-core={bipartite_k_core}, edge_weight={min_edge_weight}")

    # Edge weight filtering with automatic threshold
    edges_agg = filter_edges_by_weight(
        edges,
        min_weight=min_edge_weight,
        ts_col=ts_col,
        verbose=False,
    )

    # Apply structural filtering with automatic degree thresholds
    edges = filter_bipartite_by_degree(
        edges_agg,
        org_min_degree=org_min_degree,
        actor_min_degree=actor_min_degree,
        verbose=False,
        actor_label=actor_label,
    )

    # Apply automatic k-core pruning
    if bipartite_k_core > 1:
        edges = bipartite_k_core_prune(edges, k=bipartite_k_core, verbose=False, actor_label=actor_label)

    # Build D3 graph
    graph = build_d3_bipartite(
        nodes_df=nodes,
        edges_df=edges,
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
            'label': org_id,
            'name': org_id,
        })

    # Detect communities using native bipartite co-clustering
    print(f"Running bipartite community detection on {len(graph['nodes'])} nodes...")
    node_to_community, community_stats = detect_communities(graph['nodes'], graph['links'])

    # Add community information to nodes
    for node in graph['nodes']:
        node['community'] = node_to_community.get(node['id'], -1)

    print(f"Found {len(community_stats)} major communities (top 6 by size):")
    for stat in community_stats:
        print(f"  Community {stat['id']}: {stat['size']} nodes ({stat['percentage']}%)")

    # Add metadata about the filtering parameters used
    graph['metadata'] = {
        'initial_edge_count': initial_edge_count,
        'final_edge_count': len(graph['links']),
        'final_node_count': len(graph['nodes']),
        'org_min_degree_used': org_min_degree,
        'actor_min_degree_used': actor_min_degree,
        'k_core_used': bipartite_k_core,
        'min_edge_weight_used': min_edge_weight,
        'communities': community_stats,
        'community_method': 'spectral_coclustering',
        'timeline': {
            'start': start,
            'end': end,
        },
    }

    return graph


@app.route('/api/graph')
def get_graph():
    """
    GET /api/graph

    Query parameters:
    - mode: 'mep', 'commission', or 'full' (default: 'full')
    - keep_isolates: bool (default: false)
    - start: YYYY-MM-DD (inclusive)
    - end: YYYY-MM-DD (inclusive)

    Note: ALL filtering parameters are now automatically determined
    based on the initial edge count.
    """
    try:
        mode = request.args.get('mode', 'full')
        if mode not in ('mep', 'commission', 'full'):
            mode = 'full'

        keep_isolates = request.args.get('keep_isolates', 'false').lower() == 'true'

        start = request.args.get('start')
        end = request.args.get('end')

        graph = build_graph(
            mode=mode,
            keep_isolates=keep_isolates,
            start=start,
            end=end,
        )

        return jsonify(graph)

    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({
            'error': str(e),
            'nodes': [],
            'links': []
        }), 500


@app.route('/api/health')
def health():
    return jsonify({'status': 'ok'})


if __name__ == '__main__':
    print("Starting local development server with FULLY AUTOMATIC FILTERING...")
    print("API endpoint: http://localhost:5001/api/graph")
    print("\nAvailable parameters:")
    print("  mode: mep, commission, full (default: full)")
    print("  keep_isolates: true/false (default: false)")
    print("  start/end: YYYY-MM-DD date range (inclusive)")
    print("\nExample: http://localhost:5001/api/graph?mode=full&start=2024-03-01&end=2025-06-30")
    app.run(host='0.0.0.0', port=5001, debug=True)
