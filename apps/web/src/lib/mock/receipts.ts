import { usdc } from '../money'
import type { Receipt } from './types'

/** Seed rows, straight from the artboard. Newest first. */
const SEED: [string, Receipt['leg'], string, string, boolean, string][] = [
  ['1755738214.883104227', 'DEBIT', '0.0.5591204', '-0.0400', true, 'b91c…e40a'],
  ['1755738211.117640882', 'CREDIT', '0.0.4410877', '0.0250', true, '77df…3c19'],
  ['1755738208.402911005', 'DEBIT', '0.0.5120033', '-0.0180', true, '0ac4…918b'],
  ['1755738205.771002944', 'CREDIT', '0.0.4410877', '0.0250', true, 'e2b8…41f7'],
  ['1755738201.446920113', 'REFUSED', '0.0.5591204', '0.0400', false, '5d10…cc72'],
  ['1755738197.905331276', 'DEBIT', '0.0.5120033', '-0.0180', true, '3f6a…aa01'],
  ['1755738193.220884610', 'CREDIT', '0.0.6002911', '0.0120', false, 'c48e…0d55'],
  ['1755738188.664201773', 'DEBIT', '0.0.4899120', '-0.0090', true, '19ab…7712'],
  ['1755738184.019773450', 'CREDIT', '0.0.4410877', '0.0250', true, 'd034…5f8e'],
  ['1755738180.552118307', 'DEBIT', '0.0.5120033', '-0.0180', true, '8b52…c1a0'],
  ['1755738175.884301226', 'DEBIT', '0.0.7710455', '-0.0310', true, 'f77e…2d63'],
  ['1755738171.330098871', 'CREDIT', '0.0.6002911', '0.0120', true, '4c19…90bb'],
]

export const TOP_SEQ = 41898

export const SEED_RECEIPTS: Receipt[] = SEED.map((r, i) => ({
  consensus: r[0],
  leg: r[1],
  counterparty: r[2],
  amount: usdc(r[3]),
  attested: r[4],
  requestHash: r[5],
  seq: TOP_SEQ - i,
}))

export const DEBIT_SELLERS = ['0.0.5120033', '0.0.7710455', '0.0.4899120']
export const CREDIT_PAYERS = ['0.0.4410877', '0.0.6002911']
export const BLOCKED_SELLER = '0.0.5591204'

/** The landing page's receipt tape. Doubled by the component for a seamless loop. */
export const TAPE_ROWS = SEED_RECEIPTS.slice(0, 8)
