'use client'

import Header from '@/components/Header'
import MepMeetingsTimeline from '@/components/MepMeetingsTimeline'

export default function MepMeetingsPage() {
  return (
    <>
      <Header />
      <div className="app-container">
        <main className="main-content collapsed">
          <div style={{ minHeight: 'calc(100vh - 64px)', background: 'rgb(250, 250, 255)' }}>
            <MepMeetingsTimeline />
          </div>
        </main>
      </div>
    </>
  )
}
