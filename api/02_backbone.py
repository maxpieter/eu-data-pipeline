#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
02_run_full_backbones.py

Run backbone extraction.

Inputs:
  pickles/bipartite_graph.gpickle
  pickles/actor_projection.gpickle
  pickles/org_projection.gpickle

Outputs:
  pickles/full_actor_backbone_nc_fdr.gpickle
  pickles/full_org_backbone_idf_hybrid_hg_fdr.gpickle
"""

import itertools
import math
import os
import pickle
import sys
from collections import defaultdict

import networkx as nx
import numpy as np
import pandas as pd
from networkx.algorithms import community
from networkx.algorithms.community.quality import modularity
from scipy.stats import hypergeom
from statsmodels.stats.multitest import multipletests

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
os.chdir(PROJECT_ROOT)
sys.path.append(PROJECT_ROOT)


PICKLE_DIR = "pickles"

IN_BIP = os.path.join(PICKLE_DIR, "bipartite_graph.gpickle")
IN_ACTOR_PROJ = os.path.join(PICKLE_DIR, "mep_actor_projection.gpickle")
IN_ORG_PROJ = os.path.join(PICKLE_DIR, "mep_org_projection.gpickle")

OUT_ACTOR_BB = os.path.join(PICKLE_DIR, "actor_backbone_nc_fdr.gpickle")
OUT_ORG_BB = os.path.join(PICKLE_DIR, "mep_org_backbone_idf_hybrid_hg_fdr.gpickle")

ACTOR_FDR_ALPHA = 0.05
ORG_FDR_ALPHA = 0.01
IDF_SINGLE_PERCENTILE = 99.9


def describe_graph(G, label):
    n, m = G.number_of_nodes(), G.number_of_edges()
    print(f"\n=== {label} ===")
    print(f"Nodes: {n} | Edges: {m}")
    if n:
        comps = list(nx.connected_components(G))
        lcc = max((len(c) for c in comps), default=0)
        print(
            f"Components: {len(comps)} | LCC: {lcc} ({lcc / max(1, n) * 100:.1f}% nodes)"
        )
    print("=======================")


def louvain_and_modularity(G, weight="weight", seed=42, label=None):
    comms = community.louvain_communities(G, weight=weight, seed=seed, resolution=1)
    Q = modularity(G, comms, weight=weight)
    print(f"Louvain: {len(comms)} communities" + (f" in {label}" if label else ""))
    print(f"Modularity: {Q:.3f}" + (f" for {label}" if label else ""))
    return comms, Q


# -------------------------
# Org backbone: IDF + hybrid + HG+FDR
# -------------------------


def org_org_idf_projection(G_bip, org_nodes, actor_nodes):
    """
    IDF-weighted org-org projection:
      shared = number of shared actors
      weight = sum_{a in shared actors} log(|O| / deg(a))
    """
    O = len(org_nodes)
    deg_actor = {a: G_bip.degree(a) for a in actor_nodes}
    idf = {a: math.log(O / max(1, deg_actor[a])) for a in actor_nodes}

    actor_to_orgs = {a: list(G_bip.neighbors(a)) for a in actor_nodes}

    shared = defaultdict(int)
    w_idf = defaultdict(float)

    for a, orgs in actor_to_orgs.items():
        if len(orgs) < 2:
            continue
        w = idf[a]
        for u, v in itertools.combinations(sorted(orgs), 2):
            key = (u, v)
            shared[key] += 1
            w_idf[key] += w

    Gp = nx.Graph()
    Gp.add_nodes_from((o, G_bip.nodes[o]) for o in org_nodes)
    for (u, v), c in shared.items():
        Gp.add_edge(u, v, shared=int(c), weight=float(w_idf[(u, v)]))
    return Gp


def suggest_tau_for_singles(Gp, percentile=99):
    singles = [
        d.get("weight", 0.0)
        for _, _, d in Gp.edges(data=True)
        if int(d.get("shared", 0)) == 1
    ]
    if not singles:
        return 0.0
    return float(np.percentile(singles, percentile))


def filter_org_edges_hybrid(Gp, tau_idf):
    """
    Correct hybrid rule:
      keep if shared >= 2 OR (shared == 1 AND idf_weight >= tau_idf)
    """
    H = nx.Graph()
    H.add_nodes_from(Gp.nodes(data=True))

    kept = 0

    for u, v, d in Gp.edges(data=True):
        c = int(d.get("shared", 0))
        w = float(d.get("weight", 0.0))
        if c >= 2 and w >= tau_idf:
            H.add_edge(u, v, **d)
            kept += 1

    return H


def org_hg_fdr_backbone(G_bip, org_nodes, actor_nodes, G_like, alpha=0.01):
    """
    Hypergeom test on 'shared' counts:
      N = |actors|
      K = deg(org_i) in bipartite (number of actors met)
      n = deg(org_j)
      p = P[X >= shared]
    BH-FDR applied across tested edges.
    """
    k_org = {o: G_bip.degree(o) for o in org_nodes}
    N = len(actor_nodes)

    rows = []
    for u, v, d in G_like.edges(data=True):
        x = int(d.get("shared", 1))
        ki, kj = k_org.get(u, 0), k_org.get(v, 0)
        p = float(hypergeom.sf(x - 1, N, ki, kj))
        rows.append(
            {
                "src": u,
                "trg": v,
                "shared": x,
                "p": p,
                "idf_weight": float(d.get("weight", 0.0)),
            }
        )

    df = pd.DataFrame(rows)
    reject, q, _, _ = multipletests(df["p"].values, method="fdr_bh", alpha=alpha)
    df["q"] = q
    df_keep = df[reject].copy()

    G_bb = nx.Graph()
    G_bb.add_nodes_from((n, G_like.nodes[n]) for n in G_like.nodes())
    for _, r in df_keep.iterrows():
        G_bb.add_edge(
            r["src"],
            r["trg"],
            shared=int(r["shared"]),
            weight=float(r["idf_weight"]),  # keep IDF weight for interpretation
            p=float(r["p"]),
            q=float(r["q"]),
        )
    G_bb.remove_nodes_from(list(nx.isolates(G_bb)))

    print(
        f"[ORG HG+FDR] alpha={alpha} | tested={len(df)} | kept={len(df_keep)} ({len(df_keep) / max(1, len(df)) * 100:.1f}%)"
    )
    return G_bb, df, df_keep


def main():
    if not (
        os.path.exists(IN_BIP)
        and os.path.exists(IN_ACTOR_PROJ)
        and os.path.exists(IN_ORG_PROJ)
    ):
        raise FileNotFoundError(
            "Missing required pickles. Run scripts/01_build_full_graphs.py first."
        )

    with open(IN_BIP, "rb") as f:
        G_bip = pickle.load(f)
    with open(IN_ACTOR_PROJ, "rb") as f:
        G_actor_proj = pickle.load(f)
    with open(IN_ORG_PROJ, "rb") as f:
        G_org_proj = pickle.load(f)

    describe_graph(G_bip, "Bipartite (Actors–Orgs)")
    describe_graph(G_actor_proj, "Actor projection (Actors–Actors)")
    describe_graph(G_org_proj, "Org projection (Orgs–Orgs, raw overlap weights)")

    actor_nodes = [
        n
        for n, d in G_bip.nodes(data=True)
        if d.get("type") in {"mep", "commission_employee"}
    ]
    org_nodes = [n for n, d in G_bip.nodes(data=True) if d.get("type") == "org"]
    print(f"\nActor nodes: {len(actor_nodes)} | Org nodes: {len(org_nodes)}")

    # Org backbone (IDF projection computed from bipartite)
    G_org_idf = org_org_idf_projection(G_bip, org_nodes, actor_nodes)
    describe_graph(G_org_idf, "ORG–ORG IDF projection")

    tau = suggest_tau_for_singles(G_org_idf, percentile=IDF_SINGLE_PERCENTILE)
    print(f"tau_idf (singles p{IDF_SINGLE_PERCENTILE}) = {tau:.4f}")

    G_org_hybrid = filter_org_edges_hybrid(G_org_idf, tau_idf=tau)
    describe_graph(G_org_hybrid, "ORG hybrid-filtered")

    G_org_bb, _, _ = org_hg_fdr_backbone(
        G_bip, org_nodes, actor_nodes, G_org_hybrid, alpha=ORG_FDR_ALPHA
    )
    describe_graph(G_org_bb, "ORG backbone (IDF+hybrid+HG+FDR)")
    if G_org_bb.number_of_edges() > 0:
        louvain_and_modularity(G_org_bb, label=f"ORG pipeline alpha={ORG_FDR_ALPHA}")

    with open(OUT_ORG_BB, "wb") as f:
        pickle.dump(G_org_bb, f, protocol=pickle.HIGHEST_PROTOCOL)

    print(f"Saved: {OUT_ORG_BB}")
    print("\nDone.")


if __name__ == "__main__":
    main()
