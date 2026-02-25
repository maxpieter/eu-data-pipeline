"""
02_build_membership_network.py

Build an organisation–organisation membership network from Transparency Register
"organisationMembers" disclosures.

Input:
  data/organizations_preprocessed.csv
    Required columns:
      - id
      - name
      - organisationMembers   (either a Python list, or a stringified list "['A','B']", or empty)
    Optional columns used for matching:
      - normalized_name
      - official_name
      - acronym

Output:
  pickles/membership_only_graph.gpickle

Edge semantics:
  - Each edge indicates that org_i reported org_j (or matched org_j) as a membership/umbrella.
  - Edge attributes:
      relation      = "membership"
      n_membership  = number of membership entries that mapped to this target
      weight        = edge_weight * n_membership
"""

import ast
import os
import pickle
import re
import sys
from collections import Counter

import networkx as nx
import pandas as pd

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
os.chdir(PROJECT_ROOT)
sys.path.append(PROJECT_ROOT)


# -----------------------
# Config
# -----------------------

ORG_META_CSV = "data/organizations_preprocessed.json"
OUT_PICKLE = "pickles/membership_only_graph.gpickle"

EDGE_WEIGHT = 1.0
UNDIRECTED = True
COLLECT_UNMATCHED = True

# Minimal manual aliasing for known umbrellas / frequent acronyms.
# Keys must be normalized using _norm_base().
ALIAS_OVERRIDES = {
    # _norm_base("DIGITALEUROPE"): ["64270747023-20"],
    # _norm_base("BUSINESSEUROPE"): ["3978240953-79"],
}


# -----------------------
# Normalization utilities
# -----------------------

LEGAL_FORMS = [
    "aisbl",
    "asbl",
    "ais",
    "gmbh",
    "srl",
    "sarl",
    "sa",
    "s.a.",
    "ag",
    "ltd",
    "limited",
    "inc",
    "inc.",
    "foundation",
    "association",
    "federation",
    "union",
    "company",
    "co.",
    "e.v.",
    "e v",
    "univerzita",
    "university",
    "none",
]

ACRONYM_STOP = {"EU", "UK", "US", "UN", "UAE", "EEA", "EFTA", "NATO", "G7", "G20"}


