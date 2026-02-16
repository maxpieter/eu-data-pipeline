#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
Export bipartite graphs to D3.js-friendly JSON with structural filtering.

Modes:
  --mode mep         : MEPs — Organisations
  --mode commission  : Commission employees — Organisations
  --mode full        : (MEPs + Commission employees) — Organisations

Filtering (applies to ALL modes):
  - One-pass degree thresholds:
      * drop orgs with degree < --org-min-degree
      * drop actors with degree < --actor-min-degree
  - Optional iterative bipartite k-core:
      * --bipartite-k-core K   (0 disables; K>=2 prunes both sides until stable)

Keeps:
  - node labels
  - timestamps on edges (aggregated list per (source,target))
  - party + country for MEPs
  - org metadata fields if present (interests_represented, register_id)

Outputs:
  json/bipartite_d3_<mode>.json   (or --out PATH)
"""

import os
import sys
import re
import json
import argparse
from difflib import get_close_matches
from typing import Optional, Dict

from networkx import edges, nodes
import numpy as np
import pandas as pd
from scipy.sparse import coo_matrix
from sklearn.cluster import SpectralCoclustering


# --- Project root handling (script + notebook safe-ish) ---
if "__file__" in globals():
    PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
else:
    PROJECT_ROOT = os.getcwd()

os.chdir(PROJECT_ROOT)
sys.path.append(PROJECT_ROOT)

DATA_DIR = "data"
OUT_DIR = "json"
os.makedirs(OUT_DIR, exist_ok=True)

ORG_PATH_JSON = os.path.join(DATA_DIR, "organizations_preprocessed.json")
ORG_PATH_CSV  = os.path.join(DATA_DIR, "organizations_preprocessed.csv")
MEETINGS_JSON = os.path.join(DATA_DIR, "meetings_data_clean.json")
COMMISSION_CSV = os.path.join(DATA_DIR, "IW EU_datasets_com.csv")
EP_MEPS_CSV = os.path.join(DATA_DIR, "ep_meps_scraped.csv")

NAME_MATCH_CUTOFF = 0.86


def _clean_str(x, default="Unknown"):
    s = "" if x is None else str(x).strip()
    return default if s == "" or s.lower() == "nan" else s


def _norm(s: str) -> str:
    s = re.sub(r"<[^>]+>", "", s or "")
    s = re.sub(r"\s+", " ", s).strip()
    return s.upper()


def load_orgs_table() -> pd.DataFrame:
    if os.path.exists(ORG_PATH_JSON):
        return pd.read_json(ORG_PATH_JSON)
    if os.path.exists(ORG_PATH_CSV):
        return pd.read_csv(ORG_PATH_CSV)
    raise FileNotFoundError("Could not find organizations_preprocessed.json or organizations_preprocessed.csv")


def load_ep_lookup():
    ep = pd.read_csv(EP_MEPS_CSV)

    if "norm_name" not in ep.columns:
        if "name" in ep.columns:
            ep["norm_name"] = ep["name"].map(_norm)
        else:
            raise ValueError("ep_meps_scraped.csv must have either 'norm_name' or 'name'")

    required = {"norm_name", "party", "country"}
    if not required.issubset(ep.columns):
        raise ValueError(f"{EP_MEPS_CSV} must include columns: {sorted(required)}")

    lookup = {str(r["norm_name"]): (r["party"], r["country"]) for _, r in ep.iterrows()}
    keys = list(lookup.keys())
    return lookup, keys


def attach_party_country(mep_nodes: pd.DataFrame) -> pd.DataFrame:
    lookup, keys = load_ep_lookup()
    parties, countries = [], []

    for name in mep_nodes["mep_name"]:
        nn = _norm(name)
        if nn in lookup:
            p, c = lookup[nn]
        else:
            match = get_close_matches(nn, keys, n=1, cutoff=NAME_MATCH_CUTOFF)
            if match:
                p, c = lookup[match[0]]
            else:
                p, c = "Unknown", "Unknown"
        parties.append(p)
        countries.append(c)

    mep_nodes["party"] = parties
    mep_nodes["country"] = countries
    return mep_nodes


def infer_commission_unmatched_org_nodes(commission_df: pd.DataFrame, org_nodes: pd.DataFrame) -> pd.DataFrame:
    org_ids_master = set(org_nodes["id"].astype(str))
    com_org_ids = set(commission_df["OrgId"].astype(str))
    missing_ids = sorted(com_org_ids - org_ids_master)

    if not missing_ids:
        return pd.DataFrame(columns=["id", "type", "name", "label"])

    name_candidates = [
        "Org", "Organisation", "Organization", "Entity", "OrgName",
        "OrganisationName", "OrganizationName", "Name"
    ]
    name_col = next((c for c in name_candidates if c in commission_df.columns), None)

    if name_col is None:
        return pd.DataFrame({"id": missing_ids, "type": "org", "name": missing_ids, "label": missing_ids})

    tmp = commission_df[["OrgId", name_col]].copy()
    tmp["OrgId"] = tmp["OrgId"].astype(str)
    tmp[name_col] = tmp[name_col].astype(str)
    tmp = tmp[tmp["OrgId"].isin(missing_ids)]
    tmp = tmp[tmp[name_col].notna() & (tmp[name_col].str.strip() != "")]
    id_to_name = (tmp.groupby("OrgId")[name_col].first()).to_dict()

    names = [id_to_name.get(oid, oid) for oid in missing_ids]
    return pd.DataFrame({"id": missing_ids, "type": "org", "name": names, "label": names})


def guess_timestamp_column(df: pd.DataFrame) -> Optional[str]:
    for c in [
        "meeting_date", "meeting_datetime",
        "timestamp", "datetime", "date",
        "created_at", "start_date",
        "StartDate", "Start date",
        "MeetingDate", "Date", "DATE", "time"
    ]:
        if c in df.columns:
            return c
    return None


def coerce_timestamp_series(s: pd.Series) -> pd.Series:
    dt = pd.to_datetime(s, errors="coerce", utc=True)
    out = dt.dt.strftime("%Y-%m-%dT%H:%M:%SZ")
    return out.fillna("")


# =========================
# Filtering (ALL modes)
# =========================
def report_bipartite_sizes(edges: pd.DataFrame, actor_label: str = "actor"):
    actors = edges["source"].astype(str)
    orgs = edges["target"].astype(str)
    print(f"  edge rows: {len(edges):,}")
    print(f"  unique pairs: {edges[['source','target']].drop_duplicates().shape[0]:,}")
    print(f"  unique {actor_label}s: {actors.nunique():,}")
    print(f"  unique orgs: {orgs.nunique():,}")


def filter_bipartite_by_degree(
    edges: pd.DataFrame,
    org_min_degree: int = 2,
    actor_min_degree: int = 1,
    verbose: bool = True,
    actor_label: str = "actor",
) -> pd.DataFrame:
    """
    One-pass degree thresholding:
    - org degree = incident edge-row count
    - actor degree = incident edge-row count
    """
    df = edges.copy()
    df["source"] = df["source"].astype(str)
    df["target"] = df["target"].astype(str)

    if verbose:
        print("\n=== Degree filter (one-pass) BEFORE ===")
        report_bipartite_sizes(df, actor_label=actor_label)

    if org_min_degree > 1:
        org_deg = df["target"].value_counts()
        keep_orgs = set(org_deg[org_deg >= org_min_degree].index)
        df = df[df["target"].isin(keep_orgs)]

    if actor_min_degree > 1:
        act_deg = df["source"].value_counts()
        keep_actors = set(act_deg[act_deg >= actor_min_degree].index)
        df = df[df["source"].isin(keep_actors)]

    if verbose:
        print("=== Degree filter (one-pass) AFTER ===")
        report_bipartite_sizes(df, actor_label=actor_label)

    return df


def bipartite_k_core_prune(
    edges: pd.DataFrame,
    k: int,
    verbose: bool = True,
    actor_label: str = "actor",
) -> pd.DataFrame:
    """
    Iterative bipartite k-core on edge rows:
    remove any node (on either side) with degree < k, repeat until stable.
    """
    if k <= 1:
        return edges

    df = edges.copy()
    df["source"] = df["source"].astype(str)
    df["target"] = df["target"].astype(str)

    if verbose:
        print(f"\n=== Bipartite {k}-core BEFORE ===")
        report_bipartite_sizes(df, actor_label=actor_label)

    changed = True
    it = 0
    while changed and len(df):
        it += 1
        changed = False

        act_deg = df["source"].value_counts()
        org_deg = df["target"].value_counts()

        keep_actors = set(act_deg[act_deg >= k].index)
        keep_orgs = set(org_deg[org_deg >= k].index)

        new_df = df[df["source"].isin(keep_actors) & df["target"].isin(keep_orgs)]

        if len(new_df) != len(df):
            changed = True
            df = new_df

        if verbose:
            print(f"  iter {it}: rows={len(df):,}, {actor_label}s={df['source'].nunique():,}, orgs={df['target'].nunique():,}")

    if verbose:
        print(f"=== Bipartite {k}-core AFTER ===")
        report_bipartite_sizes(df, actor_label=actor_label)

    return df

def filter_edges_by_weight(
    edges: pd.DataFrame,
    min_weight: int,
    ts_col: Optional[str],
    verbose: bool = True,
) -> pd.DataFrame:
    """
    Aggregate edges by (source, target) and drop those with weight < min_weight.
    Keeps timestamp lists.
    """

    if min_weight <= 1:
        return edges

    df = edges.copy()
    df["source"] = df["source"].astype(str)
    df["target"] = df["target"].astype(str)

    if ts_col and ts_col in df.columns:
        df["_ts"] = coerce_timestamp_series(df[ts_col])
        agg = (
            df.groupby(["source", "target"], as_index=False)
              .agg(
                  weight=("source", "size"),
                  timestamps=("_ts", lambda x: [t for t in x.tolist() if t]),
              )
        )
    else:
        agg = df.groupby(["source", "target"]).size().reset_index(name="weight")
        agg["timestamps"] = [[] for _ in range(len(agg))]

    before = len(agg)
    agg = agg[agg["weight"] >= min_weight].copy()
    after = len(agg)

    if verbose:
        print(f"\n=== Edge weight filter ===")
        print(f"Min weight: {min_weight}")
        print(f"Edges before: {before:,}")
        print(f"Edges after : {after:,}")

    # Return back to row-style for downstream processing
    # Expand each aggregated row to 1 row (we now treat weight as final)
    result = agg.copy()

    return result

# =========================
# D3 builder
# =========================
def build_d3_bipartite(
    nodes_df: pd.DataFrame,
    edges_df: pd.DataFrame,
    ts_col: Optional[str],
    keep_isolates: bool,
    verbose: bool = True,
) -> Dict:
    """
    Accepts either:
      A) raw edge rows: source, target, (optional ts_col)  -> aggregates to weight + timestamps list
      B) aggregated edges: source, target, weight, timestamps -> used as-is
    """
    ndf = nodes_df.copy()
    ndf["id"] = ndf["id"].astype(str)

    edf = edges_df.copy()
    edf["source"] = edf["source"].astype(str)
    edf["target"] = edf["target"].astype(str)

    # Detect pre-aggregated edges
    already_aggregated = ("weight" in edf.columns) and ("timestamps" in edf.columns)

    # If not aggregated, handle timestamps (if provided) then aggregate
    if not already_aggregated:
        if ts_col and ts_col in edf.columns:
            edf[ts_col] = coerce_timestamp_series(edf[ts_col])
            agg = (
                edf.groupby(["source", "target"], as_index=False)
                   .agg(
                       weight=("source", "size"),
                       timestamps=(ts_col, lambda x: [t for t in x.tolist() if t]),
                   )
            )
        else:
            agg = edf.groupby(["source", "target"]).size().reset_index(name="weight")
            agg["timestamps"] = [[] for _ in range(len(agg))]

        links_df = agg
    else:
        # Use as-is; ensure types are sensible
        links_df = edf.copy()
        links_df["weight"] = pd.to_numeric(links_df["weight"], errors="coerce").fillna(1).astype(int)
        # timestamps should be list-like; if not, coerce
        if not isinstance(links_df["timestamps"].iloc[0], list):
            links_df["timestamps"] = links_df["timestamps"].apply(lambda x: x if isinstance(x, list) else [])

    # Optionally drop isolates by restricting nodes to those used in links
    if not keep_isolates:
        used = set(links_df["source"]).union(set(links_df["target"]))
        ndf = ndf[ndf["id"].isin(used)].copy()

    # Ensure label exists
    if "label" not in ndf.columns:
        def _lbl(r):
            for c in ("label", "name", "mep_name"):
                if c in r and pd.notna(r[c]) and str(r[c]).strip():
                    return str(r[c]).strip()
            return str(r["id"])
        ndf["label"] = ndf.apply(_lbl, axis=1)
    else:
        ndf["label"] = ndf["label"].fillna("").astype(str).str.strip()
        ndf.loc[ndf["label"] == "", "label"] = ndf.loc[ndf["label"] == "", "id"]

    # Build nodes
    nodes = []
    for _, r in ndf.iterrows():
        rec = r.to_dict()
        rec["id"] = str(rec.get("id"))
        rec["type"] = rec.get("type", "unknown")
        rec["label"] = _clean_str(rec.get("label"))
        rec = {k: v for k, v in rec.items() if not (isinstance(v, float) and np.isnan(v))}
        nodes.append(rec)

    # Build links
    links = links_df[["source", "target", "weight", "timestamps"]].to_dict(orient="records")

    if verbose:
        types = pd.Series([n.get("type") for n in nodes]).value_counts().to_dict()
        print("\n=== D3 Graph ===")
        print(f"Nodes: {len(nodes):,} | Links: {len(links):,} | Types: {types}")

    return {"nodes": nodes, "links": links}



def save_json(obj: Dict, path: str):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)

# =========================
# Bipartite community detection (native)
# =========================
def detect_bipartite_communities(
    nodes: list[dict],
    links: list[dict],
    top_k: int = 6,
    max_clusters: int = 12,
    random_state: int = 42,
) -> tuple[dict[str, int], list[dict]]:
    """Assign community ids using spectral co-clustering on the biadjacency matrix.

    - Works directly on the bipartite structure (actors ↔ orgs)
    - Produces co-clusters across both partitions

    Returns:
      node_to_community: node_id -> community_id (0..top_k-1 for top_k largest, -1 otherwise)
      community_stats: list[{id,size,percentage}]
    """
    org_ids = [n["id"] for n in nodes if n.get("type") == "org"]
    actor_ids = [n["id"] for n in nodes if n.get("type") != "org"]

    if len(org_ids) == 0 or len(actor_ids) == 0:
        return ({n["id"]: -1 for n in nodes}, [])

    actor_index = {nid: i for i, nid in enumerate(actor_ids)}
    org_index = {nid: j for j, nid in enumerate(org_ids)}

    rows: list[int] = []
    cols: list[int] = []
    vals: list[float] = []
    for e in links:
        s = str(e.get("source"))
        t = str(e.get("target"))
        w = float(e.get("weight", 1))
        if s in actor_index and t in org_index:
            rows.append(actor_index[s])
            cols.append(org_index[t])
            vals.append(w)
        elif t in actor_index and s in org_index:
            rows.append(actor_index[t])
            cols.append(org_index[s])
            vals.append(w)

    if not vals:
        return ({n["id"]: -1 for n in nodes}, [])

    X = coo_matrix(
        (np.asarray(vals, dtype=float), (np.asarray(rows, dtype=int), np.asarray(cols, dtype=int))),
        shape=(len(actor_ids), len(org_ids)),
    ).tocsr()

    max_possible = max(2, min(X.shape[0], X.shape[1]))
    n_clusters = min(max_clusters, max_possible)
    if n_clusters < 2:
        return ({n["id"]: -1 for n in nodes}, [])

    model = SpectralCoclustering(n_clusters=n_clusters, random_state=random_state)
    model.fit(X)

    actor_labels = model.row_labels_
    org_labels = model.column_labels_

    cluster_sizes: dict[int, int] = {c: 0 for c in range(n_clusters)}
    for c in actor_labels:
        cluster_sizes[int(c)] += 1
    for c in org_labels:
        cluster_sizes[int(c)] += 1

    sorted_clusters = sorted(cluster_sizes.items(), key=lambda kv: kv[1], reverse=True)
    top = [c for c, _sz in sorted_clusters[:top_k]]
    remap = {c: i for i, c in enumerate(top)}

    node_to_comm: dict[str, int] = {}
    for nid, lbl in zip(actor_ids, actor_labels):
        node_to_comm[nid] = remap.get(int(lbl), -1)
    for nid, lbl in zip(org_ids, org_labels):
        node_to_comm[nid] = remap.get(int(lbl), -1)

    total_nodes = len(nodes)
    stats = [
        {
            "id": i,
            "size": int(cluster_sizes[c]),
            "percentage": round(cluster_sizes[c] / total_nodes * 100, 1),
        }
        for i, c in enumerate(top)
    ]

    return node_to_comm, stats



def parse_args():
    p = argparse.ArgumentParser(description="Export bipartite graph to D3 JSON with structural filtering.")
    p.add_argument("--mode", choices=["mep", "commission", "full"], required=True,
                   help="Which bipartite graph to output.")
    p.add_argument("--keep-isolates", action="store_true",
                   help="Include nodes with no edges (usually not needed for D3).")

    # Structural filters (apply to ALL modes)
    p.add_argument("--org-min-degree", type=int, default=2,
                   help="Drop org nodes with degree < this (edge-row degree). Default=2 drops degree-1 orgs.")
    p.add_argument("--actor-min-degree", type=int, default=1,
                   help="Drop actor nodes with degree < this. Default=1 keeps all actors.")
    p.add_argument("--bipartite-k-core", type=int, default=0,
                   help="Iterative pruning on BOTH sides: keep only nodes with degree >= k. 0 disables. Use 2 or 3.")
    p.add_argument("--min-edge-weight", type=int, default=1,
               help="Drop aggregated edges with weight < this (default=1 keeps all). Use 2 to remove one-off ties.")


    # Output
    p.add_argument("--out", default=None, help="Optional output path override.")
    return p.parse_args()


def main():
    args = parse_args()

    # ---- Load data ----
    orgs_df = load_orgs_table()
    meetings_df = pd.read_json(MEETINGS_JSON)
    commission_df = pd.read_csv(COMMISSION_CSV)

    # ---- ORG nodes (master) ----
    org_nodes = orgs_df.copy()
    if "eu_transparency_register_id" in org_nodes.columns:
        org_nodes = org_nodes.rename(columns={"eu_transparency_register_id": "register_id"})
    if "register_id" not in org_nodes.columns:
        org_nodes["register_id"] = None
    if "interests_represented" not in org_nodes.columns:
        org_nodes["interests_represented"] = None

    for col in ("id", "name"):
        if col not in org_nodes.columns:
            raise ValueError(f"orgs table must include column '{col}'")

    org_nodes["type"] = "org"
    org_nodes["id"] = org_nodes["id"].astype(str)
    org_nodes["label"] = org_nodes["name"].astype(str)

    # timestamps
    meetings_ts_col = guess_timestamp_column(meetings_df)
    commission_ts_col = guess_timestamp_column(commission_df)

    print("\n=== Inputs ===")
    print(f"Mode: {args.mode}")
    print(f"Meetings rows: {len(meetings_df):,} | meetings ts col: {meetings_ts_col}")
    print(f"Commission rows: {len(commission_df):,} | commission ts col: {commission_ts_col}")
    print(f"Org master nodes: {org_nodes['id'].nunique():,}")

    # ---- Build nodes/edges per mode ----
    mep_nodes = pd.DataFrame()
    commission_nodes = pd.DataFrame()
    new_org_nodes = pd.DataFrame(columns=["id", "type", "name", "label"])

    if args.mode in {"mep", "full"}:
        # Ensure required meeting cols exist
        if "mep_id" not in meetings_df.columns or "organization_id" not in meetings_df.columns:
            raise ValueError("meetings_data_clean.json must include 'mep_id' and 'organization_id'")

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

    if args.mode in {"commission", "full"}:
        if "Host" not in commission_df.columns or "OrgId" not in commission_df.columns:
            raise ValueError("Commission CSV must include 'Host' and 'OrgId'")

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

    # Build edges dataframe with canonical columns: source, target, (optional) timestamp
    if args.mode == "mep":
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

    elif args.mode == "commission":
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

    # ---- Apply structural filtering (ALL modes) ----
    print("\n=== Build edges (raw) ===")
    print(f"Edge rows (pre-filter): {len(edges):,}")
    print(f"Unique pairs (pre-filter): {edges[['source','target']].drop_duplicates().shape[0]:,}")

    initial_edge_count = len(edges)
    final_edge_count = len(edges)


    # ---- Edge weight filtering (FIRST) ----
    edges_agg = filter_edges_by_weight(
        edges,
        min_weight=args.min_edge_weight,
        ts_col=ts_col,
        verbose=True,
    )

    edges = filter_bipartite_by_degree(
        edges_agg,
        org_min_degree=args.org_min_degree,
        actor_min_degree=args.actor_min_degree,
        verbose=True,
        actor_label=actor_label,
    )
    if args.bipartite_k_core and args.bipartite_k_core > 1:
        edges = bipartite_k_core_prune(edges, k=args.bipartite_k_core, verbose=True, actor_label=actor_label)

    print("\n=== Build edges (post-filter) ===")
    print(f"Edge rows (post-filter): {len(edges):,}")
    print(f"Unique pairs (post-filter): {edges[['source','target']].drop_duplicates().shape[0]:,}")

    # ---- Build D3 JSON ----
    graph = build_d3_bipartite(
        nodes_df=nodes,
        edges_df=edges,
        ts_col=None,  # already aggregated
        keep_isolates=args.keep_isolates,
        verbose=True,
    )
    
    # ---- Bipartite community detection (native) ----
    print(f"\nRunning bipartite community detection on {len(graph['nodes']):,} nodes...")
    node_to_comm, comm_stats = detect_bipartite_communities(graph["nodes"], graph["links"], top_k=6, max_clusters=12)
    for n in graph["nodes"]:
        n["community"] = node_to_comm.get(n["id"], -1)

    # Add metadata (enables legend + keeps client consistent)
    graph["metadata"] = {
        "initial_edge_count": int(initial_edge_count),
        "final_edge_count": int(len(graph["links"])),
        "final_node_count": int(len(graph["nodes"])),
        "org_min_degree_used": int(args.org_min_degree),
        "actor_min_degree_used": int(args.actor_min_degree),
        "k_core_used": int(args.bipartite_k_core),
        "min_edge_weight_used": int(args.min_edge_weight),
        "communities": comm_stats,
        "community_method": "spectral_coclustering",
    }


    out_path = args.out or os.path.join(OUT_DIR, f"bipartite_d3_{args.mode}.json")
    save_json(graph, out_path)
    print(f"\nSaved: {out_path}")


if __name__ == "__main__":
    main()
