# Contributing

## Every session

**Read [HANDOFF.md](HANDOFF.md) when you sit down. Update it before you push.** It is the living
state of the project: who owns what, what is blocked, and which documented decisions have changed
since they were written. On a hackathon timeline the cost of two people solving the same problem is
the whole margin.

## Before your first commit

1. Read [docs/RESEARCH.md](docs/RESEARCH.md). Six findings change what several packages do, and
   two of them contradict [README-TAB.md](README-TAB.md).
2. Read the README of the package you are working in. It states the invariants you must not break.
3. Run `pnpm guard`. If it fails, the structure is telling you something.

## The four questions in review

- **Does this cross a tier boundary?** `boundaries.json` will catch it. If you need a new
  dependency, change that file deliberately and say why in the PR — do not route around it.
- **Does money depend on a value that is not in an HCS message?** If yes, it needs one.
  [ADR-0007](docs/adr/0007-hcs-as-source-of-truth.md).
- **Can this turn an error into an allow?** Every failure path refuses. There are no exceptions.
- **Is there a `number` holding an amount?** [ADR-0006](docs/adr/0006-money-as-bigint.md).

## Changing a decision

Do not edit an ADR. Write a new one that supersedes it, and link both ways. The reason a decision
was made is as useful as the decision, especially the ones that turned out wrong.

## Changing a credit parameter

Add a version to `@tab/params`. Never edit a published one — a ceiling from week one must remain
verifiable in week three, which is the whole point of `verify-ceiling`.

## Before you push

1. `pnpm guard && pnpm test`
2. **Append an entry to [HANDOFF.md](HANDOFF.md)**, and update *Current State* if it changed.
3. If you changed a shared interface, a schema, or a documented decision, add a row to the
   **Contract changes** table. That table is what stops a teammate building against a stale doc.
4. If you found a doc that is now wrong, fix it in the same commit.

## Commits

Conventional commits, scoped by package: `feat(fastpath): ...`, `fix(ledger): ...`. Changesets for
anything touching `sdk`, `agentkit-plugin` or `mcp`, since those are published.
