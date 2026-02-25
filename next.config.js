/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    // In development, proxy /api/* to the Python backend
    // In production, Next.js will use the Vercel serverless function
    if (process.env.NODE_ENV === 'development') {
      return [
        {
          source: '/api/graph',
          destination: 'http://localhost:5001/api/graph',
        },
        {
          source: '/api/graph-procedures',
          destination: 'http://localhost:5001/api/graph-procedures',
        },
        {
          source: '/api/timeline',
          destination: 'http://localhost:5001/api/timeline',
        },
        {
          source: '/api/meps',
          destination: 'http://localhost:5001/api/meps',
        },
        {
          source: '/api/meps/:id/timeline',
          destination: 'http://localhost:5001/api/meps/:id/timeline',
        },
        {
          source: '/api/meps/:id/procedures',
          destination: 'http://localhost:5001/api/meps/:id/procedures',
        },
        {
          source: '/api/committees',
          destination: 'http://localhost:5001/api/committees',
        },
        {
          source: '/api/committees/:id/timeline',
          destination: 'http://localhost:5001/api/committees/:id/timeline',
        },
        {
          source: '/api/procedures',
          destination: 'http://localhost:5001/api/procedures',
        },
        {
          source: '/api/procedures/:id/timeline',
          destination: 'http://localhost:5001/api/procedures/:id/timeline',
        },
        {
          source: '/api/organizations',
          destination: 'http://localhost:5001/api/organizations',
        },
        {
          source: '/api/organizations/:name/timeline',
          destination: 'http://localhost:5001/api/organizations/:name/timeline',
        },
        {
          source: '/api/procedure-events',
          destination: 'http://localhost:5001/api/procedure-events',
        },
        {
          source: '/api/cache/clear',
          destination: 'http://localhost:5001/api/cache/clear',
        },
      ]
    }
    return []
  },
}

module.exports = nextConfig
