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
          source: '/api/procedures',
          destination: 'http://localhost:5001/api/procedures',
        },
      ]
    }
    return []
  },
}

module.exports = nextConfig
