'use client'

import { useMemo } from 'react'
import dynamic from 'next/dynamic'
import {
  MEPData,
  ViewMode,
  GROUP_COLORS,
  GROUP_NAMES,
  COUNTRY_COLORS,
  COUNTRY_NAMES,
  GROUP_ORDER,
  ConfigPeriod,
} from '@/lib/rebel-scores-types'
import type { PlotData, Layout } from 'plotly.js'

// Dynamic import to avoid SSR issues with Plotly
const Plot = dynamic(() => import('react-plotly.js'), { ssr: false })

interface RebelScoresChartProps {
  data: MEPData[]
  allMepData: MEPData[]
  viewMode: ViewMode
  currentTopic: string
  currentPeriod: string
  periods: ConfigPeriod[]
  highlightedMepIds: Set<number>
  totalVotes: number
}

// Add jitter to avoid overlapping points
function jitter(value: number, amount = 0.3): number {
  return value + (Math.random() - 0.5) * amount
}

export default function RebelScoresChart({
  data,
  allMepData,
  viewMode,
  currentTopic,
  currentPeriod,
  periods,
  highlightedMepIds,
  totalVotes,
}: RebelScoresChartProps) {
  const { traces, layout } = useMemo(() => {
    // Get filtered data - include highlighted MEPs even if not in current topic
    const getFilteredData = (): MEPData[] => {
      if (highlightedMepIds.size > 0 && currentTopic !== 'all') {
        const topicMepIds = new Set(data.map((m) => m['member.id']))
        const additionalMeps = allMepData.filter(
          (m) => highlightedMepIds.has(m['member.id']) && !topicMepIds.has(m['member.id'])
        )
        return [...data, ...additionalMeps]
      }
      return data
    }

    const filteredData = getFilteredData()

    let categories: string[]
    let categoryToX: Record<string, number>
    let categoryField: 'group' | 'country'
    let categoryNames: Record<string, string>
    let categoryColors: Record<string, string>
    let xAxisTitle: string

    if (viewMode === 'country') {
      // Calculate average rebel score per country for sorting
      const countryAvgRebel: Record<string, number> = {}
      const countryCounts: Record<string, number> = {}

      filteredData.forEach((d) => {
        if (!d.country) return
        if (!countryAvgRebel[d.country]) {
          countryAvgRebel[d.country] = 0
          countryCounts[d.country] = 0
        }
        const score = d.avg_country_rebel_score
        if (typeof score === 'number' && !isNaN(score)) {
          countryAvgRebel[d.country] += score
          countryCounts[d.country]++
        }
      })

      Object.keys(countryAvgRebel).forEach((c) => {
        if (countryCounts[c] > 0) {
          countryAvgRebel[c] /= countryCounts[c]
        }
      })

      categories = [
        ...new Set(filteredData.filter((d) => d.country).map((d) => d.country)),
      ].sort((a, b) => (countryAvgRebel[a] || 0) - (countryAvgRebel[b] || 0))

      categoryToX = Object.fromEntries(categories.map((c, i) => [c, i]))
      categoryField = 'country'
      categoryNames = COUNTRY_NAMES
      categoryColors = COUNTRY_COLORS
      xAxisTitle = 'Country (least to most divided)'
    } else {
      categories = [...new Set(filteredData.map((d) => d.group))].sort((a, b) => {
        const aIdx = GROUP_ORDER.indexOf(a)
        const bIdx = GROUP_ORDER.indexOf(b)
        if (aIdx === -1) return 1
        if (bIdx === -1) return -1
        return aIdx - bIdx
      })

      categoryToX = Object.fromEntries(categories.map((g, i) => [g, i]))
      categoryField = 'group'
      categoryNames = GROUP_NAMES
      categoryColors = GROUP_COLORS
      xAxisTitle = 'Group'
    }

    const hasHighlights = highlightedMepIds.size > 0
    const rebelScoreField = viewMode === 'country' ? 'avg_country_rebel_score' : 'avg_rebel_score'
    const zScoreField = viewMode === 'country' ? 'country_z_score' : 'group_z_score'

    // Create traces for non-highlighted MEPs
    const traces: Partial<PlotData>[] = categories.map((category) => {
      const catData = hasHighlights
        ? filteredData.filter(
            (d) => d[categoryField] === category && !highlightedMepIds.has(d['member.id'])
          )
        : filteredData.filter((d) => d[categoryField] === category)

      const baseX = categoryToX[category]
      const color = categoryColors[category] || '#64748b'

      return {
        name: category,
        x: catData.map(() => jitter(baseX)),
        y: catData.map((d) => d[rebelScoreField] || 0),
        customdata: catData.map((d) => d['member.id']),
        text: catData.map(
          (d) =>
            `<b>${d.first_name} ${d.last_name}</b><br>` +
            `Group: ${GROUP_NAMES[d.group] || d.group}<br>` +
            `Country: ${COUNTRY_NAMES[d.country] || d.country}<br>` +
            `Votes: ${d.n_votes}<br>` +
            `Rebel Score: ${d[rebelScoreField]?.toFixed(4) || 'N/A'}<br>` +
            `Z-Score: ${d[zScoreField]?.toFixed(2) || 'N/A'}<br>` +
            `<i>Click for profile</i>`
        ),
        mode: 'markers' as const,
        type: 'scatter' as const,
        marker: {
          color: color,
          size: hasHighlights ? 7 : 9,
          opacity: hasHighlights ? 0.25 : 0.75,
          line: {
            color: 'white',
            width: 1,
          },
        },
        hoverinfo: 'text' as const,
        hoverlabel: {
          bgcolor: 'white',
          bordercolor: color,
          font: {
            family: 'ui-sans-serif, system-ui, sans-serif',
            size: 13,
            color: '#1e293b',
          },
        },
      }
    })

    // Add highlighted MEPs as a separate trace on top
    if (hasHighlights) {
      const highlightedData = filteredData.filter((d) => highlightedMepIds.has(d['member.id']))
      if (highlightedData.length > 0) {
        traces.push({
          name: 'Highlighted',
          x: highlightedData.map((d) => jitter(categoryToX[d[categoryField]])),
          y: highlightedData.map((d) => d[rebelScoreField] || 0),
          customdata: highlightedData.map((d) => d['member.id']),
          text: highlightedData.map(
            (d) =>
              `<b>${d.first_name} ${d.last_name}</b><br>` +
              `Group: ${GROUP_NAMES[d.group] || d.group}<br>` +
              `Country: ${COUNTRY_NAMES[d.country] || d.country}<br>` +
              `Votes: ${d.n_votes}<br>` +
              `Rebel Score: ${d[rebelScoreField]?.toFixed(4) || 'N/A'}<br>` +
              `Z-Score: ${d[zScoreField]?.toFixed(2) || 'N/A'}<br>` +
              `<i>Click for profile</i>`
          ),
          mode: 'markers' as const,
          type: 'scatter' as const,
          marker: {
            color: '#ff6b00',
            size: 14,
            opacity: 1,
            line: {
              color: '#000',
              width: 2,
            },
          },
          hoverinfo: 'text' as const,
          hoverlabel: {
            bgcolor: 'white',
            bordercolor: '#ff6b00',
            font: {
              family: 'ui-sans-serif, system-ui, sans-serif',
              size: 13,
              color: '#1e293b',
            },
          },
        })
      }
    }

    // Get period label for title
    const periodLabel = periods.find((p) => p.id === currentPeriod)?.label || currentPeriod
    const groupByLabel = viewMode === 'country' ? 'Country' : 'Group'
    let title = `MEP Rebel Scores by ${groupByLabel} - ${periodLabel}`
    if (currentTopic !== 'all') {
      title = `MEP Rebel Scores by ${groupByLabel} - ${currentTopic} (${periodLabel})`
    }

    const layout: Partial<Layout> = {
      title: {
        text: title,
        font: {
          family: 'ui-sans-serif, system-ui, sans-serif',
          size: 18,
          color: '#1e293b',
        },
      },
      xaxis: {
        title: {
          text: xAxisTitle,
          font: { family: 'ui-sans-serif, system-ui, sans-serif', size: 13, color: '#64748b' },
        },
        tickmode: 'array' as const,
        tickvals: categories.map((_, i) => i),
        ticktext: categories.map((c) => categoryNames[c] || c),
        tickfont: { family: 'ui-sans-serif, system-ui, sans-serif', size: 11, color: '#475569' },
        tickangle: -30,
        gridcolor: '#f1f5f9',
        linecolor: '#e2e8f0',
      },
      yaxis: {
        title: {
          text: 'Average Rebel Score',
          font: { family: 'ui-sans-serif, system-ui, sans-serif', size: 13, color: '#64748b' },
        },
        tickfont: { family: 'ui-sans-serif, system-ui, sans-serif', size: 12, color: '#475569' },
        gridcolor: '#f1f5f9',
        linecolor: '#e2e8f0',
        zeroline: true,
        zerolinecolor: '#e2e8f0',
      },
      hovermode: 'closest' as const,
      showlegend: false,
      margin: { t: 60, b: 120, l: 60, r: 20 },
      paper_bgcolor: 'white',
      plot_bgcolor: 'white',
    }

    return { traces, layout }
  }, [data, allMepData, viewMode, currentTopic, currentPeriod, periods, highlightedMepIds])

  const handleClick = (event: Readonly<Plotly.PlotMouseEvent>) => {
    const point = event.points[0]
    if (point?.customdata) {
      window.open(`https://parl8.eu/app/meps/${point.customdata}`, '_blank')
    }
  }

  // Calculate stats
  const stats = useMemo(() => {
    const rebelScoreField = viewMode === 'country' ? 'avg_country_rebel_score' : 'avg_rebel_score'
    const outlierField = viewMode === 'country' ? 'country_is_outlier' : 'group_is_outlier'

    const avgRebel = data.reduce((sum, d) => sum + (d[rebelScoreField] || 0), 0) / data.length
    const outliers = data.filter((d) => d[outlierField]).length
    const groups = new Set(data.map((d) => d.group)).size
    const countries = new Set(data.map((d) => d.country)).size

    return {
      totalMEPs: data.length,
      totalVotes,
      avgRebel,
      outliers,
      categoryCount: viewMode === 'country' ? countries : groups,
      categoryLabel: viewMode === 'country' ? 'Countries' : 'Groups',
    }
  }, [data, viewMode, totalVotes])

  if (data.length === 0) {
    return <div className="loading">No data available for this selection.</div>
  }

  return (
    <>
      <div className="stats-grid">
        <div className="stat-card">
          <h3>MEPs</h3>
          <div className="value">{stats.totalMEPs.toLocaleString()}</div>
        </div>
        <div className="stat-card">
          <h3>Total Votes</h3>
          <div className="value">{stats.totalVotes.toLocaleString()}</div>
        </div>
        <div className="stat-card">
          <h3>Avg Rebel Score</h3>
          <div className="value">{stats.avgRebel.toFixed(4)}</div>
        </div>
        <div className="stat-card">
          <h3>Outliers (z &gt; 2)</h3>
          <div className="value">{stats.outliers}</div>
        </div>
        <div className="stat-card">
          <h3>{stats.categoryLabel}</h3>
          <div className="value">{stats.categoryCount}</div>
        </div>
      </div>

      <div className="chart-container-padded">
        <Plot
          data={traces as PlotData[]}
          layout={layout}
          config={{
            responsive: true,
            displayModeBar: true,
            modeBarButtonsToRemove: ['lasso2d', 'select2d'],
            displaylogo: false,
          }}
          className="w-full h-[600px]"
          onClick={handleClick}
        />
      </div>
    </>
  )
}
