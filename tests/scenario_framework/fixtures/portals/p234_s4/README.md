# Phase 234 runtime verification portal

A small Deno project used by the runtime verification-method cases.

- `src/parser.ts` parses `key=value` tokens and rejects malformed input.
- `scripts/fuzz.ts` explores malformed tokens with a fixed seed.
- `CONTRACT.md` states the boundary clamp formula.
- `src/boundary.ts` implements the clamp.
- `src/behavior.ts` greets a trimmed name.
- `src/private.ts` exposes `buildLabel`; `joinParts` is private.
- `src/auth.ts` authorizes one write and must not call the writer on denial.

The project test command is `deno test -A`.
