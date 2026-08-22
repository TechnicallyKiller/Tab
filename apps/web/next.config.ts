import type { NextConfig } from 'next'

const config: NextConfig = {
  reactStrictMode: true,
  // Workspace packages ship TypeScript source, not a build step.
  transpilePackages: ['@tab/money'],
  // No backend yet. Every surface renders from src/lib/mock.
  env: { TAB_DATA_SOURCE: 'mock' },
}

export default config
