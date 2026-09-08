/*
 * Reason names mirror `@tab/protocol` exactly.
 *
 * They used to be this file's own invention, which meant the mock rehearsed a
 * vocabulary the system does not use — and a mock that disagrees with reality
 * is a mock that hides a bug rather than standing in for one.
 */
import { bp, usdc } from '../money'
import type { Counterparty } from './types'

const AGENT = 'agent 0.0.4482091'
const MID = '0.0.5300118'

export const COUNTERPARTIES: Counterparty[] = [
  {
    id: '0.0.4410877',
    firstSeen: '61d ago',
    ageDays: 61,
    direction: 'buys from',
    volume: usdc('0.3340'),
    shareBp: bp(3400),
    weightBp: bp(10000),
    reason: 'INDEPENDENT',
    hops: [AGENT, '0.0.4410877'],
  },
  {
    id: '0.0.5120033',
    firstSeen: '12d ago',
    ageDays: 12,
    direction: 'sells to',
    volume: usdc('0.1980'),
    shareBp: bp(2000),
    weightBp: bp(8000),
    reason: 'YOUNG_ACCOUNT',
    hops: [AGENT, '0.0.5120033'],
  },
  {
    id: '0.0.6002911',
    firstSeen: '44d ago',
    ageDays: 44,
    direction: 'both',
    volume: usdc('0.1420'),
    shareBp: bp(1400),
    weightBp: bp(6000),
    reason: 'RECIPROCAL_FLOW',
    hops: [AGENT, '0.0.6002911'],
  },
  {
    id: '0.0.4899120',
    firstSeen: '38d ago',
    ageDays: 38,
    direction: 'sells to',
    volume: usdc('0.4360'),
    shareBp: bp(4400),
    weightBp: bp(5000),
    reason: 'CONCENTRATED',
    hops: [AGENT, '0.0.4899120'],
  },
  {
    id: '0.0.7710455',
    firstSeen: '9d ago',
    ageDays: 9,
    direction: 'sells to',
    volume: usdc('0.0880'),
    shareBp: bp(900),
    weightBp: bp(8000),
    reason: 'SHARED_FUNDING_ROOT',
    hops: [AGENT, MID, '0.0.7710455'],
  },
  {
    id: '0.0.5591204',
    firstSeen: '4d ago',
    ageDays: 4,
    direction: 'sells to',
    volume: usdc('0.0400'),
    shareBp: bp(400),
    weightBp: bp(0),
    reason: 'COMMON_FUNDER',
    hops: [AGENT, MID, 'seller 0.0.5591204'],
  },
]

export const CONCENTRATION_CAP_BP = bp(4000)
export const MAX_FUNDING_HOPS = 3
export const AGE_FULL_DAYS = 3
