import type { NextConfig } from 'next'

const config: NextConfig = {
  reactStrictMode: true,
  // No backend yet. Every surface renders from src/lib/mock.
  env: { TAB_DATA_SOURCE: 'mock' },
}

export default config
