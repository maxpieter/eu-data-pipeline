#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
04_cluster_graph.py

Compute cluster-based visualization data from the organization backbone.

Inputs:
  pickles/mep_org_backbone_idf_hybrid_hg_fdr.gpickle (from EU_lobbying-main)

Outputs:
  json/clusters_overview.json - Aggregated cluster nodes + inter-cluster edges
  json/cluster_detail_{id}.json - Per-cluster internal networks
"""

import json
import os
import pickle
import sys
from collections import defaultdict

import networkx as nx
from networkx.algorithms import community
from networkx.algorithms.community.quality import modularity

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
os.chdir(PROJECT_ROOT)
sys.path.append(PROJECT_ROOT)

# Path to the backbone pickle (in sibling project)
PICKLE_PATH = os.path.join(
    os.path.dirname(PROJECT_ROOT),
    "EU_lobbying-main",
    "pickles",
    "mep_org_backbone_idf_hybrid_hg_fdr.gpickle",
)

# Alternative: if pickles are copied to this project
LOCAL_PICKLE_PATH = os.path.join(PROJECT_ROOT, "pickles", "mep_org_backbone_idf_hybrid_hg_fdr.gpickle")

OUTPUT_DIR = os.path.join(PROJECT_ROOT, "json")


def load_backbone():
    """Load the organization backbone graph."""
    # Try local path first, then sibling project
    if os.path.exists(LOCAL_PICKLE_PATH):
        path = LOCAL_PICKLE_PATH
    elif os.path.exists(PICKLE_PATH):
        path = PICKLE_PATH
    else:
        raise FileNotFoundError(
            f"Could not find backbone pickle at:\n  {LOCAL_PICKLE_PATH}\n  {PICKLE_PATH}\n"
            "Run 02_backbone.py first or copy the pickle file."
        )

    print(f"Loading backbone from: {path}")
    with open(path, "rb") as f:
        return pickle.load(f)


def louvain_and_modularity(G, weight="weight", seed=42, label=None):
    """Run Louvain community detection and compute modularity."""
    comms = community.louvain_communities(G, weight=weight, seed=seed, resolution=1)
    Q = modularity(G, comms, weight=weight)
    print(f"Louvain: {len(comms)} communities" + (f" in {label}" if label else ""))
    print(f"Modularity: {Q:.3f}" + (f" for {label}" if label else ""))
    return comms, Q


def compute_cluster_density(G, nodes):
    """Compute edge density within a cluster."""
    n = len(nodes)
    if n < 2:
        return 0.0
    subgraph = G.subgraph(nodes)
    m = subgraph.number_of_edges()
    max_edges = n * (n - 1) / 2
    return m / max_edges


def get_top_members(G, nodes, top_n=5):
    """Get top N members by degree within cluster."""
    subgraph = G.subgraph(nodes)
    degrees = [(n, subgraph.degree(n)) for n in nodes]
    degrees.sort(key=lambda x: x[1], reverse=True)
    return [{"id": str(n), "label": G.nodes[n].get("label", str(n)), "degree": d} for n, d in degrees[:top_n]]


def aggregate_interests(G, nodes):
    """Aggregate interests across cluster members."""
    interests = defaultdict(int)
    for n in nodes:
        node_data = G.nodes[n]
        interest = node_data.get("interests")
        if interest and isinstance(interest, str) and interest.strip():
            interests[interest] += 1

    # Sort by count, return top 5
    sorted_interests = sorted(interests.items(), key=lambda x: x[1], reverse=True)
    return [{"interest": k, "count": v} for k, v in sorted_interests[:5]]


def extract_themes_from_orgs(G, nodes):
    """Extract thematic keywords from organization names."""
    # Keyword categories for thematic labeling
    theme_keywords = {
        "Energy & Climate": ["energy", "power", "electricity", "gas", "oil", "fuel", "climate", "renewable", "solar", "wind", "nuclear", "hydrogen", "carbon"],
        "Environment": ["environment", "environmental", "green", "ecology", "conservation", "nature", "wildlife", "wwf", "sustainable"],
        "Pharma & Health": ["pharma", "pharmaceutical", "health", "medical", "medicine", "hospital", "patient", "drug", "biotech", "vaccine"],
        "Tech & Digital": ["tech", "digital", "software", "internet", "data", "cyber", "ai", "artificial", "computing", "telecom", "mobile"],
        "Finance & Banking": ["bank", "finance", "financial", "investment", "insurance", "pension", "credit", "asset", "capital"],
        "Transport & Aviation": ["transport", "airline", "aviation", "rail", "shipping", "logistics", "freight", "port", "airport", "automotive", "car", "vehicle"],
        "Agriculture & Food": ["farm", "agriculture", "food", "dairy", "meat", "grain", "crop", "fish", "agri"],
        "Chemicals & Industry": ["chemical", "industrial", "manufacturing", "steel", "metal", "cement", "plastic", "material"],
        "Human Rights & NGO": ["rights", "humanitarian", "refugee", "amnesty", "democracy", "civil", "freedom", "charity"],
        "Trade & Business": ["trade", "commerce", "business", "chamber", "employer", "industry association", "federation"],
    }

    # Regional keywords
    region_keywords = {
        "German": ["german", "deutsch", "bundesverband", "verband"],
        "Nordic": ["finnish", "finland", "swedish", "sweden", "danish", "denmark", "nordic", "norwegian"],
        "Irish": ["irish", "ireland"],
        "French": ["french", "france", "française"],
        "Italian": ["italian", "italy", "italiana"],
        "Spanish": ["spanish", "spain", "española"],
        "Dutch": ["dutch", "netherlands", "nederland"],
        "Austrian": ["austrian", "austria", "österreich"],
    }

    # Count theme occurrences
    theme_counts = {theme: 0 for theme in theme_keywords}
    region_counts = {region: 0 for region in region_keywords}

    for n in nodes:
        name = G.nodes[n].get("label", "").lower()

        # Check themes
        for theme, keywords in theme_keywords.items():
            for kw in keywords:
                if kw in name:
                    theme_counts[theme] += 1
                    break

        # Check regions
        for region, keywords in region_keywords.items():
            for kw in keywords:
                if kw in name:
                    region_counts[region] += 1
                    break

    return theme_counts, region_counts


def generate_cluster_label(G, nodes, top_members, cluster_id):
    """Generate a thematic cluster label based on organization analysis."""
    if not nodes or len(nodes) < 3:
        if top_members:
            return top_members[0]["label"][:30]
        return f"Cluster {cluster_id}"

    theme_counts, region_counts = extract_themes_from_orgs(G, nodes)

    # Get top themes (more than 10% of cluster or at least 3 orgs)
    min_threshold = max(3, len(nodes) * 0.08)
    top_themes = [(theme, count) for theme, count in theme_counts.items() if count >= min_threshold]
    top_themes.sort(key=lambda x: x[1], reverse=True)

    # Get dominant region if any (more than 20% of cluster)
    region_threshold = len(nodes) * 0.15
    top_regions = [(region, count) for region, count in region_counts.items() if count >= region_threshold]
    top_regions.sort(key=lambda x: x[1], reverse=True)

    # Build label
    label_parts = []

    # Add region if dominant
    if top_regions:
        label_parts.append(top_regions[0][0])

    # Add top 1-2 themes
    if top_themes:
        label_parts.append(top_themes[0][0])
        if len(top_themes) > 1 and top_themes[1][1] >= min_threshold * 0.7:
            # Second theme is also significant
            label_parts.append(top_themes[1][0])

    if label_parts:
        return " / ".join(label_parts[:2])

    # Fallback to top member names
    if top_members:
        names = [m["label"][:20] for m in top_members[:2]]
        return " & ".join(names)

    return f"Cluster {cluster_id}"


def build_cluster_overview(G, communities):
    """Build the overview graph with clusters as super-nodes."""
    # Create node-to-cluster mapping
    node_to_cluster = {}
    for cluster_id, nodes in enumerate(communities):
        for node in nodes:
            node_to_cluster[node] = cluster_id

    # Build cluster nodes
    cluster_nodes = []
    for cluster_id, nodes in enumerate(communities):
        node_list = list(nodes)
        top_members = get_top_members(G, node_list)
        cluster_label = generate_cluster_label(G, node_list, top_members, cluster_id)
        cluster_nodes.append({
            "id": f"cluster_{cluster_id}",
            "cluster_id": cluster_id,
            "type": "cluster",
            "label": cluster_label,
            "size": len(node_list),
            "density": round(compute_cluster_density(G, node_list), 3),
            "top_members": top_members,
            "top_interests": aggregate_interests(G, node_list),
        })

    # Build inter-cluster edges
    inter_cluster_edges = defaultdict(lambda: {"weight": 0.0, "edge_count": 0})
    for u, v, data in G.edges(data=True):
        c_u = node_to_cluster.get(u)
        c_v = node_to_cluster.get(v)
        if c_u is not None and c_v is not None and c_u != c_v:
            # Ensure consistent edge key (smaller cluster first)
            edge_key = (min(c_u, c_v), max(c_u, c_v))
            inter_cluster_edges[edge_key]["weight"] += data.get("weight", 1.0)
            inter_cluster_edges[edge_key]["edge_count"] += 1

    # Convert to links array
    cluster_links = []
    for (c1, c2), edge_data in inter_cluster_edges.items():
        cluster_links.append({
            "source": f"cluster_{c1}",
            "target": f"cluster_{c2}",
            "weight": round(edge_data["weight"], 2),
            "edge_count": edge_data["edge_count"],
        })

    return {
        "nodes": cluster_nodes,
        "links": cluster_links,
        "metadata": {
            "total_clusters": len(communities),
            "total_nodes": G.number_of_nodes(),
            "total_edges": G.number_of_edges(),
        }
    }


def build_cluster_detail(G, cluster_id, nodes, all_communities, cluster_labels):
    """Build detailed internal network for a single cluster."""
    node_list = list(nodes)
    subgraph = G.subgraph(node_list)

    # Create node-to-cluster mapping for external connections
    node_to_cluster = {}
    for cid, cnodes in enumerate(all_communities):
        for node in cnodes:
            node_to_cluster[node] = cid

    # Build internal nodes
    detail_nodes = []
    for n in node_list:
        node_data = dict(G.nodes[n])
        detail_nodes.append({
            "id": str(n),
            "type": "org",
            "label": node_data.get("label", str(n)),
            "name": node_data.get("label", str(n)),
            "interests": node_data.get("interests"),
            "register_id": node_data.get("register_id"),
            "degree": subgraph.degree(n),
        })

    # Build internal links
    detail_links = []
    for u, v, data in subgraph.edges(data=True):
        detail_links.append({
            "source": str(u),
            "target": str(v),
            "weight": round(data.get("weight", 1.0), 2),
            "shared": data.get("shared", 1),
        })

    # Calculate external connections (to other clusters)
    external_connections = defaultdict(lambda: {"edge_count": 0, "weight": 0.0})
    node_set = set(node_list)
    for n in node_list:
        for neighbor in G.neighbors(n):
            if neighbor not in node_set:
                target_cluster = node_to_cluster.get(neighbor)
                if target_cluster is not None:
                    edge_data = G.edges[n, neighbor]
                    external_connections[target_cluster]["edge_count"] += 1
                    external_connections[target_cluster]["weight"] += edge_data.get("weight", 1.0)

    external_list = [
        {
            "cluster_id": cid,
            "cluster_label": cluster_labels.get(cid, f"Cluster {cid}"),
            "edge_count": data["edge_count"],
            "weight": round(data["weight"], 2),
        }
        for cid, data in sorted(external_connections.items(), key=lambda x: x[1]["edge_count"], reverse=True)
    ]

    return {
        "cluster_id": cluster_id,
        "cluster_label": cluster_labels.get(cluster_id, f"Cluster {cluster_id}"),
        "nodes": detail_nodes,
        "links": detail_links,
        "external_connections": external_list,
        "metadata": {
            "node_count": len(detail_nodes),
            "edge_count": len(detail_links),
            "density": round(compute_cluster_density(G, node_list), 3),
        }
    }


def main():
    # Ensure output directory exists
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    # Load backbone
    G = load_backbone()
    print(f"\nBackbone loaded: {G.number_of_nodes()} nodes, {G.number_of_edges()} edges")

    # Run Louvain community detection
    communities, Q = louvain_and_modularity(G, label="org backbone")

    # Sort communities by size (largest first)
    communities = sorted(communities, key=len, reverse=True)

    print(f"\nCluster sizes: {[len(c) for c in communities]}")

    # Build overview
    overview = build_cluster_overview(G, communities)
    overview_path = os.path.join(OUTPUT_DIR, "clusters_overview.json")
    with open(overview_path, "w") as f:
        json.dump(overview, f, indent=2)
    print(f"\nSaved: {overview_path}")

    # Create cluster labels lookup
    cluster_labels = {node["cluster_id"]: node["label"] for node in overview["nodes"]}
    print(f"\nCluster labels:")
    for cid, label in sorted(cluster_labels.items()):
        print(f"  {cid}: {label}")

    # Build detail for each cluster
    for cluster_id, nodes in enumerate(communities):
        detail = build_cluster_detail(G, cluster_id, nodes, communities, cluster_labels)
        detail_path = os.path.join(OUTPUT_DIR, f"cluster_detail_{cluster_id}.json")
        with open(detail_path, "w") as f:
            json.dump(detail, f, indent=2)
        print(f"Saved: {detail_path}")

    print(f"\nDone. Generated {len(communities)} cluster files.")


if __name__ == "__main__":
    main()
