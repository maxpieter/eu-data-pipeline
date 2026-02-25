"""
Backbone extraction for large one-mode projections using statistical methods.

Techniques:
- IDF-weighted projection: weight shared actors by log(|nodes| / degree)
- Hybrid filtering: keep shared >= 2 OR (shared == 1 AND idf_weight >= threshold)
- Hypergeometric + FDR: statistical significance test on shared counts with multiple testing correction
"""

import math
import itertools
from collections import defaultdict
from typing import Tuple, Dict, List, Any

import numpy as np
import pandas as pd
from scipy.stats import hypergeom
from statsmodels.stats.multitest import multipletests


def idf_weighted_projection(
    nodes: List[Dict[str, Any]],
    edges: List[Dict[str, Any]],
    actor_type_field: str = 'mep',
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """
    Create IDF-weighted one-mode projection.
    
    For organization projections: weight = sum of IDF of shared actors
    where IDF(a) = log(|orgs| / degree(a))
    
    Args:
        nodes: Node dicts with 'id', 'type' fields
        edges: Edge dicts with 'source', 'target' from bipartite
        actor_type_field: Node type for actors ('mep', 'commission_employee', etc.)
    
    Returns:
        (proj_nodes, proj_edges): Projected graph with IDF weights
    """
    # Separate actors and target nodes
    actor_ids = [n['id'] for n in nodes if n.get('type') == actor_type_field]
    target_ids = [n['id'] for n in nodes if n.get('type') != actor_type_field]
    
    if not actor_ids or not target_ids:
        return [], []
    
    # Build degree map for actors
    actor_degree = defaultdict(int)
    for edge in edges:
        src, tgt = edge['source'], edge['target']
        if src in actor_ids:
            actor_degree[src] += 1
        if tgt in actor_ids:
            actor_degree[tgt] += 1
    
    # Compute IDF for actors
    N = len(target_ids)  # total number of target nodes
    idf = {}
    for a in actor_ids:
        deg = actor_degree.get(a, 1)
        idf[a] = math.log(max(1, N / deg))
    
    # Build actor-to-targets map
    actor_to_targets = defaultdict(set)
    for edge in edges:
        src, tgt = edge['source'], edge['target']
        if src in actor_ids and tgt in target_ids:
            actor_to_targets[src].add(tgt)
        elif tgt in actor_ids and src in target_ids:
            actor_to_targets[tgt].add(src)
    
    # Compute projection edges
    shared = defaultdict(int)
    idf_weight = defaultdict(float)
    
    for a, targets in actor_to_targets.items():
        if len(targets) < 2:
            continue
        w = idf.get(a, 0.0)
        for u, v in itertools.combinations(sorted(targets), 2):
            key = tuple(sorted([u, v]))
            shared[key] += 1
            idf_weight[key] += w
    
    # Build projection graph
    proj_nodes = [n for n in nodes if n['id'] in target_ids]
    proj_edges = [
        {
            'source': key[0],
            'target': key[1],
            'value': float(idf_weight[key]),  # use IDF weight as edge weight
            'shared': int(shared[key]),  # number of shared actors
        }
        for key in shared.keys()
    ]
    
    return proj_nodes, proj_edges


def apply_idf_percentile_filter(
    proj_edges: List[Dict[str, Any]],
    proj_nodes: List[Dict[str, Any]],
    percentile: float = 99.99
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """
    Filter projection edges by IDF weight percentile.
    
    Args:
        proj_edges: Projection edges with 'value' (IDF weight) field
        proj_nodes: Projection nodes
        percentile: Keep only edges above this percentile (default 99.99)
    
    Returns:
        (filtered_nodes, filtered_edges): Nodes and edges after percentile filtering
    """
    if not proj_edges:
        return proj_nodes, proj_edges
    
    weights = [e.get('value', 0.0) for e in proj_edges]
    threshold = float(np.percentile(weights, percentile))
    
    filtered_edges = [e for e in proj_edges if e.get('value', 0.0) >= threshold]
    
    # Keep only nodes that still have edges
    edge_nodes = set()
    for e in filtered_edges:
        edge_nodes.add(e['source'])
        edge_nodes.add(e['target'])
    
    filtered_nodes = [n for n in proj_nodes if n['id'] in edge_nodes]
    
    return filtered_nodes, filtered_edges


def suggest_tau_for_singles(
    edges: List[Dict[str, Any]],
) -> float:
    """
    Suggest IDF weight threshold based on shared=2 edges.
    
    Takes the minimum weight of edges with shared=2, calibrating the 
    threshold to the lowest weight for 2-shared edges.
    """
    doubles = [
        e.get('value', 0.0) 
        for e in edges 
        if int(e.get('shared', 0)) == 2
    ]
    if not doubles:
        return 0.0
    # Return minimum weight of shared=2 edges
    return float(min(doubles))


def hybrid_filter_edges(
    edges: List[Dict[str, Any]],
    nodes: List[Dict[str, Any]],
    tau_idf: float,
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """
    Apply hybrid filtering rule.
    
    Keep edge if:
      - shared >= 2, OR
      - shared == 1 AND idf_weight >= tau_idf
    
    Args:
        edges: Edge list with 'shared' and 'value' fields
        nodes: Node list (to remove isolates)
        tau_idf: IDF weight threshold for single-shared edges
    
    Returns:
        (filtered_edges, filtered_nodes): Edges and nodes after hybrid filtering
    """
    filtered_edges = []
    for edge in edges:
        shared = int(edge.get('shared', 0))
        idf_w = float(edge.get('value', 0.0))
        
        # Hybrid rule: keep if shared >= 2 OR (shared == 1 AND weight >= tau)
        if (shared >= 2) or (shared == 1 and idf_w >= tau_idf):
            filtered_edges.append(edge)
    
    # Remove isolated nodes
    connected = set()
    for edge in filtered_edges:
        connected.add(edge['source'])
        connected.add(edge['target'])
    
    filtered_nodes = [n for n in nodes if n['id'] in connected]
    
    return filtered_edges, filtered_nodes


def hypergeom_fdr_backbone(
    bipartite_edges: List[Dict[str, Any]],
    bipartite_nodes: List[Dict[str, Any]],
    proj_edges: List[Dict[str, Any]],
    proj_nodes: List[Dict[str, Any]],
    actor_type_field: str = 'mep',
    alpha: float = 0.01,
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]], pd.DataFrame]:
    """
    Apply hypergeometric test + FDR correction on projection edges.
    
    Tests whether shared count is statistically significant.
    Null: actors randomly meet org pairs.
    
    Args:
        bipartite_edges: Original bipartite edges
        bipartite_nodes: Original bipartite nodes
        proj_edges: Projected edges to test
        proj_nodes: Projected nodes
        actor_type_field: Node type for actors
        alpha: FDR significance level
    
    Returns:
        (backbone_edges, backbone_nodes, stats_df): Significant edges, nodes, and test stats
    """
    # Build actor-to-targets for each node in projection
    actor_degree = defaultdict(int)
    for edge in bipartite_edges:
        src, tgt = edge['source'], edge['target']
        if src in [n['id'] for n in bipartite_nodes if n.get('type') == actor_type_field]:
            actor_degree[src] += 1
    
    N = len([n['id'] for n in bipartite_nodes if n.get('type') != actor_type_field])
    
    # Test each edge
    test_results = []
    for edge in proj_edges:
        u, v = edge['source'], edge['target']
        x = int(edge.get('shared', 1))  # observed shared count
        
        # Get degrees in bipartite (number of actors each org met)
        k_u = actor_degree.get(u, 1)
        k_v = actor_degree.get(v, 1)
        
        # Hypergeometric: N=total actors, K=deg(u), n=deg(v), x=shared
        # P[X >= x] = sum of hypergeom.pmf for values >= x
        p_value = float(hypergeom.sf(x - 1, N, k_u, k_v))
        
        test_results.append({
            'source': u,
            'target': v,
            'shared': x,
            'p': p_value,
            'idf_weight': float(edge.get('value', 0.0)),
        })
    
    # FDR correction
    if test_results:
        df = pd.DataFrame(test_results)
        reject, q_values, _, _ = multipletests(
            df['p'].values,
            method='fdr_bh',
            alpha=alpha
        )
        df['q'] = q_values
        df['significant'] = reject
        df_keep = df[reject].copy()
    else:
        df = pd.DataFrame(test_results)
        df_keep = pd.DataFrame()
    
    # Build backbone graph
    backbone_edges = []
    kept_nodes = set()
    
    for _, row in df_keep.iterrows():
        edge = {
            'source': row['source'],
            'target': row['target'],
            'value': float(row['idf_weight']),
            'shared': int(row['shared']),
        }
        backbone_edges.append(edge)
        kept_nodes.add(row['source'])
        kept_nodes.add(row['target'])
    
    backbone_nodes = [n for n in proj_nodes if n['id'] in kept_nodes]
    
    return backbone_edges, backbone_nodes, df
