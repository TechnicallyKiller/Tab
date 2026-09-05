import {
  HBAR_ASSET_ID,
  HEDERA_MAINNET_CAIP2,
  HEDERA_TESTNET_CAIP2,
  HEDERA_TESTNET_USDC,
} from '@x402/hedera'

/**
 * Asset handling for both legs.
 *
 * Two decimal systems live side by side and mixing them is the easiest way to
 * be wrong by 100x: HBAR is 8 decimals (tinybars), a dollar token is 6
 * (micro-units). Every amount crossing this package is atomic units of a
 * NAMED asset, never a bare number.
 */

export const NETWORKS = {
  testnet: HEDERA_TESTNET_CAIP2,
  mainnet: HEDERA_MAINNET_CAIP2,
} as const

export const TESTNET_USDC = HEDERA_TESTNET_USDC
export const HBAR = HBAR_ASSET_ID

export const TINYBAR_PER_HBAR = 100_000_000n
export const MICRO_PER_TOKEN = 1_000_000n

export interface Asset {
  /** `"0.0.0"` for native HBAR, otherwise an HTS token id. */
  id: string
  decimals: number
  /** Atomic units in one whole unit. 1e8 for HBAR, 1e6 for a 6dp token. */
  unit: bigint
  isHbar: boolean
  symbol: string
}

export function hbarAsset(): Asset {
  return { id: HBAR, decimals: 8, unit: TINYBAR_PER_HBAR, isHbar: true, symbol: 'HBAR' }
}

/**
 * A 6-decimal dollar token — real USDC, or the stand-in when a faucet is
 * unavailable. Read the id from configuration; never hardcode it, because the
 * two are swapped by one environment variable.
 */
export function tokenAsset(tokenId: string, symbol = 'USDC'): Asset {
  if (tokenId === HBAR) throw new Error('0.0.0 is native HBAR — use hbarAsset()')
  return { id: tokenId, decimals: 6, unit: MICRO_PER_TOKEN, isHbar: false, symbol }
}

/** Atomic units for x402 payment requirements. Never a float, never "$1". */
export function atomicAmount(asset: Asset, atomic: bigint): string {
  if (atomic <= 0n) throw new Error(`Price must be positive, received ${atomic}`)
  return atomic.toString()
}

export function formatAtomic(asset: Asset, atomic: bigint): string {
  const negative = atomic < 0n
  const m = negative ? -atomic : atomic
  const whole = m / asset.unit
  const frac = ((m % asset.unit) * 10_000n) / asset.unit
  return `${negative ? '−' : ''}${whole}.${frac.toString().padStart(4, '0')} ${asset.symbol}`
}
