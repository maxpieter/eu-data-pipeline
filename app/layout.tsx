import type { Metadata } from 'next'
import './globals.css'
import Header from '@/components/Header'

export const metadata: Metadata = {
  title: 'EU Network Graph',
  description: 'Visualizing MEPs, Commissioners, and their meetings',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <Header />
        <div className="app-container">
          {children}
        </div>
      </body>
    </html>
  )
}
