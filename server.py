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
from flask import Flask, request, jsonify, Response
from flask_cors import CORS
import numpy as np
from datetime import datetime

from scipy.sparse import coo_matrix
from sklearn.cluster import SpectralCoclustering

from api.projections import project_politicians, project_organizations, apply_disparity_filter, detect_communities_louvain
from api.backbone import idf_weighted_projection, apply_idf_percentile_filter, suggest_tau_for_singles, hybrid_filter_edges, hypergeom_fdr_backbone

# Load .env file (no dependency needed)
def _load_env_file():
    from pathlib import Path
    env_path = Path(__file__).parent / ".env"
    if not env_path.exists():
        return
    with open(env_path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" in line:
                key, _, value = line.partition("=")
                key = key.strip()
                value = value.strip()
                if not os.environ.get(key):  # don't override existing env vars
                    os.environ[key] = value
    print(f"Loaded .env (LLM_PROVIDER={os.environ.get('LLM_PROVIDER', 'NOT SET')})")

_load_env_file()

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


@app.after_request
def add_no_cache_headers(response):
    """Prevent browsers from caching API responses with stale data."""
    response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
    return response


def determine_pruning_params(edge_count):
    """
    Automatically determine ALL filtering parameters based on edge count.

    RULES:
    - < 1k edges: keep all (org≥1, actor≥1, k=0, weight≥1)
    - 1k-10k edges: minimal filtering
    - 10k-30k edges: light filtering
    - 30k-40k edges: medium filtering
    - 40k-70k edges: strong filtering
    - 70k+ edges: very strong filtering

    Returns: (org_min_degree, actor_min_degree, k_core, min_edge_weight)
    """
    if edge_count < 1000:
        return 1, 1, 0, 1  # Keep all
    elif edge_count < 10000:
        return 4, 2, 3, 1  # Minimal filtering
    elif edge_count < 30000:
        return 1, 1, 2, 2  # Light filtering
    elif edge_count < 40000:
        return 2, 2, 2, 2  # Medium filtering
    elif edge_count < 70000:
        return 2, 2, 2, 2  # Strong filtering
    else:
        return 5, 5, 3, 2  # Very strong filtering


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
    # Split bipartite sets (deduplicate to avoid phantom zero-sum columns in the matrix)
    org_ids = list(dict.fromkeys(n["id"] for n in nodes if n.get("type") == "org"))
    actor_ids = list(dict.fromkeys(n["id"] for n in nodes if n.get("type") != "org"))

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

    # Skip community detection if graph is too small (n_clusters > n_samples)
    if n_clusters > X.shape[0]:
        print(f"Skipping community detection: n_clusters={n_clusters} > n_samples={X.shape[0]}")
        node_to_community = {n["id"]: -1 for n in nodes}
        return node_to_community, []

    model = SpectralCoclustering(n_clusters=n_clusters, random_state=42)
    try:
        model.fit(X)
    except (ValueError, np.linalg.LinAlgError):
        print(f"SpectralCoclustering failed, skipping community detection")
        node_to_community = {n["id"]: -1 for n in nodes}
        return node_to_community, []

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
    procedure=None,    graph_type="bipartite",):
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

    # Apply procedure filter for MEP mode (replaces timeline when selected)
    if procedure and procedure != 'all' and 'related_procedure' in meetings_df.columns:
        meetings_df = meetings_df[meetings_df['related_procedure'] == procedure].copy()
        print(f"Procedure filter applied: {procedure}")
        print(f"Meetings matching procedure: {len(meetings_df):,}")

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

    # For projections, skip bipartite-specific filtering (degree, k-core)
    # For bipartite, apply automatic filtering based on edge count
    if graph_type in ('politicians', 'organizations'):
        print(f"Graph type is {graph_type} projection - skipping bipartite degree/k-core filters")
        # Only light weight filtering for projections
        org_min_degree, actor_min_degree, bipartite_k_core, min_edge_weight = 1, 1, 1, 1
    else:
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

    # Apply structural filtering only for bipartite graphs
    if graph_type == 'bipartite':
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
    else:
        # For projections, no degree-based filtering - disparity filter handles noise
        edges = edges_agg

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

    # Apply one-mode projection if requested
    if graph_type in ('politicians', 'organizations'):
        print(f"Computing {graph_type} one-mode projection...")
        print(f"  Input: {len(graph['nodes'])} nodes, {len(graph['links'])} edges")
        
        # Convert D3 graph format to edge/node dicts for projection
        nodes_for_proj = [
            {
                'id': str(n['id']),
                'type': n.get('type', 'unknown'),
                'label': n.get('label', ''),
            }
            for n in graph['nodes']
        ]
        
        edges_for_proj = [
            {
                'source': str(link['source']),
                'target': str(link['target']),
                'value': link.get('value', 1),
            }
            for link in graph['links']
        ]
        
        # Project to one-mode
        if graph_type == 'politicians':
            proj_nodes, proj_edges = project_politicians(nodes_for_proj, edges_for_proj)
        else:  # organizations
            proj_nodes, proj_edges = project_organizations(nodes_for_proj, edges_for_proj)
        
        print(f"  After projection: {len(proj_nodes)} nodes, {len(proj_edges)} edges")
        
        # Use backbone extraction for very large projections (>300k edges)
        if len(proj_edges) > 300000:
            print(f"  Very large projection ({len(proj_edges)} edges) - applying backbone extraction...")
            
            # Recompute with IDF weighting instead of simple shared-count weighting
            actor_type = 'mep' if mode == 'mep' else 'commission_employee' if mode == 'commission' else 'mep'
            proj_nodes, proj_edges = idf_weighted_projection(
                nodes_for_proj, 
                edges_for_proj,
                actor_type_field=actor_type
            )
            print(f"  IDF projection: {len(proj_nodes)} nodes, {len(proj_edges)} edges")
            
            # Apply IDF percentile filter (98th percentile)
            proj_nodes, proj_edges = apply_idf_percentile_filter(proj_edges, proj_nodes, percentile=98)
            print(f"  After IDF 98th percentile filter: {len(proj_nodes)} nodes, {len(proj_edges)} edges")
            
            # Hybrid filtering - use data-driven tau (min weight of shared=2 edges)
            tau = suggest_tau_for_singles(proj_edges)
            proj_edges, proj_nodes = hybrid_filter_edges(proj_edges, proj_nodes, tau)
            print(f"  After hybrid filter (data-driven tau={tau:.4f}): {len(proj_nodes)} nodes, {len(proj_edges)} edges")
            
            # Apply k-core=5 pruning to reduce node-to-edge ratio
            print(f"  Applying k-core=5 pruning to backbone...")
            edges_df = pd.DataFrame([
                {'source': str(e['source']), 'target': str(e['target']), 'value': e.get('value', 1)}
                for e in proj_edges
            ])
            edges_pruned = bipartite_k_core_prune(
                edges_df,
                k=5,
                verbose=False,
                actor_label='node'
            )
            
            # Update proj_edges and proj_nodes
            pruned_node_ids = set()
            for _, row in edges_pruned.iterrows():
                pruned_node_ids.add(str(row['source']))
                pruned_node_ids.add(str(row['target']))
            
            proj_edges = [
                {
                    'source': str(e['source']),
                    'target': str(e['target']),
                    'value': e.get('value', 1),
                }
                for e in proj_edges
                if str(e['source']) in pruned_node_ids and str(e['target']) in pruned_node_ids
            ]
            proj_nodes = [n for n in proj_nodes if str(n['id']) in pruned_node_ids]
            print(f"  After k-core=5 pruning: {len(proj_nodes)} nodes, {len(proj_edges)} edges")
        else:
            # For smaller projections, use simpler filtering
            # Determine filter aggressiveness based on edge count
            if len(proj_edges) > 50000:
                print(f"  Large projection detected ({len(proj_edges)} edges) - applying harsh filtering")
                alpha_disp = 0.001  # Very strict disparity filter
                min_degree_proj = 5  # High minimum degree
            elif len(proj_edges) > 20000:
                print(f"  Medium-large projection ({len(proj_edges)} edges) - applying moderate filtering")
                alpha_disp = 0.01
                min_degree_proj = 3
            else:
                alpha_disp = 0.02
                min_degree_proj = 2
            
            # Apply disparity filter to remove noise (more aggressive than bipartite)
            if proj_edges:
                proj_edges, proj_nodes = apply_disparity_filter(proj_edges, proj_nodes, alpha=alpha_disp)
                print(f"  After disparity filter (alpha={alpha_disp}): {len(proj_nodes)} nodes, {len(proj_edges)} edges")
            
            # Further prune by minimum degree for one-mode projections
            if proj_edges:
                degree_count = {}
                for edge in proj_edges:
                    degree_count[edge['source']] = degree_count.get(edge['source'], 0) + 1
                    degree_count[edge['target']] = degree_count.get(edge['target'], 0) + 1
                
                # Filter out low-degree nodes
                high_degree_nodes = {node_id for node_id, degree in degree_count.items() if degree >= min_degree_proj}
                proj_edges = [e for e in proj_edges if e['source'] in high_degree_nodes and e['target'] in high_degree_nodes]
                proj_nodes = [n for n in proj_nodes if n['id'] in high_degree_nodes]
                print(f"  After degree filter (min_degree={min_degree_proj}): {len(proj_nodes)} nodes, {len(proj_edges)} edges")
        
        if not proj_nodes or not proj_edges:
            print(f"  WARNING: Projection resulted in empty graph, keeping original bipartite")
        else:
            # Convert back to D3 format
            graph['nodes'] = [
                {
                    'id': str(n['id']),
                    'type': n.get('type', 'unknown'),
                    'label': n.get('label', ''),
                    'name': n.get('label', ''),
                }
                for n in proj_nodes
            ]
            
            graph['links'] = [
                {
                    'source': str(e['source']),
                    'target': str(e['target']),
                    'value': e.get('value', 1),
                }
                for e in proj_edges
            ]
            print(f"  Projection complete: {len(graph['nodes'])} nodes, {len(graph['links'])} edges in final graph")

    # Detect communities - use Louvain for projections, SpectralCoclustering for bipartite
    if graph_type in ('politicians', 'organizations'):
        print(f"Running Louvain community detection on {len(graph['nodes'])} nodes...")
        node_to_community, community_stats = detect_communities_louvain(graph['nodes'], graph['links'], resolution=1.5)
        community_method = 'louvain'
    else:
        print(f"Running community detection on {len(graph['nodes'])} nodes...")
        node_to_community, community_stats = detect_communities(graph['nodes'], graph['links'])
        community_method = 'spectral_coclustering'

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
        'community_method': community_method,
        'graph_type': graph_type,
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
    - procedure: procedure code or 'all' (default: 'all')
    - graphType: 'bipartite', 'politicians', or 'organizations' (default: 'bipartite')

    Note: ALL filtering parameters are now automatically determined
    based on the initial edge count. One-mode projections are computed
    before any pruning, ensuring accurate representation.
    """
    try:
        mode = request.args.get('mode', 'full')
        if mode not in ('mep', 'commission', 'full'):
            mode = 'full'

        keep_isolates = request.args.get('keep_isolates', 'false').lower() == 'true'

        start = request.args.get('start')
        end = request.args.get('end')
        procedure = request.args.get('procedure', 'all')
        graph_type = request.args.get('graphType', 'bipartite')
        if graph_type not in ('bipartite', 'politicians', 'organizations'):
            graph_type = 'bipartite'

        graph = build_graph(
            mode=mode,
            keep_isolates=keep_isolates,
            start=start,
            end=end,
            procedure=procedure,
            graph_type=graph_type,
        )

        # Convert to proper JSON-serializable format
        return Response(json.dumps(graph), mimetype='application/json')

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


@app.route('/api/graph-procedures')
def get_graph_procedures():
    """Get list of procedures from MEP meetings data with >100 meetings (for graph filtering)."""
    try:
        meetings_df = pd.read_json(MEETINGS_JSON)

        # Extract procedures with >100 meetings
        if 'related_procedure' in meetings_df.columns:
            proc_counts = meetings_df[meetings_df['related_procedure'].notna()].groupby('related_procedure').size()
            procedures = sorted(proc_counts[proc_counts > 100].index.tolist())
            print(f"Loaded {len(procedures)} procedures with >100 meetings from MEP data")
        else:
            procedures = []
            print("Warning: 'related_procedure' column not found in MEP data")

        return jsonify({'procedures': procedures})
    except Exception as e:
        print(f"Error loading procedures: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'procedures': [], 'error': str(e)}), 500


@app.route('/api/cache/clear', methods=['POST'])
def clear_cache():
    """POST /api/cache/clear — Force-clear all in-memory caches."""
    global _meetings_cache, _meps_cache, _meetings_csv_mtime, _meps_csv_mtime
    _meetings_cache = None
    _meps_cache = None
    _meetings_csv_mtime = None
    _meps_csv_mtime = None
    return jsonify({'status': 'cleared'})



# ============ MEP Meetings Endpoints ============

import csv

MEETINGS_CSV_PATH = os.path.join(PROJECT_ROOT, 'data', 'ep_meetings_all.csv')
MEPS_CSV_PATH = os.path.join(PROJECT_ROOT, 'data', 'ep_meps.csv')

# Cache for data — automatically invalidated when CSV files change
_meetings_cache = None
_meps_cache = None
_meetings_csv_mtime = None
_meps_csv_mtime = None


def _check_csv_freshness():
    """Invalidate in-memory caches if CSV files have been modified."""
    global _meetings_cache, _meps_cache, _meetings_csv_mtime, _meps_csv_mtime

    try:
        meetings_mtime = os.path.getmtime(MEETINGS_CSV_PATH)
        if _meetings_csv_mtime is not None and meetings_mtime != _meetings_csv_mtime:
            _meetings_cache = None
            _meetings_csv_mtime = None
    except OSError:
        pass

    try:
        meps_mtime = os.path.getmtime(MEPS_CSV_PATH)
        if _meps_csv_mtime is not None and meps_mtime != _meps_csv_mtime:
            _meps_cache = None
            _meps_csv_mtime = None
    except OSError:
        pass


def load_meps_lookup():
    """Load MEPs data and return lookup dict by ID."""
    global _meps_cache, _meps_csv_mtime
    _check_csv_freshness()
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
        try:
            _meps_csv_mtime = os.path.getmtime(MEPS_CSV_PATH)
        except OSError:
            pass
    return _meps_cache

def load_meetings_data():
    """Load and cache meetings data from CSV, enriched with MEP info.

    Always collapses rows into one record per unique meeting (mep_id, title, date),
    collecting all attendees into a list. Uses meeting_id from CSV if available.
    """
    global _meetings_cache, _meetings_csv_mtime
    _check_csv_freshness()
    if _meetings_cache is None:
        meps = load_meps_lookup()

        # Group all rows by unique meeting key
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

        # Always collapse into one record per meeting
        _meetings_cache = []

        for meeting_key, rows in meetings_grouped.items():
            mep_id, title, meeting_date = meeting_key
            mep_info = meps.get(mep_id, {})
            committees = mep_info.get('committees', [])

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
                'meeting_id': first_row.get('meeting_id', ''),
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

        try:
            _meetings_csv_mtime = os.path.getmtime(MEETINGS_CSV_PATH)
        except OSError:
            pass

    print(f"[CACHE] meetings_cache built: {len(_meetings_cache)} entries")
    return _meetings_cache



@app.route('/api/meps')
def get_meps():
    """
    GET /api/meps
    Returns list of all MEPs with their meeting counts.
    """
    try:
        meetings = load_meetings_data()
        print(f"[/api/meps] cache size: {len(meetings)}")

        # Aggregate MEP info — each record is one meeting (already collapsed)
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
        total_meetings = sum(m['meeting_count'] for m in mep_list)
        print(f"[/api/meps] {len(mep_list)} MEPs, total meeting_count sum: {total_meetings}, top: {mep_list[0]['name']}={mep_list[0]['meeting_count']}")

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
        print(f"[/api/timeline] filters: mep={mep_filter} committee={committee_filter} procedure={procedure_filter} org={organization_filter} ep={ep_period}")
        print(f"[/api/timeline] starting with {len(filtered)} meetings")

        # Apply filters
        if mep_filter:
            try:
                mep_id = int(mep_filter)
                filtered = [m for m in filtered if m.get('mep_id') == mep_id]
                print(f"[/api/timeline] after mep filter: {len(filtered)}")
            except ValueError:
                return jsonify({'error': 'Invalid MEP ID', 'timeline': []}), 400

        if committee_filter:
            filtered = [m for m in filtered if committee_filter in m.get('mep_committees', [])]
            print(f"[/api/timeline] after committee filter: {len(filtered)}")

        if procedure_filter:
            filtered = [m for m in filtered if m.get('related_procedure') == procedure_filter]
            print(f"[/api/timeline] after procedure filter: {len(filtered)}")

        if organization_filter:
            org_lower = organization_filter.lower()
            filtered = [m for m in filtered
                       if any(org_lower in att.get('name', '').lower() for att in m.get('attendees', []))]
            print(f"[/api/timeline] after org filter: {len(filtered)}")

        # Apply EP period filter
        if ep_period == 'ep9':
            filtered = [m for m in filtered if m.get('meeting_date', '') <= EP9_END_DATE]
            print(f"[/api/timeline] after EP9 filter: {len(filtered)}")
        elif ep_period == 'ep10':
            filtered = [m for m in filtered if m.get('meeting_date', '') >= EP10_START_DATE]
            print(f"[/api/timeline] after EP10 filter: {len(filtered)}")
        # 'both' or any other value means no date filtering
        print(f"[/api/timeline] final count: {len(filtered)}")

        # Aggregate by week
        from datetime import datetime
        weekly_data = {}
        meps_involved = set()

        from datetime import timedelta

        for m in filtered:
            date = m.get('meeting_date')
            mep_id = m.get('mep_id')
            if date:
                try:
                    dt = datetime.strptime(date, '%Y-%m-%d')
                    monday = dt - timedelta(days=dt.weekday())
                    week_key = monday.strftime('%d-%m-%Y')
                except:
                    continue

                if week_key not in weekly_data:
                    weekly_data[week_key] = {'count': 0, 'meetings': [], 'sort_date': monday}

                weekly_data[week_key]['count'] += 1
                weekly_data[week_key]['meetings'].append({
                    'date': date,
                    'title': m.get('title', ''),
                    'attendee_count': len(m.get('attendees', [])),
                    'procedure': m.get('related_procedure'),
                    'organizations': [att.get('name', '') for att in m.get('attendees', []) if att.get('name')],
                })
            if mep_id:
                meps_involved.add(mep_id)

        timeline = [
            {'week': k, 'count': v['count'], 'meetings': v['meetings']}
            for k, v in sorted(weekly_data.items(), key=lambda x: x[1]['sort_date'])
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
        from datetime import datetime, timedelta
        weekly_data = {}
        for m in mep_meetings:
            date = m.get('meeting_date')
            if date:
                try:
                    dt = datetime.strptime(date, '%Y-%m-%d')
                    monday = dt - timedelta(days=dt.weekday())
                    week_key = monday.strftime('%d-%m-%Y')
                except:
                    continue

                if week_key not in weekly_data:
                    weekly_data[week_key] = {'count': 0, 'meetings': [], 'sort_date': monday}

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
            for k, v in sorted(weekly_data.items(), key=lambda x: x[1]['sort_date'])
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
        total_count = sum(c['count'] for c in committee_list)
        print(f"[/api/committees] {len(committee_list)} committees, total meetings sum: {total_count}, top: {committee_list[0]['acronym']}={committee_list[0]['count']}")

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
        total_count = sum(p['count'] for p in procedure_list)
        print(f"[/api/procedures] {len(procedure_list)} procedures, total meetings sum: {total_count}, top: {procedure_list[0]['procedure']}={procedure_list[0]['count']}")

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

        # Aggregate by month (deduplicated)
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


@app.route('/api/procedure-events')
def get_procedure_events_endpoint():
    """
    GET /api/procedure-events?procedure=2023/0212(COD)&force=false
    Returns OEIL key events and documentation gateway items for a procedure.
    """
    try:
        procedure = request.args.get('procedure')
        if not procedure:
            return jsonify({'error': 'procedure parameter required'}), 400

        force = request.args.get('force', 'false').lower() == 'true'

        from scrapers.scrape_oeil_events import get_procedure_events
        result = get_procedure_events(procedure, force=force)

        return jsonify(result)

    except Exception as e:
        return jsonify({'error': str(e), 'key_events': [], 'documentation_gateway': []}), 502



@app.route('/api/analyze-document', methods=['POST'])
def analyze_document_endpoint():
    """
    POST /api/analyze-document
    Analyzes a legislative PDF document. Analysis strategy depends on document type.

    JSON body:
    - document_url: URL of the PDF document (required)
    - mep_name: Full name of the MEP (required for amendment docs, optional otherwise)
    - document_ref: Optional document reference string
    - force: Force re-analysis, bypass cache (default: false)
    """
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': 'JSON body required'}), 400

        mep_name = data.get('mep_name', '')
        document_url = data.get('document_url')
        document_ref = data.get('document_ref', '')
        force = data.get('force', False)

        if not document_url:
            return jsonify({'error': 'document_url is required'}), 400

        from api.document_analyzer import analyze_document
        result = analyze_document(
            document_url=document_url,
            mep_name=mep_name,
            document_ref=document_ref,
            force=force,
        )

        status = 200 if 'error' not in result else 422
        return jsonify(result), status

    except Exception as e:
        return jsonify({'error': str(e)}), 500



if __name__ == '__main__':
    print("Starting local development server with FULLY AUTOMATIC FILTERING...")
    print("API endpoint: http://localhost:5001/api/graph")
    print("\nAvailable parameters:")
    print("  mode: mep, commission, full (default: full)")
    print("  keep_isolates: true/false (default: false)")
    print("  start/end: YYYY-MM-DD date range (inclusive)")
    print("\nExample: http://localhost:5001/api/graph?mode=full&start=2024-03-01&end=2025-06-30")
    app.run(host='0.0.0.0', port=5001, debug=True, threaded=True)
