'use client'

import { ClusterDetailData, getClusterColor } from '@/lib/data'

interface ClusterHeaderProps {
  cluster: ClusterDetailData
  onBack: () => void
}

export default function ClusterHeader({ cluster, onBack }: ClusterHeaderProps) {
  const clusterColor = getClusterColor(cluster.cluster_id)
  const totalExternalEdges = cluster.external_connections.reduce((sum, c) => sum + c.edge_count, 0)

  return (
    <div className="absolute top-4 left-4 right-4 flex items-center gap-4 bg-white/95 backdrop-blur-sm rounded-xl px-4 py-3 border border-slate-200 shadow-md z-[100]">
      {/* Back Button */}
      <button
        onClick={onBack}
        className="flex items-center gap-2 px-4 py-2 bg-slate-100 hover:bg-slate-200 border-0 rounded-lg cursor-pointer text-sm font-semibold text-slate-600 transition-colors duration-150"
      >
        <svg
          width="16"
          height="16"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M10 19l-7-7m0 0l7-7m-7 7h18"
          />
        </svg>
        Back
      </button>

      {/* Cluster Info */}
      <div className="flex items-center gap-3">
        <div
          className="w-3 h-3 rounded-full shrink-0"
          style={{ background: clusterColor }}
        />
        <div>
          <div className="font-bold text-slate-900 text-base">
            {cluster.cluster_label}
          </div>
          <div className="text-slate-500 text-xs">
            {cluster.metadata.node_count} organizations &middot; {cluster.metadata.edge_count} connections
          </div>
        </div>
      </div>

      {/* Divider */}
      <div className="w-px h-8 bg-slate-200" />

      {/* External Connections Summary */}
      <div className="flex items-center gap-2">
        <div>
          <div className="font-semibold text-slate-600 text-[0.8125rem]">
            External Connections
          </div>
          <div className="text-slate-500 text-xs">
            {totalExternalEdges} edges to {cluster.external_connections.length} other clusters
          </div>
        </div>
      </div>

      {/* Top External Connections */}
      {cluster.external_connections.length > 0 && (
        <>
          <div className="w-px h-8 bg-slate-200" />
          <div className="flex gap-2 flex-wrap">
            {cluster.external_connections.slice(0, 3).map((conn) => (
              <span
                key={conn.cluster_id}
                className="inline-flex items-center gap-1 px-2 py-1 bg-slate-100 rounded text-xs text-slate-600"
              >
                <span
                  className="w-2 h-2 rounded-full"
                  style={{ background: getClusterColor(conn.cluster_id) }}
                />
                {conn.cluster_label}: {conn.edge_count}
              </span>
            ))}
          </div>
        </>
      )}

      {/* Density Badge */}
      <div className="ml-auto px-3 py-1 bg-green-50 rounded-full text-xs font-semibold text-green-700">
        Density: {(cluster.metadata.density * 100).toFixed(1)}%
      </div>
    </div>
  )
}