def _norm_base(s: str) -> str:
    if not isinstance(s, str):
        return ""
    s = s.strip().lower()
    s = s.replace("–", "-").replace("—", "-").replace("−", "-")
    s = re.sub(r"[^a-z0-9]+", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def _strip_legal_forms(s: str) -> str:
    if not s:
        return ""
    pattern = r"\b(" + "|".join(LEGAL_FORMS) + r")\b"
    s = re.sub(pattern, " ", s, flags=re.I)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def parse_members_list(val):
    """
    Ensure organisationMembers becomes a Python list[str].
    Accepts:
      - list
      - stringified list "['A','B']"
      - empty/NaN
    """
    if isinstance(val, list):
        return [str(x) for x in val if str(x).strip()]
    if not isinstance(val, str) or not val.strip():
        return []
    try:
        parsed = ast.literal_eval(val)
        if isinstance(parsed, list):
            return [str(x) for x in parsed if str(x).strip()]
        return []
    except Exception:
        return [val.strip()]


def extract_org_aliases(row) -> set[str]:
    """
    Build name-based aliases for an organisation row.
    Acronyms are handled separately (only from the acronym column).
    """
    aliases = set()
    for field in ("name", "normalized_name", "official_name"):
        nm = row.get(field)
        if not isinstance(nm, str) or not nm.strip():
            continue
        base = _norm_base(nm)
        if base:
            aliases.add(base)
            no_legal = _strip_legal_forms(base)
            if no_legal and no_legal != base:
                aliases.add(no_legal)
    return aliases


def build_org_indices(orgs_df: pd.DataFrame):
    """
    name_index: normalized name variants -> set(org_ids)
    acronym_index: normalized acronym -> set(org_ids)
    """
    name_index = {}
    acronym_index = {}

    for _, row in orgs_df.iterrows():
        org_id = row["id"]

        for key in extract_org_aliases(row):
            name_index.setdefault(key, set()).add(org_id)

        ac = row.get("acronym")
        if isinstance(ac, str) and ac.strip():
            k = _norm_base(ac)
            if k and len(k) >= 3:
                acronym_index.setdefault(k, set()).add(org_id)

    return name_index, acronym_index


def name_keys(raw: str) -> list[str]:
    """
    Generate a small set of name keys for matching membership strings.
    """
    if not isinstance(raw, str) or not raw.strip():
        return []

    keys = set()

    base = _norm_base(raw)
    if base:
        keys.add(base)
        keys.add(_strip_legal_forms(base))

    main = _norm_base(raw.split(",")[0])
    if main:
        keys.add(main)
        keys.add(_strip_legal_forms(main))

    keys = {k for k in keys if k}
    return list(keys)


def extract_strict_acronyms(raw: str, acronym_index: dict | None = None) -> list[str]:
    """
    STRICT acronym extraction:
      A) raw is entirely an acronym token (e.g. "OECD")
      B) parenthetical acronym at end: "... (OECD)"
    """
    if not isinstance(raw, str) or not raw.strip():
        return []

    raw = raw.strip()
    cands = set()

    tok = re.sub(r"[^A-Za-z0-9]+", "", raw)
    if tok.isupper() and len(tok) >= 3 and tok.upper() not in ACRONYM_STOP:
        cands.add(tok)

    m = re.search(r"\(([A-Za-z0-9]{3,})\)\s*$", raw)
    if m:
        p = m.group(1)
        if p.isupper() and p.upper() not in ACRONYM_STOP:
            cands.add(p)

    normed = [_norm_base(x) for x in cands if _norm_base(x)]
    if acronym_index is not None:
        normed = [k for k in normed if k in acronym_index]
    return normed


# -----------------------
# Graph construction
# -----------------------


def build_membership_graph(
    orgs_df: pd.DataFrame,
    alias_overrides: dict[str, list[str]] | None = None,
    undirected: bool = True,
    edge_weight: float = 1.0,
    collect_unmatched: bool = True,
):
    """
    Build an org–org membership network where edges are created when org_i lists
    org_j in its organisationMembers field (after matching).

    Returns:
      G_mem, unmatched_counter (if collect_unmatched else None)
    """
    alias_overrides = alias_overrides or {}
    name_index, acronym_index = build_org_indices(orgs_df)

    G = nx.Graph() if undirected else nx.DiGraph()
    unmatched = Counter() if collect_unmatched else None

    added_edges = 0
    unmatched_entries = 0

    for _, row in orgs_df.iterrows():
        src_id = row["id"]
        members = parse_members_list(row.get("organisationMembers"))

        src_had_edge = False

        for raw in members:
            if not isinstance(raw, str) or not raw.strip():
                continue

            raw_norm = _norm_base(raw)
            matched_ids = set()

            # 0) Manual override
            if raw_norm in alias_overrides:
                matched_ids.update(alias_overrides[raw_norm])
            else:
                # 1) Name-based matching
                for k in name_keys(raw):
                    matched_ids.update(name_index.get(k, set()))

                # 2) Strict acronym fallback
                if not matched_ids:
                    for k in extract_strict_acronyms(raw, acronym_index=acronym_index):
                        matched_ids.update(acronym_index.get(k, set()))

            if not matched_ids:
                unmatched_entries += 1
                if collect_unmatched:
                    unmatched[raw.strip()] += 1
                continue

            if not src_had_edge:
                G.add_node(src_id)
                src_had_edge = True

            for tgt_id in matched_ids:
                if tgt_id == src_id:
                    continue
                G.add_node(tgt_id)

                if G.has_edge(src_id, tgt_id):
                    G[src_id][tgt_id]["n_membership"] = (
                        G[src_id][tgt_id].get("n_membership", 0) + 1
                    )
                    G[src_id][tgt_id]["weight"] = (
                        G[src_id][tgt_id].get("weight", 0.0) + edge_weight
                    )
                else:
                    G.add_edge(
                        src_id,
                        tgt_id,
                        relation="membership",
                        n_membership=1,
                        weight=edge_weight,
                    )
                    added_edges += 1

    print("\n=== Membership-only graph ===")
    print(f"Nodes: {G.number_of_nodes()} | Edges: {G.number_of_edges()}")
    print(f"New edges added: {added_edges}")
    print(f"Unmatched membership entries: {unmatched_entries}")

    return (G, unmatched) if collect_unmatched else (G, None)


def attach_labels(G: nx.Graph, orgs_df: pd.DataFrame, label_col: str = "name"):
    """
    Attach node attribute 'label' from orgs_df (fallback: node id).
    """
    id_to_label = dict(zip(orgs_df["id"].astype(str), orgs_df[label_col].astype(str)))
    nx.set_node_attributes(
        G, {n: id_to_label.get(str(n), str(n)) for n in G.nodes()}, "label"
    )


# -----------------------
# Main
# -----------------------


def main():
    if not os.path.exists(ORG_META_CSV):
        raise FileNotFoundError(f"Missing: {ORG_META_CSV}")

    os.makedirs(os.path.dirname(OUT_PICKLE), exist_ok=True)

    orgs = pd.read_json(ORG_META_CSV)
    if "id" not in orgs.columns or "organisationMembers" not in orgs.columns:
        raise ValueError(
            "organizations_preprocessed.csv must contain columns: 'id', 'organisationMembers'"
        )

    orgs["id"] = orgs["id"].astype(str)

    G_mem, unmatched = build_membership_graph(
        orgs_df=orgs,
        alias_overrides=ALIAS_OVERRIDES,
        undirected=UNDIRECTED,
        edge_weight=EDGE_WEIGHT,
        collect_unmatched=COLLECT_UNMATCHED,
    )

    attach_labels(G_mem, orgs, label_col="name")

    with open(OUT_PICKLE, "wb") as f:
        pickle.dump(G_mem, f, protocol=pickle.HIGHEST_PROTOCOL)
    print(f"Saved: {OUT_PICKLE}")


if __name__ == "__main__":
    main()
