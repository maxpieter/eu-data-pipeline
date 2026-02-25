#!/usr/bin/env python3
"""Test org projection with specific date range."""

import sys
import os

# Add project root to path
sys.path.insert(0, '/Users/inge/Desktop/ITU/Thesis/Network/eu-network-graph')

from server import build_graph

print("Testing org projection: Jan 1 2025 - Sep 1 2025\n")

try:
    graph = build_graph(
        mode='full',
        keep_isolates=False,
        start='2025-01-01',
        end='2025-09-01',
        procedure='all',
        graph_type='organizations'
    )
    
    print("\n" + "="*60)
    print("FINAL GRAPH RESULT")
    print("="*60)
    print(f"Nodes: {len(graph['nodes'])}")
    print(f"Edges: {len(graph['links'])}")
    print(f"Communities found: {len(graph['metadata'].get('communities', []))}")
    
    if graph['nodes']:
        print(f"\nNode types present:")
        types = {}
        for node in graph['nodes']:
            t = node.get('type', 'unknown')
            types[t] = types.get(t, 0) + 1
        for t, count in types.items():
            print(f"  {t}: {count}")
    
    if graph['metadata'].get('communities'):
        print(f"\nTop communities:")
        for stat in graph['metadata']['communities'][:6]:
            print(f"  Community {stat['id']}: {stat['size']} nodes ({stat['percentage']})")
    
    print(f"\nCommunity method: {graph['metadata'].get('community_method')}")
    print(f"Graph type: {graph['metadata'].get('graph_type')}")
    
except Exception as e:
    import traceback
    print(f"ERROR: {e}")
    traceback.print_exc()
