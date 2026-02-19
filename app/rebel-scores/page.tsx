'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import RebelScoresSidebar from '@/components/RebelScoresSidebar'
import RebelScoresChart from '@/components/RebelScoresChart'
import {
  Config,
  MEPData,
  MEPDataResponse,
  ViewMode,
  COUNTRY_NAMES,
} from '@/lib/rebel-scores-types'

// Fuzzy search function
function fuzzyMatch(pattern: string, str: string): number {
  pattern = pattern.toLowerCase()
  str = str.toLowerCase()

  if (str.includes(pattern)) {
    return str.indexOf(pattern)
  }

  let patternIdx = 0
  let score = 0
  let lastMatchIdx = -1

  for (let i = 0; i < str.length && patternIdx < pattern.length; i++) {
    if (str[i] === pattern[patternIdx]) {
      if (lastMatchIdx !== -1) {
        score += (i - lastMatchIdx - 1) * 10
      }
      lastMatchIdx = i
      patternIdx++
    }
  }

  if (patternIdx === pattern.length) {
    return score + 100
  }

  return -1
}

export default function RebelScoresPage() {
  // UI state
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  // Data state
  const [config, setConfig] = useState<Config | null>(null)
  const [currentData, setCurrentData] = useState<MEPData[]>([])
  const [allMepData, setAllMepData] = useState<MEPData[]>([])
  const [totalVotes, setTotalVotes] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Filter state
  const [viewMode, setViewMode] = useState<ViewMode>('group')
  const [currentPeriod, setCurrentPeriod] = useState<string>('')
  const [currentTopic, setCurrentTopic] = useState('all')
  const [mepSearchQuery, setMepSearchQuery] = useState('')
  const [countrySearchQuery, setCountrySearchQuery] = useState('')

  // Load config on mount
  useEffect(() => {
    async function loadConfig() {
      try {
        const response = await fetch('/rebel-scores/data/config.json')
        const data: Config = await response.json()
        setConfig(data)
        setCurrentPeriod(data.default_period)
      } catch (err) {
        setError('Failed to load configuration')
        setLoading(false)
      }
    }
    loadConfig()
  }, [])

  // Load data when period or topic changes
  useEffect(() => {
    if (!config || !currentPeriod) return

    const configRef = config // Capture in local variable for TypeScript

    async function loadData() {
      setLoading(true)
      setError(null)

      try {
        // Always load all MEP data for the period (for search functionality)
        const allMepResponse = await fetch(
          `/rebel-scores/data/periods/${currentPeriod}/mep_data.json`
        )
        if (allMepResponse.ok) {
          const allMepJson: MEPDataResponse = await allMepResponse.json()
          setAllMepData(allMepJson.meps)
        }

        // Build URL based on period and topic
        let url: string
        if (currentTopic === 'all') {
          url = `/rebel-scores/data/periods/${currentPeriod}/mep_data.json`
        } else {
          const slug = configRef.topics[currentTopic]
          url = `/rebel-scores/data/periods/${currentPeriod}/topics/${slug}.json`
        }

        const response = await fetch(url)
        if (!response.ok) {
          throw new Error('No data available for this combination')
        }

        const json: MEPDataResponse = await response.json()
        setCurrentData(json.meps)
        setTotalVotes(json.meta.total_votes || 0)
      } catch (err) {
        setError(`No data available for ${currentTopic} in this period.`)
        setCurrentData([])
      } finally {
        setLoading(false)
      }
    }

    loadData()
  }, [config, currentPeriod, currentTopic])

  // Trigger resize event when sidebar collapses/expands
  useEffect(() => {
    const timer = setTimeout(() => {
      window.dispatchEvent(new Event('resize'))
    }, 300)
    return () => clearTimeout(timer)
  }, [sidebarCollapsed])

  // Calculate highlighted MEPs based on search
  const { highlightedMepIds, mepSearchCount, countrySearchInfo } = useMemo(() => {
    const highlightedIds = new Set<number>()
    let searchCount = 0
    let countryInfo = ''

    const searchData = allMepData.length > 0 ? allMepData : currentData

    if (mepSearchQuery) {
      searchData.forEach((mep) => {
        const fullName = `${mep.first_name} ${mep.last_name}`
        const score = fuzzyMatch(mepSearchQuery, fullName)
        if (score >= 0) {
          highlightedIds.add(mep['member.id'])
        }
      })
      searchCount = highlightedIds.size
    } else if (countrySearchQuery) {
      const highlightedCountries = new Set<string>()

      Object.entries(COUNTRY_NAMES).forEach(([code, name]) => {
        const scoreCode = fuzzyMatch(countrySearchQuery, code)
        const scoreName = fuzzyMatch(countrySearchQuery, name)
        if (scoreCode >= 0 || scoreName >= 0) {
          highlightedCountries.add(code)
        }
      })

      searchData.forEach((mep) => {
        if (highlightedCountries.has(mep.country)) {
          highlightedIds.add(mep['member.id'])
        }
      })

      if (highlightedCountries.size > 0) {
        const countryNames = Array.from(highlightedCountries)
          .map((c) => COUNTRY_NAMES[c] || c)
          .join(', ')
        countryInfo = `${highlightedIds.size} MEPs from ${countryNames}`
      }
    }

    return { highlightedMepIds: highlightedIds, mepSearchCount: searchCount, countrySearchInfo: countryInfo }
  }, [mepSearchQuery, countrySearchQuery, allMepData, currentData])

  // Handle MEP search - clear country search
  const handleMepSearchChange = useCallback((query: string) => {
    setMepSearchQuery(query)
    if (query) {
      setCountrySearchQuery('')
    }
  }, [])

  // Handle country search - clear MEP search
  const handleCountrySearchChange = useCallback((query: string) => {
    setCountrySearchQuery(query)
    if (query) {
      setMepSearchQuery('')
    }
  }, [])

  if (!config) {
    return (
      <>
        <aside className="sidebar">
          <div className="sidebar-header">
            <span className="sidebar-title">Loading...</span>
          </div>
        </aside>
        <main className="main-content">
          <div className="loading">Loading configuration...</div>
        </main>
      </>
    )
  }

  return (
    <>
      <RebelScoresSidebar
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        currentPeriod={currentPeriod}
        onPeriodChange={setCurrentPeriod}
        periods={config.periods}
        currentTopic={currentTopic}
        onTopicChange={setCurrentTopic}
        topics={config.topics}
        mepSearchQuery={mepSearchQuery}
        onMepSearchChange={handleMepSearchChange}
        mepSearchCount={mepSearchCount}
        countrySearchQuery={countrySearchQuery}
        onCountrySearchChange={handleCountrySearchChange}
        countrySearchInfo={countrySearchInfo}
      />

      <main className={`main-content ${sidebarCollapsed ? 'collapsed' : ''}`}>
        {loading ? (
          <div className="loading">Loading data...</div>
        ) : error ? (
          <div className="loading">{error}</div>
        ) : (
          <RebelScoresChart
            data={currentData}
            allMepData={allMepData}
            viewMode={viewMode}
            currentTopic={currentTopic}
            currentPeriod={currentPeriod}
            periods={config.periods}
            highlightedMepIds={highlightedMepIds}
            totalVotes={totalVotes}
          />
        )}
      </main>
    </>
  )
}
