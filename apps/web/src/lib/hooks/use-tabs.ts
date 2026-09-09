'use client'

import type { TabList } from '@tab/sdk'
import { type Polled, usePolled } from './use-polled'

/**
 * The tabs the gateway knows about.
 *
 * The only hook here not pinned to `NEXT_PUBLIC_TAB_ACCOUNT_ID` — every other
 * view watches one tab, which is why this one was the last to be wired. It
 * still needs `LIVE` (and so a tab id) to be set, because that flag is what
 * tells the console it has a gateway at all.
 *
 * NOT a registry, and the view must not present it as one:
 * `registrationEnforced` comes back false and will stay false until a
 * registration flow exists.
 */

const POLL_MS = 15_000

const EMPTY: TabList = {
  window: 0,
  // False before the first poll resolves, so a momentary render cannot claim
  // enforcement the gateway never confirmed.
  registrationEnforced: false,
  rootsClaimed: 0,
  note: '',
  tabs: [],
}

export function useTabs(): Polled<TabList> {
  return usePolled((tab) => tab.tabs(), EMPTY, POLL_MS)
}
