#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
- MEP-only bipartite graph (MEPs — Organisations)
- Full bipartite graph (MEPs + Commission employees — Organisations)

Then build weighted projections for each layer:
- actor projection: actors connected if they met the same org(s)
- org projection  : orgs connected if they met the same actor(s)

Uses pre-scraped EP MEP metadata in data/ep_meps_scraped.csv.

Inputs:
  data/organizations_preprocessed.(json|csv)
  data/meetings_data_clean.json
  data/IW EU_datasets_com.csv
  data/ep_meps_scraped.csv

Outputs (pickles):

MEP-only:
  pickles/bipartite_graph.gpickle
  pickles/mep_actor_projection.gpickle
  pickles/mep_org_projection.gpickle

FULL:
  pickles/comms_bipartite_graph.gpickle
  pickles/full_actor_projection.gpickle
  pickles/full_org_projection.gpickle
"""

import os
import pickle
import re
import sys
from difflib import get_close_matches

import networkx as nx
import pandas as pd
from networkx.algorithms import bipartite

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
os.chdir(PROJECT_ROOT)
sys.path.append(PROJECT_ROOT)

DATA_DIR = "data"
PICKLE_DIR = "pickles"
os.makedirs(PICKLE_DIR, exist_ok=True)

# ---- Inputs ----
ORG_PATH_JSON = os.path.join(DATA_DIR, "organizations_preprocessed.json")
ORG_PATH_CSV = os.path.join(DATA_DIR, "organizations_preprocessed.csv")
MEETINGS_JSON = os.path.join(DATA_DIR, "meetings_data_clean.json")
COMMISSION_CSV = os.path.join(DATA_DIR, "IW EU_datasets_com.csv")
EP_MEPS_CSV = os.path.join(DATA_DIR, "ep_meps_scraped.csv")

# ---- Outputs (MEP-only) ----
OUT_BIP_MEP = os.path.join(PICKLE_DIR, "bipartite_graph.gpickle")
OUT_ACTOR_PROJ_MEP = os.path.join(PICKLE_DIR, "mep_actor_projection.gpickle")
OUT_ORG_PROJ_MEP = os.path.join(PICKLE_DIR, "mep_org_projection.gpickle")

# ---- Outputs (FULL) ----
OUT_BIP_FULL = os.path.join(PICKLE_DIR, "comms_bipartite_graph.gpickle")
OUT_ACTOR_PROJ_FULL = os.path.join(PICKLE_DIR, "full_actor_projection.gpickle")
OUT_ORG_PROJ_FULL = os.path.join(PICKLE_DIR, "full_org_projection.gpickle")

NAME_MATCH_CUTOFF = 0.86


def _clean_str(x, default="Unknown"):
    s = "" if x is None else str(x).strip()
    return default if s == "" or s.lower() == "nan" else s


def _norm(s: str) -> str:
    s = re.sub(r"<[^>]+>", "", s or "")
    s = re.sub(r"\s+", " ", s).strip()
    return s.upper()


def load_orgs_table() -> pd.DataFrame:
    """Prefer JSON (old behavior), else CSV."""
    if os.path.exists(ORG_PATH_JSON):
        return pd.read_json(ORG_PATH_JSON)
    if os.path.exists(ORG_PATH_CSV):
        return pd.read_csv(ORG_PATH_CSV)
    raise FileNotFoundError(
        "Could not find organizations_preprocessed.json or organizations_preprocessed.csv"
    )


def load_ep_lookup():
    ep = pd.read_csv(EP_MEPS_CSV)

    # tolerate either (norm_name already present) OR (name present)
    if "norm_name" not in ep.columns:
        if "name" in ep.columns:
            ep["norm_name"] = ep["name"].map(_norm)
        else:
            raise ValueError(
                "ep_meps_scraped.csv must have either 'norm_name' or 'name'"
            )

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


def build_graph_from_tables(nodes_df: pd.DataFrame, edges_df: pd.DataFrame) -> nx.Graph:
    """Old behavior: add ALL nodes, then add edges."""
    G = nx.Graph()

    for _, row in nodes_df.iterrows():
        nid = str(row["id"])

        label = row.get("name", None)
        if pd.isna(label) or str(label).strip() == "":
            label = row.get("mep_name", nid)

        interests = str(row.get("interests_represented", "") or "").strip()

        attrs = {
            "label": _clean_str(label),
            "type": row.get("type", "unknown"),
            "interests": interests,
            "register_id": row.get("register_id", None),
            "party": row.get("party", None),
            "country": row.get("country", None),
        }
        attrs = {
            k: v for k, v in attrs.items() if v is not None and str(v).lower() != "nan"
        }
        attrs["title"] = (
            f"{attrs['label']}<br>{attrs.get('country', '')}<br>{attrs.get('register_id', '')}<br>{interests}"
        )

        G.add_node(nid, **attrs)

    for _, row in edges_df.iterrows():
        G.add_edge(
            str(row["source"]),
            str(row["target"]),
            weight=float(row.get("weight", 1.0)),
        )

    return G


def create_projection(G: nx.Graph, nodes: list[str]) -> nx.Graph:
    """
    Weighted one-mode projection of a bipartite graph onto `nodes`.
    Copies original node attributes into the projected graph.
    """
    P = bipartite.weighted_projected_graph(G, nodes)
    for n in P.nodes():
        if n in G:
            P.nodes[n].update(G.nodes[n])
    return P


def infer_commission_unmatched_org_nodes(
    commission_df: pd.DataFrame, org_nodes: pd.DataFrame
) -> pd.DataFrame:
    """
    Create synthetic org nodes for Commission OrgIds not present in the master org table.

    - Requires Commission columns: Host, OrgId
    - Optionally uses an org-name column if available; otherwise uses OrgId as name/label.
    """
    if "OrgId" not in commission_df.columns:
        raise ValueError("Commission CSV must include column 'OrgId'")
    if "Host" not in commission_df.columns:
        raise ValueError("Commission CSV must include column 'Host'")

    org_ids_master = set(org_nodes["id"].astype(str))
    com_org_ids = set(commission_df["OrgId"].astype(str))
    missing_ids = sorted(com_org_ids - org_ids_master)

    if not missing_ids:
        return pd.DataFrame(columns=["id", "type", "name"])

    # Try to find a plausible org-name column in commission_df (best-effort, non-interactive)
    name_candidates = [
        "Org",
        "Organisation",
        "Organization",
        "Entity",
        "OrgName",
        "OrganisationName",
        "OrganizationName",
        "Name",
    ]
    name_col = next((c for c in name_candidates if c in commission_df.columns), None)

    if name_col is None:
        # No name column available; fall back to using the ID as the label
        return pd.DataFrame(
            {
                "id": missing_ids,
                "type": "org",
                "name": missing_ids,
            }
        )

    # Map each missing OrgId to the first non-null observed name in the Commission table
    tmp = commission_df[["OrgId", name_col]].copy()
    tmp["OrgId"] = tmp["OrgId"].astype(str)
    tmp[name_col] = tmp[name_col].astype(str)
    tmp = tmp[tmp["OrgId"].isin(missing_ids)]
    tmp = tmp[tmp[name_col].notna() & (tmp[name_col].str.strip() != "")]
    id_to_name = (tmp.groupby("OrgId")[name_col].first()).to_dict()

    return pd.DataFrame(
        {
            "id": missing_ids,
            "type": "org",
            "name": [id_to_name.get(oid, oid) for oid in missing_ids],
        }
    )


def main():
    # ---- Load data ----
    orgs_df = load_orgs_table()
    meetings_df = pd.read_json(MEETINGS_JSON)
    commission_df = pd.read_csv(COMMISSION_CSV)

    # Extract MEP name from nested dict (old behavior)
    meetings_df["mep_name"] = meetings_df["source_data"].apply(
        lambda x: x.get("mep_name") if isinstance(x, dict) else None
    )

    # ---- ORG nodes (entire universe; includes isolates) ----
    org_nodes = orgs_df.copy()
    if "eu_transparency_register_id" in org_nodes.columns:
        org_nodes = org_nodes.rename(
            columns={"eu_transparency_register_id": "register_id"}
        )
    if "register_id" not in org_nodes.columns:
        org_nodes["register_id"] = None
    if "interests_represented" not in org_nodes.columns:
        org_nodes["interests_represented"] = None

    org_nodes["type"] = "org"
    for col in ["id", "name"]:
        if col not in org_nodes.columns:
            raise ValueError(f"orgs table must include column '{col}'")

    # ---- MEP nodes from meetings ----
    mep_nodes = (
        meetings_df[["mep_id", "mep_name"]]
        .drop_duplicates()
        .rename(columns={"mep_id": "id"})
    )
    mep_nodes["type"] = "mep"
    mep_nodes = attach_party_country(mep_nodes)

    # ---- Commission employee nodes ----
    commission_employees = commission_df[["Host"]].drop_duplicates()
    commission_nodes = pd.DataFrame(
        {
            "id": commission_employees["Host"].astype(str).values,
            "type": "commission_employee",
            "name": commission_employees["Host"].astype(str).values,
        }
    )

    # ---- Unmatched Commission org nodes (derived inside script) ----
    org_nodes["id"] = org_nodes["id"].astype(str)
    commission_df["OrgId"] = commission_df["OrgId"].astype(str)
    new_org_nodes = infer_commission_unmatched_org_nodes(commission_df, org_nodes)
    new_org_nodes["id"] = new_org_nodes["id"].astype(str)

    # =========================
    # MEP-only: nodes + edges
    # =========================
    nodes_mep = pd.concat(
        [
            org_nodes[["id", "type", "name", "interests_represented", "register_id"]],
            mep_nodes[["id", "type", "mep_name", "party", "country"]],
        ],
        ignore_index=True,
    )
    nodes_mep["id"] = nodes_mep["id"].astype(str)

    edges_mep = meetings_df[["mep_id", "organization_id"]].rename(
        columns={"mep_id": "source", "organization_id": "target"}
    )
    edges_mep["source"] = edges_mep["source"].astype(str)
    edges_mep["target"] = edges_mep["target"].astype(str)
    edges_mep = (
        edges_mep.groupby(["source", "target"]).size().reset_index(name="weight")
    )

    G_mep = build_graph_from_tables(nodes_mep, edges_mep)

    actor_nodes_mep = [n for n, d in G_mep.nodes(data=True) if d.get("type") == "mep"]
    org_nodes_mep = [n for n, d in G_mep.nodes(data=True) if d.get("type") == "org"]

    P_actor_mep = create_projection(G_mep, actor_nodes_mep)
    P_org_mep = create_projection(G_mep, org_nodes_mep)

    # =========================
    # FULL: nodes + edges
    # =========================
    nodes_full = pd.concat(
        [
            org_nodes[["id", "type", "name", "interests_represented", "register_id"]],
            new_org_nodes[["id", "type", "name"]],
            mep_nodes[["id", "type", "mep_name", "party", "country"]],
            commission_nodes[["id", "type", "name"]],
        ],
        ignore_index=True,
    )
    nodes_full["id"] = nodes_full["id"].astype(str)

    edges_com = commission_df[["Host", "OrgId"]].rename(
        columns={"Host": "source", "OrgId": "target"}
    )
    edges_com["source"] = edges_com["source"].astype(str)
    edges_com["target"] = edges_com["target"].astype(str)

    edges_full = pd.concat([edges_mep, edges_com], ignore_index=True)
    edges_full = (
        edges_full.groupby(["source", "target"]).size().reset_index(name="weight")
    )

    G_full = build_graph_from_tables(nodes_full, edges_full)

    actor_nodes_full = [
        n
        for n, d in G_full.nodes(data=True)
        if d.get("type") in {"mep", "commission_employee"}
    ]
    org_nodes_full = [n for n, d in G_full.nodes(data=True) if d.get("type") == "org"]

    P_actor_full = create_projection(G_full, actor_nodes_full)
    P_org_full = create_projection(G_full, org_nodes_full)

    # ---- Report ----
    n_orgs_total = int((org_nodes["id"].astype(str)).nunique())
    n_unmatched = int(new_org_nodes["id"].nunique()) if len(new_org_nodes) else 0
    n_org_nodes_mep = sum(
        1 for _, d in G_mep.nodes(data=True) if d.get("type") == "org"
    )
    n_org_nodes_full = sum(
        1 for _, d in G_full.nodes(data=True) if d.get("type") == "org"
    )

    print("\n=== Summary ===")
    print(f"Org table unique org IDs: {n_orgs_total}")
    print(f"Derived unmatched Commission org IDs: {n_unmatched}")
    print(
        f"MEP-only bipartite: {G_mep.number_of_nodes()} nodes | {G_mep.number_of_edges()} edges | org nodes={n_org_nodes_mep}"
    )
    print(
        f"MEP actor proj    : {P_actor_mep.number_of_nodes()} nodes | {P_actor_mep.number_of_edges()} edges"
    )
    print(
        f"MEP org proj      : {P_org_mep.number_of_nodes()} nodes | {P_org_mep.number_of_edges()} edges"
    )
    print(
        f"FULL bipartite    : {G_full.number_of_nodes()} nodes | {G_full.number_of_edges()} edges | org nodes={n_org_nodes_full}"
    )
    print(
        f"FULL actor proj   : {P_actor_full.number_of_nodes()} nodes | {P_actor_full.number_of_edges()} edges"
    )
    print(
        f"FULL org proj     : {P_org_full.number_of_nodes()} nodes | {P_org_full.number_of_edges()} edges"
    )

    # ---- Save pickles ----
    with open(OUT_BIP_MEP, "wb") as f:
        pickle.dump(G_mep, f, protocol=pickle.HIGHEST_PROTOCOL)
    with open(OUT_ACTOR_PROJ_MEP, "wb") as f:
        pickle.dump(P_actor_mep, f, protocol=pickle.HIGHEST_PROTOCOL)
    with open(OUT_ORG_PROJ_MEP, "wb") as f:
        pickle.dump(P_org_mep, f, protocol=pickle.HIGHEST_PROTOCOL)

    with open(OUT_BIP_FULL, "wb") as f:
        pickle.dump(G_full, f, protocol=pickle.HIGHEST_PROTOCOL)
    with open(OUT_ACTOR_PROJ_FULL, "wb") as f:
        pickle.dump(P_actor_full, f, protocol=pickle.HIGHEST_PROTOCOL)
    with open(OUT_ORG_PROJ_FULL, "wb") as f:
        pickle.dump(P_org_full, f, protocol=pickle.HIGHEST_PROTOCOL)

    print("\nSaved:")
    print(f"  {OUT_BIP_MEP}")
    print(f"  {OUT_ACTOR_PROJ_MEP}")
    print(f"  {OUT_ORG_PROJ_MEP}")
    print(f"  {OUT_BIP_FULL}")
    print(f"  {OUT_ACTOR_PROJ_FULL}")
    print(f"  {OUT_ORG_PROJ_FULL}")


if __name__ == "__main__":
    main()
