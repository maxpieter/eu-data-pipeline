import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'EU Parliament Data',
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
        {children}
      </body>
    </html>
  )
}
