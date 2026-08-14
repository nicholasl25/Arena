# Agent rules

## Scope
- Smallest diff that solves the task. No drive-by refactors, abstractions, or docs unless asked.
- Match existing style in the file you're editing.

## Anti-bloat
- Don't add helpers for one-off use. Inline until the third real reuse.
- Don't add layers (wrappers, factories, base classes) to "future-proof."
- Don't add error handling for impossible paths. Fail loud on programmer errors.
- Don't add tests, types, or comments that restate the code.

## Function contracts
- Name + signature should state intent. If you need a comment to explain what it does, rename or split it.
- Validate at boundaries (public API, user input, I/O). Trust internal callers.
- Return shapes are stable: don't return `null` sometimes and `[]` other times for the same case.
- Side effects belong in the name (`save*`, `render*`, `fetch*`) or stay out of pure helpers.
- Prefer early returns over deep nesting. Max ~3 levels.

## Before finishing
- Can anything be deleted instead of added?
- Would a teammate guess wrong from the function name alone? Fix the contract.
