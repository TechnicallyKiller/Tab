# Why the linter is configured the way it is

Three rules are **off**, and each is off because it contradicts something
`tsconfig.base.json` requires. Leaving them on meant `pnpm lint` reported 627
errors against code that was correct — which is worse than no linter, because a
check nobody can pass is a check everybody learns to ignore.

## `complexity/useLiteralKeys` — OFF (282 errors)

It wants `process.env.TOPIC_RECEIPTS` instead of `process.env['TOPIC_RECEIPTS']`.

`tsconfig.base.json` sets **`noPropertyAccessFromIndexSignature: true`**, which
makes dot access on an index signature a type error. So TypeScript requires the
bracket form and Biome forbids it. One of them has to give, and it is not going
to be the type checker: the setting exists so that reading an unknown env var
is visibly a lookup that can fail rather than a property that exists.

## `style/noNonNullAssertion` — OFF (111 errors)

`tsconfig.base.json` sets **`noUncheckedIndexedAccess: true`**, so every
`array[i]` and `map[key]` is `T | undefined` — including cases the surrounding
code has already made safe (a loop bound by `array.length`, a `Map` written on
the line above). The `!` is how you say "I checked".

The alternative is a non-null assertion by another name — `?? throwSomething()`
at hundreds of sites — which is noisier and no safer. Where the undefined case
is *real*, the codebase handles it explicitly and says why; those are the
comments worth reading, and they are easier to find when `!` is not everywhere
under protest.

## `complexity/noExcessiveCognitiveComplexity` — OFF (44)

Flags long `switch` statements over message types and the ceiling formula. Both
are linear and readable; splitting either to satisfy a metric would scatter one
decision across several functions.

## `complexity/noImportantStyles` — OFF, and this one nearly shipped a regression

Biome flags every `!important`. Running its fix stripped six of them out of the
`prefers-reduced-motion` block:

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 1ms !important;   /* removed */
    transition-duration: 1ms !important;  /* removed */
  }
}
```

`!important` is **required** there. The whole point of that block is to override
the animation rules it is disabling, and without it the override loses to more
specific selectors — so a user who has asked their operating system for reduced
motion silently keeps getting animations. That is an accessibility regression
that no test would catch and nobody would notice on a demo machine.

Caught by reading the diff after `biome check --write --unsafe`, which is
exactly what "unsafe" is warning about.

## `style/useTemplate` — OFF (62)

Wants template literals for every concatenation. Much of this codebase's output
is multi-line operator prose built with `+` across lines specifically so it stays
under 100 columns and reads as sentences. That is a deliberate style, not an
oversight.

## `suspicious/noConsole` — ON in packages, OFF in apps, tools and agents

A **package** printing to stdout is a bug: it is a library, and its caller
decides what the user sees.

An **app** is a CLI or a server whose output IS the product — `pnpm reconcile`
and `pnpm verify-tab` are deliverables that run on camera, and their job is to
be readable by someone who has never seen the codebase.

`packages/mcp` is in the exempt list for a sharper reason: a stdio MCP server
speaks JSON-RPC on **stdout**, so it writes diagnostics to stderr, and the rule
cannot tell the difference.

## What stays ON

`noExplicitAny`, `noUnusedImports`, `useImportType`, `useOptionalChain`,
`noAssignInExpressions`, and the whole recommended set beyond the exceptions
above. Those catch real things, and the formatter is enforced unchanged.
