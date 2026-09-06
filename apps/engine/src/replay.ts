/**
 * Re-exported so `main.ts` has one import for the replay seam.
 *
 * `entriesFromMessages` is the shared, pure decode from `@tab/ledger`;
 * `readTopic` and `reassembleChunks` are the fetch, which ledger may not do.
 * Keeping both behind this file makes the boundary visible at the call site
 * rather than something a reader has to reconstruct from two import lines.
 */
export { entriesFromMessages, type Replay, type TopicMessage } from '@tab/ledger'
export { readTopic, reassembleChunks } from '@tab/mirror'
