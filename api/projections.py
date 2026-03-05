"""
One-mode projection logic for bipartite graphs.

Converts bipartite graphs (politicians ↔ organizations) into one-mode projections:
- Politician-to-politician network: connected if they attended same meetings
- Organization-to-organization network: connected if they attended same meetings

Uses disparity filter to reduce noise in projections.
Includes Louvain community detection for one-mode networks.
"""

import math
from collections import Counter
from typing import Tuple, Dict, List, Any

import numpy as np
import networkx as nx
import pandas as pd
from community.community_louvain import best_partition
from scipy.sparse import csr_matrix, coo_matrix, lil_matrix


def project_politicians(
    nodes: List[Dict[str, Any]],
    edges: List[Dict[str, Any]],
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """
    Project bipartite graph to politician-only network.
    
    Politicians are connected if they attended the same organization/meeting.
    Edge weight = number of shared organizations/meetings.
    
    Args:
        nodes: List of node dicts with 'id', 'type', 'group' fields
        edges: List of edge dicts with 'source', 'target', 'value' fields
    
    Returns:
        (proj_nodes, proj_edges): Projected politician network
    """
    # Separate politicians and organizations
    # Note: MEPs have type='mep', orgs have type='org' in the D3 graph
    politician_ids = [n['id'] for n in nodes if n.get('type') in ('mep', 'politician', 'commission_employee')]
    org_ids = [n['id'] for n in nodes if n.get('type') in ('org', 'organization')]
    
    if not politician_ids or not org_ids:
        # No projection possible
        return [], []
    
    # Build politician → organization mapping
    pol_to_org = {pol: [] for pol in politician_ids}
    org_to_pol = {org: [] for org in org_ids}
    
    # Track edge weights
    edge_weights = {}
    for edge in edges:
        src, tgt = edge['source'], edge['target']
        weight = edge.get('value', 1)
        
        # Determine direction (politician → org)
        if src in politician_ids and tgt in org_ids:
            if src not in pol_to_org:
                pol_to_org[src] = []
            pol_to_org[src].append((tgt, weight))
            if tgt not in org_to_pol:
                org_to_pol[tgt] = []
            org_to_pol[tgt].append(src)
        elif tgt in politician_ids and src in org_ids:
            if tgt not in pol_to_org:
                pol_to_org[tgt] = []
            pol_to_org[tgt].append((src, weight))
            if src not in org_to_pol:
                org_to_pol[src] = []
            org_to_pol[src].append(tgt)
    
    # Build politician-to-politician edges
    proj_edges_dict = {}  # (source, target) → weight
    for pol1 in politician_ids:
        orgs1 = pol_to_org.get(pol1, [])
        org_ids_1 = [o[0] for o in orgs1]
        
        for pol2 in politician_ids:
            if pol1 >= pol2:  # Avoid duplicates and self-loops
                continue
            
            orgs2 = pol_to_org.get(pol2, [])
            org_ids_2 = [o[0] for o in orgs2]
            
            # Shared organizations
            shared = set(org_ids_1) & set(org_ids_2)
            if shared:
                weight = len(shared)
                edge_key = tuple(sorted([pol1, pol2]))
                proj_edges_dict[edge_key] = weight
    
    # Convert to edge list with disparity filtering
    proj_edges = [
        {
            'source': src,
            'target': tgt,
            'value': weight,
        }
        for (src, tgt), weight in proj_edges_dict.items()
    ]
    
    # Keep only politician nodes that have connections
    connected_politicians = set()
    for edge in proj_edges:
        connected_politicians.add(edge['source'])
        connected_politicians.add(edge['target'])
    
    proj_nodes = [n for n in nodes if n['id'] in connected_politicians]
    
    return proj_nodes, proj_edges


def project_organizations(
    nodes: List[Dict[str, Any]],
    edges: List[Dict[str, Any]],
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """
    Project bipartite graph to organization-only network.
    
    Organizations are connected if they have common politicians/members.
    Edge weight = number of shared politicians.
    
    Args:
        nodes: List of node dicts with 'id', 'type', 'group' fields
        edges: List of edge dicts with 'source', 'target', 'value' fields
    
    Returns:
        (proj_nodes, proj_edges): Projected organization network
    """
    # Separate politicians and organizations
    # Note: MEPs have type='mep', orgs have type='org' in the D3 graph
    politician_ids = [n['id'] for n in nodes if n.get('type') in ('mep', 'politician', 'commission_employee')]
    org_ids = [n['id'] for n in nodes if n.get('type') in ('org', 'organization')]
    
    if not politician_ids or not org_ids:
        # No projection possible
        return [], []
    
    # Build org → politician mapping
    org_to_pol = {org: [] for org in org_ids}
    pol_to_org = {pol: [] for pol in politician_ids}
    
    for edge in edges:
        src, tgt = edge['source'], edge['target']
        
        # Determine direction (politician → org)
        if src in politician_ids and tgt in org_ids:
            org_to_pol[tgt].append(src)
            pol_to_org[src].append(tgt)
        elif tgt in politician_ids and src in org_ids:
            org_to_pol[src].append(tgt)
            pol_to_org[tgt].append(src)
    
    # Build organization-to-organization edges
    proj_edges_dict = {}  # (source, target) → weight
    for org1 in org_ids:
        pols1 = org_to_pol.get(org1, [])
        
        for org2 in org_ids:
            if org1 >= org2:  # Avoid duplicates and self-loops
                continue
            
            pols2 = org_to_pol.get(org2, [])
            
            # Shared politicians
            shared = set(pols1) & set(pols2)
            if shared:
                weight = len(shared)
                edge_key = tuple(sorted([org1, org2]))
                proj_edges_dict[edge_key] = weight
    
    # Convert to edge list
    proj_edges = [
        {
            'source': src,
            'target': tgt,
            'value': weight,
        }
        for (src, tgt), weight in proj_edges_dict.items()
    ]
    
    # Keep only org nodes that have connections
    connected_orgs = set()
    for edge in proj_edges:
        connected_orgs.add(edge['source'])
        connected_orgs.add(edge['target'])
    
    proj_nodes = [n for n in nodes if n['id'] in connected_orgs]
    
    return proj_nodes, proj_edges


def apply_disparity_filter(
    edges: List[Dict[str, Any]],
    nodes: List[Dict[str, Any]],
    alpha: float = 0.05,
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """
    Apply disparity filter to one-mode projection.
    
    Removes weak edges based on statistical significance.
    For each node, the normalized weight of an edge should exceed
    a threshold based on the node's total degree.
    
    For very sparse projections, skips filtering to preserve connectivity.
    
    Args:
        edges: Edge list with 'value' (weight) field
        nodes: Node list (to check connectivity)
        alpha: Significance threshold (0.05 = 5% significance level)
    
    Returns:
        (filtered_edges, filtered_nodes): Edges/nodes passing disparity filter
    """
    if not edges:
        return [], []
    
    # For very sparse projections (few edges), skip filtering to preserve connectivity
    if len(edges) < 10:
        connected_nodes = set()
        for edge in edges:
            connected_nodes.add(edge['source'])
            connected_nodes.add(edge['target'])
        filtered_nodes = [n for n in nodes if n['id'] in connected_nodes]
        return edges, filtered_nodes
    
    # Calculate node strengths (sum of incident edge weights)
    node_strength = {}
    for edge in edges:
        src, tgt = edge['source'], edge['target']
        weight = edge.get('value', 1)
        
        node_strength[src] = node_strength.get(src, 0) + weight
        node_strength[tgt] = node_strength.get(tgt, 0) + weight
    
    # Filter edges based on disparity
    filtered_edges = []
    for edge in edges:
        src, tgt = edge['source'], edge['target']
        weight = edge.get('value', 1)
        
        # Normalized weights
        if node_strength[src] > 0:
            norm_src = weight / node_strength[src]
        else:
            norm_src = 0
        
        if node_strength[tgt] > 0:
            norm_tgt = weight / node_strength[tgt]
        else:
            norm_tgt = 0
        
        # Both endpoints must pass disparity threshold
        # Using (n-1) as degree of freedom where n = node degree
        # Threshold = alpha^(1/(k-1)) but simplified to check normalized weight > alpha
        if norm_src > alpha or norm_tgt > alpha:
            filtered_edges.append(edge)
    
    # Keep only nodes with connections
    connected_nodes = set()
    for edge in filtered_edges:
        connected_nodes.add(edge['source'])
        connected_nodes.add(edge['target'])
    
    filtered_nodes = [n for n in nodes if n['id'] in connected_nodes]
    
    return filtered_edges, filtered_nodes

def detect_communities_louvain(
    nodes: List[Dict[str, Any]],
    edges: List[Dict[str, Any]],
    resolution: float = 1.0,
) -> Tuple[Dict[str, int], List[Dict[str, Any]]]:
    """
    Detect communities in one-mode projection using Louvain algorithm.
    
    Louvain is optimized for unipartite networks and finds communities
    by maximizing modularity.
    
    Args:
        nodes: List of node dicts with 'id' field
        edges: List of edge dicts with 'source', 'target', 'value' fields
        resolution: Resolution parameter (0.5-2.0; higher = more communities)
    
    Returns:
        (node_to_community, community_stats): Community assignments and statistics
    """
    if not nodes or not edges:
        return {}, []
    
    # Build NetworkX graph
    G = nx.Graph()
    
    # Add nodes
    for node in nodes:
        G.add_node(str(node['id']))
    
    # Add edges with weights
    for edge in edges:
        src = str(edge['source'])
        tgt = str(edge['target'])
        weight = edge.get('value', 1)
        G.add_edge(src, tgt, weight=weight)
    
    # Handle disconnected graphs - process largest component
    if not nx.is_connected(G):
        # Get largest connected component
        largest_cc = max(nx.connected_components(G), key=len)
        G = G.subgraph(largest_cc).copy()
        print(f"  Graph has multiple components, using largest ({len(G.nodes())} nodes)")
    
    # Run Louvain algorithm with resolution parameter
    partition = best_partition(G, weight='weight', resolution=resolution, randomize=None, random_state=42)
    
    # Count raw community sizes
    community_counts = {}
    for node_id, comm_id in partition.items():
        community_counts[comm_id] = community_counts.get(comm_id, 0) + 1

    # Remap top 6 communities to 0-5, everything else to -1
    sorted_communities = sorted(community_counts.items(), key=lambda x: x[1], reverse=True)
    top6 = [c for c, _ in sorted_communities[:6]]
    remap = {c: i for i, c in enumerate(top6)}

    node_to_community = {}
    for node_id, comm_id in partition.items():
        node_to_community[node_id] = remap.get(comm_id, -1)

    # Also remap nodes not in the largest component (not in partition)
    for node in nodes:
        nid = str(node['id'])
        if nid not in node_to_community:
            node_to_community[nid] = -1

    total_nodes = len(nodes)
    community_stats = [
        {
            'id': remap[c],
            'size': count,
            'percentage': round(count / total_nodes * 100, 1),
        }
        for c, count in sorted_communities[:6]
    ]

    return node_to_community, community_stats


def label_communities_tfidf(
    nodes: List[Dict[str, Any]],
    node_to_community: Dict[str, int],
    orgs_df: pd.DataFrame,
    max_terms: int = 2,
) -> Dict[int, str]:
    """
    Generate descriptive labels for communities using TF-IDF over policy_focus_areas.

    For each community, finds the policy areas that are most distinctive
    (frequent in this cluster but rare across others) and returns a short label.

    Args:
        nodes: Graph nodes (org nodes with 'id' field)
        node_to_community: Mapping of node_id -> community_id
        orgs_df: Full organizations DataFrame (must have 'id' and 'policy_focus_areas')
        max_terms: Number of top TF-IDF terms per label (default 2)

    Returns:
        Dict mapping community_id -> label string (e.g. "Banking & Financial Services / Digital Economy")
    """
    if "policy_focus_areas" not in orgs_df.columns:
        return {}

    # Build a lookup: org id -> policy_focus_areas list
    orgs_df = orgs_df.copy()
    orgs_df["id"] = orgs_df["id"].astype(str)
    pfa_lookup = {}
    for _, row in orgs_df[["id", "policy_focus_areas"]].dropna(subset=["policy_focus_areas"]).iterrows():
        areas = row["policy_focus_areas"]
        if isinstance(areas, list) and areas:
            pfa_lookup[row["id"]] = areas

    # Collect all community IDs (excluding -1)
    community_ids = sorted(set(c for c in node_to_community.values() if c >= 0))
    if not community_ids:
        return {}

    n_communities = len(community_ids)

    # Step 1: Count policy areas per community (TF)
    community_area_counts: Dict[int, Counter] = {c: Counter() for c in community_ids}
    for node in nodes:
        nid = str(node["id"])
        comm = node_to_community.get(nid, -1)
        if comm < 0:
            continue
        areas = pfa_lookup.get(nid, [])
        for area in areas:
            community_area_counts[comm][area] += 1

    # Step 2: Compute IDF — how many communities contain each area
    area_doc_freq: Counter = Counter()
    for comm_id in community_ids:
        areas_in_comm = set(community_area_counts[comm_id].keys())
        for area in areas_in_comm:
            area_doc_freq[area] += 1

    # Step 3: TF-IDF per community
    # Areas that appear in every community get idf=0 (fully suppressed)
    labels: Dict[int, str] = {}
    for comm_id in community_ids:
        counts = community_area_counts[comm_id]
        if not counts:
            labels[comm_id] = f"Community {comm_id}"
            continue

        total = sum(counts.values())
        scored = []
        for area, count in counts.items():
            tf = count / total
            idf = math.log(n_communities / area_doc_freq[area])  # 0 when area is in all communities
            scored.append((area, tf * idf))

        scored.sort(key=lambda x: x[1], reverse=True)

        # Pick top terms, skipping near-duplicates (e.g. "Culture" vs "Culture and media")
        top_terms = []
        for area, score in scored:
            if score <= 0:
                break
            if len(top_terms) >= max_terms:
                break
            area_lower = area.lower()
            if any(area_lower in t.lower() or t.lower() in area_lower for t in top_terms):
                continue
            top_terms.append(area)

        # Fallback: if all areas are ubiquitous (idf=0 for everything), use raw frequency
        if not top_terms:
            for area, _ in counts.most_common(max_terms + 2):
                area_lower = area.lower()
                if any(area_lower in t.lower() or t.lower() in area_lower for t in top_terms):
                    continue
                top_terms.append(area)
                if len(top_terms) >= max_terms:
                    break

        labels[comm_id] = " / ".join(top_terms) if top_terms else f"Community {comm_id}"

    return labels