## What

<!-- One or two lines. -->

## Checklist

- [ ] **[HANDOFF.md](../HANDOFF.md) updated** — an entry in the log, and *Current State* if it changed
- [ ] `pnpm guard` passes
- [ ] `pnpm test` passes
- [ ] If a shared interface, schema, or documented decision changed: added to the
      **Contract changes** table in HANDOFF.md
- [ ] If a doc is now wrong: fixed in this PR, not later

## Review questions

- Does this cross a tier boundary in [`boundaries.json`](../boundaries.json)? If so, why is that
  deliberate?
- Does money depend on a value that is not in an HCS message?
- Can any failure path here turn an error into an allow?
- Is there a `number` holding an amount?
