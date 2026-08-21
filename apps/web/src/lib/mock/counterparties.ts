import { usdc } from '../money'
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
    share: 0.34,
    weight: 1.0,
    reason: 'INDEPENDENT',
    hops: [AGENT, '0.0.4410877'],
  },
  {
    id: '0.0.5120033',
    firstSeen: '12d ago',
    ageDays: 12,
    direction: 'sells to',
    volume: usdc('0.1980'),
    share: 0.2,
    weight: 0.8,
    reason: 'AGE_DISCOUNT',
    hops: [AGENT, '0.0.5120033'],
  },
  {
    id: '0.0.6002911',
    firstSeen: '44d ago',
    ageDays: 44,
    direction: 'both',
    volume: usdc('0.1420'),
    share: 0.14,
    weight: 0.6,
    reason: 'RECIPROCAL_FLOW',
    hops: [AGENT, '0.0.6002911'],
  },
  {
    id: '0.0.4899120',
    firstSeen: '38d ago',
    ageDays: 38,
    direction: 'sells to',
    volume: usdc('0.4360'),
    share: 0.44,
    weight: 0.5,
    reason: 'CONCENTRATION',
    hops: [AGENT, '0.0.4899120'],
  },
  {
    id: '0.0.7710455',
    firstSeen: '9d ago',
    ageDays: 9,
    direction: 'sells to',
    volume: usdc('0.0880'),
    share: 0.09,
    weight: 0.8,
    reason: 'SHARED_ROOT',
    hops: [AGENT, MID, '0.0.7710455'],
  },
  {
    id: '0.0.5591204',
    firstSeen: '4d ago',
    ageDays: 4,
    direction: 'sells to',
    volume: usdc('0.0400'),
    share: 0.04,
    weight: 0.0,
    reason: 'HARD_BLOCK_ANCESTRY',
    hops: [AGENT, MID, 'seller 0.0.5591204'],
  },
]

export const CONCENTRATION_CAP = 0.4
export const MAX_FUNDING_HOPS = 3
export const AGE_FULL_DAYS = 3
