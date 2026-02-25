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

    # Skip community detection if graph is too small (n_clusters > n_samples)
    if n_clusters > X.shape[0]:
        print(f"Skipping community detection: n_clusters={n_clusters} > n_samples={X.shape[0]}")
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


@app.route('/api/procedures')
def get_procedures():
    """Get list of procedures from MEP meetings data with >100 meetings."""
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


if __name__ == '__main__':
    print("Starting local development server with FULLY AUTOMATIC FILTERING...")
    print("API endpoint: http://localhost:5001/api/graph")
    print("\nAvailable parameters:")
    print("  mode: mep, commission, full (default: full)")
    print("  keep_isolates: true/false (default: false)")
    print("  start/end: YYYY-MM-DD date range (inclusive)")
    print("\nExample: http://localhost:5001/api/graph?mode=full&start=2024-03-01&end=2025-06-30")
    app.run(host='0.0.0.0', port=5001, debug=True, threaded=True)