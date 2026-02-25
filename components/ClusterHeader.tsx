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
    <div
      style={{
        position: 'absolute',
        top: '1rem',
        left: '1rem',
        right: '1rem',
        display: 'flex',
        alignItems: 'center',
        gap: '1rem',
        background: 'rgba(255, 255, 255, 0.95)',
        backdropFilter: 'blur(8px)',
        borderRadius: '12px',
        padding: '0.75rem 1rem',
        border: '1px solid #e2e8f0',
        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
        zIndex: 100,
      }}
    >
      {/* Back Button */}
      <button
        onClick={onBack}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          padding: '0.5rem 1rem',
          background: '#f1f5f9',
          border: 'none',
          borderRadius: '8px',
          cursor: 'pointer',
          fontSize: '0.875rem',
          fontWeight: 600,
          color: '#475569',
          transition: 'background 0.15s',
        }}
        onMouseOver={(e) => (e.currentTarget.style.background = '#e2e8f0')}
        onMouseOut={(e) => (e.currentTarget.style.background = '#f1f5f9')}
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
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <div
          style={{
            width: '12px',
            height: '12px',
            borderRadius: '50%',
            background: clusterColor,
            flexShrink: 0,
          }}
        />
        <div>
          <div style={{ fontWeight: 700, color: '#1e293b', fontSize: '1rem' }}>
            {cluster.cluster_label}
          </div>
          <div style={{ color: '#64748b', fontSize: '0.75rem' }}>
            {cluster.metadata.node_count} organizations &middot; {cluster.metadata.edge_count} connections
          </div>
        </div>
      </div>

      {/* Divider */}
      <div style={{ width: '1px', height: '32px', background: '#e2e8f0' }} />

      {/* External Connections Summary */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <div>
          <div style={{ fontWeight: 600, color: '#475569', fontSize: '0.8125rem' }}>
            External Connections
          </div>
          <div style={{ color: '#64748b', fontSize: '0.75rem' }}>
            {totalExternalEdges} edges to {cluster.external_connections.length} other clusters
          </div>
        </div>
      </div>

      {/* Top External Connections */}
      {cluster.external_connections.length > 0 && (
        <>
          <div style={{ width: '1px', height: '32px', background: '#e2e8f0' }} />
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {cluster.external_connections.slice(0, 3).map((conn) => (
              <span
                key={conn.cluster_id}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.25rem',
                  padding: '0.25rem 0.5rem',
                  background: '#f1f5f9',
                  borderRadius: '4px',
                  fontSize: '0.75rem',
                  color: '#475569',
                }}
              >
                <span
                  style={{
                    width: '8px',
                    height: '8px',
                    borderRadius: '50%',
                    background: getClusterColor(conn.cluster_id),
                  }}
                />
                {conn.cluster_label}: {conn.edge_count}
              </span>
            ))}
          </div>
        </>
      )}

      {/* Density Badge */}
      <div
        style={{
          marginLeft: 'auto',
          padding: '0.25rem 0.75rem',
          background: '#f0fdf4',
          borderRadius: '9999px',
          fontSize: '0.75rem',
          fontWeight: 600,
          color: '#15803d',
        }}
      >
        Density: {(cluster.metadata.density * 100).toFixed(1)}%
      </div>
    </div>
  )
}
