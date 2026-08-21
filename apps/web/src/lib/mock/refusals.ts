import type { Refusal } from './types'

export const REFUSALS: Refusal[] = [
  {
    rule: 'CONTROL_CLUSTER',
    ruleDetail: 'funding ancestry ≤ 3 hops',
    sentence:
      'Spend of $0.0400 to 0.0.5591204 refused. The agent funded this seller two hops back, so the purchase would be self-dealing and the revenue would not be real.',
    consensus: '1755738201.446920113',
    seq: '41 894',
    evidence: [
      { label: 'agent 0.0.4482091', tone: 'neutral', arrow: '→' },
      { label: '0.0.5300118', tone: 'neutral', arrow: '→' },
      { label: 'seller 0.0.5591204', tone: 'bad', arrow: '' },
    ],
  },
  {
    rule: 'PER_CALL_CAP',
    ruleDetail: '0.0500',
    sentence:
      'Spend of $0.0720 to 0.0.7710455 refused. The request exceeds the per-call cap in force for tier C.',
    consensus: '1755738166.902144037',
    seq: '41 881',
    evidence: [
      { label: 'request 0.0720', tone: 'bad', arrow: 'vs' },
      { label: 'cap 0.0500', tone: 'neutral', arrow: '' },
    ],
  },
  {
    rule: 'CEILING_EXCEEDED',
    ruleDetail: 'outstanding + holds + amount',
    sentence:
      'Spend of $0.0900 to 0.0.5120033 refused. Outstanding 0.4821 plus holds 0.0900 plus the request would pass the 1.0000 ceiling.',
    consensus: '1755738142.771903882',
    seq: '41 868',
    evidence: [
      { label: 'outstanding 0.4821', tone: 'bad', arrow: 'vs' },
      { label: 'ceiling 1.0000', tone: 'neutral', arrow: '' },
    ],
  },
]

/** Filter counts turn the view into a summary of what the engine is catching. */
export const RULE_COUNTS: [string, number][] = [
  ['ALL', 3],
  ['CONTROL_CLUSTER', 1],
  ['PER_CALL_CAP', 1],
  ['CEILING_EXCEEDED', 1],
  ['WINDOW_CAP', 0],
]
