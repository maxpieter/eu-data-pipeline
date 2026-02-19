/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    // Proxy /api/graph to the Python backend
    return [
      {
        source: '/api/graph',
        destination: 'http://localhost:5001/api/graph',
      },
    ]
  },
}

module.exports = nextConfig
