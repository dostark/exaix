# Phase 234 verification-method portal

A small Deno project used by the verification-method cases.

- `src/serializer.ts` implements `encode` and `decode` with a round-trip contract.
- `src/grammar.ts` is the independent token grammar for the two parsers.
- `src/parser_old.ts` and `src/parser_new.ts` disagree on a spaced token string.
- `src/formatter.ts` is a one-line formatter with fixed examples.
- `src/helper.ts` exposes `buildLabel`; `joinParts` is private.
- `src/retry.ts` implements retry and authorization behavior.

The project test command is `deno test -A`.
