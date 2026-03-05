'use client'

import React, { useState, useMemo } from 'react'
import { ViewMode, ConfigPeriod, ConfigTopic } from '@/lib/rebel-scores-types'
import { fuzzyMatch } from '@/lib/search'

interface RebelScoresSidebarProps {
  collapsed: boolean
  onToggle: () => void
  viewMode: ViewMode
  onViewModeChange: (mode: ViewMode) => void
  currentPeriod: string
  onPeriodChange: (period: string) => void
  periods: ConfigPeriod[]
  currentTopic: string
  onTopicChange: (topic: string) => void
  topics: ConfigTopic
  mepSearchQuery: string
  onMepSearchChange: (query: string) => void
  mepSearchCount: number
  countrySearchQuery: string
  onCountrySearchChange: (query: string) => void
  countrySearchInfo: string
}

function SearchField({
  label,
  iconPath,
  placeholder,
  value,
  onChange,
  infoContent,
}: {
  label: string
  iconPath: string
  placeholder: string
  value: string
  onChange: (value: string) => void
  infoContent: React.ReactNode
}) {
  return (
    <div className="filter-section">
      <div className="filter-label">{label}</div>
      <div className="search-container">
        <svg
          className="search-icon"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={2}
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d={iconPath} />
        </svg>
        <input
          type="text"
          className="search-input"
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        {value && (
          <button
            className="search-clear visible"
            onClick={() => onChange('')}
            title="Clear search"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>
      {infoContent && <div className="search-info active">{infoContent}</div>}
    </div>
  )
}

export default function RebelScoresSidebar({
  collapsed,
  onToggle,
  viewMode,
  onViewModeChange,
  currentPeriod,
  onPeriodChange,
  periods,
  currentTopic,
  onTopicChange,
  topics,
  mepSearchQuery,
  onMepSearchChange,
  mepSearchCount,
  countrySearchQuery,
  onCountrySearchChange,
  countrySearchInfo,
}: RebelScoresSidebarProps) {
  const [topicSearch, setTopicSearch] = useState('')

  const sortedTopics = useMemo(() => {
    const topicNames = Object.keys(topics).sort()

    if (!topicSearch) {
      return topicNames
    }

    return topicNames
      .map((topic) => ({
        topic,
        score: fuzzyMatch(topicSearch, topic),
      }))
      .filter((item) => item.score >= 0)
      .sort((a, b) => a.score - b.score)
      .map((item) => item.topic)
  }, [topics, topicSearch])

  return (
    <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
      <div className="sidebar-header">
        <span className="sidebar-title">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-9.75 0h9.75"
            />
          </svg>
          Filters
        </span>
        <button className="collapse-btn" onClick={onToggle} title="Toggle sidebar">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
      </div>

      {/* Collapsed state icons */}
      <div className="collapsed-icons">
        <button className="collapsed-icon-btn" onClick={onToggle} title="Expand to show filters">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M10 20a1 1 0 0 0 .553.895l2 1A1 1 0 0 0 14 21v-7a2 2 0 0 1 .517-1.341L21.74 4.67A1 1 0 0 0 21 3H3a1 1 0 0 0-.742 1.67l7.225 7.989A2 2 0 0 1 10 14z"
            />
          </svg>
        </button>
        <button className="collapsed-icon-btn" onClick={onToggle} title="Expand to show search">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"
            />
          </svg>
        </button>
      </div>

      {/* Expanded state content */}
      <div className="sidebar-content">
        <SearchField
          label="Find MEP"
          iconPath="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z"
          placeholder="Search MEP name..."
          value={mepSearchQuery}
          onChange={onMepSearchChange}
          infoContent={
            mepSearchQuery ? (
              mepSearchCount > 0 ? (
                <>
                  <span className="highlight-count">{mepSearchCount}</span> MEP
                  {mepSearchCount !== 1 ? 's' : ''} found
                </>
              ) : (
                'No MEPs found'
              )
            ) : null
          }
        />

        <SearchField
          label="Find Country"
          iconPath="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418"
          placeholder="Search country..."
          value={countrySearchQuery}
          onChange={onCountrySearchChange}
          infoContent={
            countrySearchQuery ? (countrySearchInfo || 'No countries found') : null
          }
        />

        {/* View Mode */}
        <div className="filter-section">
          <div className="filter-label">Group By</div>
          <div className="filter-options">
            <button
              className={`filter-option ${viewMode === 'group' ? 'active' : ''}`}
              onClick={() => onViewModeChange('group')}
            >
              Political Group
            </button>
            <button
              className={`filter-option ${viewMode === 'country' ? 'active' : ''}`}
              onClick={() => onViewModeChange('country')}
            >
              Country
            </button>
          </div>
        </div>

        {/* Period Filter */}
        <div className="filter-section">
          <div className="filter-label">Parliament Period</div>
          <div className="filter-options">
            {periods.map((period) => (
              <button
                key={period.id}
                className={`filter-option ${currentPeriod === period.id ? 'active' : ''}`}
                onClick={() => onPeriodChange(period.id)}
              >
                {period.label}
              </button>
            ))}
          </div>
        </div>

        {/* Topic Filter */}
        <div className="filter-section">
          <div className="filter-label">Topic</div>
          <div className="search-container">
            <svg
              className="search-icon"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"
              />
            </svg>
            <input
              type="text"
              className="search-input"
              placeholder="Search topics..."
              value={topicSearch}
              onChange={(e) => setTopicSearch(e.target.value)}
            />
          </div>
          <div className="topic-list">
            <button
              className={`topic-option ${currentTopic === 'all' ? 'active' : ''}`}
              onClick={() => onTopicChange('all')}
            >
              All Topics
            </button>
            {sortedTopics.map((topic) => (
              <button
                key={topic}
                className={`topic-option ${currentTopic === topic ? 'active' : ''}`}
                onClick={() => onTopicChange(topic)}
              >
                {topic}
              </button>
            ))}
          </div>
        </div>
      </div>
    </aside>
  )
}
