import { bp, usdc } from '../money'
import type { Settlement } from './types'

export const SETTLEMENTS: Settlement[] = [
  {
    window: '0147', range: '13:52 – 14:02',
    credits: usdc('0.1120'), debits: usdc('-0.3280'), interest: usdc('0.0000'),
    net: usdc('-0.2160'), rampFromBp: bp(3000), rampToBp: bp(4500), outcome: 'CLEAN',
    receiptCount: 43, transferId: '0.0.4881190@1755738300.114',
  },
  {
    window: '0146', range: '13:42 – 13:52',
    credits: usdc('0.0870'), debits: usdc('-0.2410'), interest: usdc('0.0000'),
    net: usdc('-0.1540'), rampFromBp: bp(1500), rampToBp: bp(3000), outcome: 'CLEAN',
    receiptCount: 31, transferId: '0.0.4881190@1755737700.882',
  },
  {
    window: '0145', range: '13:32 – 13:42',
    credits: usdc('0.0000'), debits: usdc('-0.0900'), interest: usdc('0.0002'),
    net: usdc('-0.0898'), rampFromBp: bp(4500), rampToBp: bp(1500), outcome: 'MISSED',
    receiptCount: 9, transferId: '—',
  },
  {
    window: '0144', range: '13:22 – 13:32',
    credits: usdc('0.1440'), debits: usdc('-0.1120'), interest: usdc('0.0000'),
    net: usdc('0.0320'), rampFromBp: bp(3000), rampToBp: bp(4500), outcome: 'CLEAN',
    receiptCount: 27, transferId: '0.0.4881190@1755736500.401',
  },
  {
    window: '0143', range: '13:12 – 13:22',
    credits: usdc('0.0320'), debits: usdc('-0.1980'), interest: usdc('0.0000'),
    net: usdc('-0.1660'), rampFromBp: bp(3000), rampToBp: bp(3000), outcome: 'CARRIED',
    receiptCount: 18, transferId: '0.0.4881190@1755735900.223',
  },
  {
    window: '0142', range: '13:02 – 13:12',
    credits: usdc('0.0910'), debits: usdc('-0.0710'), interest: usdc('0.0000'),
    net: usdc('0.0200'), rampFromBp: bp(1500), rampToBp: bp(3000), outcome: 'CLEAN',
    receiptCount: 22, transferId: '0.0.4881190@1755735300.019',
  },
]

/** The reconciler's diff. It runs on camera, so it is a designed artifact. */
export const RECONCILIATION = { checked: 43, matched: 43, repaired: 0 }
