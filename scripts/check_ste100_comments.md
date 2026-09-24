# check:ste100-comments — Comment STE gate

`scripts/check_ste100_comments.ts` verifies that comment prose in owned TypeScript
source follows the shared ASD-STE100 / Exaix STE Extension v1 counting rules, reusing
the same deterministic Issue 9 core (`scripts/ste100_prose_rules.ts`) as the agent-prose
authoring gate. It is the Phase 195 Step 6 authoring check for code comments.

## Scope

Parser-aware extraction of TS/TSX comment prose using the TypeScript scanner:

- Line comments (`//`), block comments (`/* ... */`), JSDoc blocks (`/** ... */`), and
  inline trailing comments.
- Strings, regex literals, and template literal text are tokens, not trivia — they are
  never extracted as comments.
- Directives and tag-only comments are preserved and skipped: `deno-lint-ignore`,
  `ts-ignore`/`ts-expect-error`, `noinspection`, `eslint-disable`/`enable`,
  `prettier-ignore`, `cspell:disable`, bare JSDoc tags, a single backticked literal, a
  bracketed reference, or a one-word identifier carry no STE-countable sentence.

## Modes

| Command                                                         | Scope                                                                                              |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `deno run -A scripts/check_ste100_comments.ts`                  | Full scan of owned roots (`packages`, `apps`, `scripts`, `migrations`, `exaix-team`) — report only |
| `deno run -A scripts/check_ste100_comments.ts --focused <path>` | One file or directory, all comments checked                                                        |
| `deno run -A scripts/check_ste100_comments.ts --staged`         | Staged TS/TSX files, diff-aware ratchet: only comments on added/changed lines gate                 |

Exit codes: `0` clean, `1` confirmed violation, `2` read/parse error.

A `--staged` run drives `git diff --cached` and parses the added (new-file) line numbers
from `--unified=0` hunks. Only comments whose first prose line is among the added lines
are gated — a file may stage with pre-existing non-compliant comments untouched, but any
comment line introduced or modified by the staged change must comply.

## Staged ratchet

The `--staged` mode is a file-level ratchet in the same family as
`check:optional-params:staged` and `check:md-path:staged`. It runs in the pre-commit hook
(`check:ste100-comments:staged` in `scripts/setup_hooks.ts`) and in
`scripts/ci.ts:STATIC_CHECK_TASKS`, so the two stay in parity
(`tests/scripts/ci_wiring_test.ts`).

Untouched, pre-existing comment lines that already violate the rules remain grandfathered;
only new/modified comment lines must comply. This keeps the gate usable alongside the
existing codebase rather than blocking every change on the historical comment corpus.

## Limits

- Deterministic and decidable rules only: `STE-5.1`, `STE-6.3`, `STE-6.6`, `STE-8.1`, and
  the shared `STE-8.4`–`STE-8.7` counting mechanics. Semantic rules (vocabulary, passive
  voice, repetition, relevance) remain contextual review checks, not automatic findings.
- SQL comment extraction is not covered by this scanner; it is tracked as an ownership
  gap for `check:ste100-comments`.
- A comment's first prose line is the reported location; column is best-effort.

## Documentation exception and preservation

The gate preserves directives, JSDoc tags, identifiers, commands, one-line literal spans,
and exact quotations. It never rewrites comment text — findings only, no auto-fix.
Documentation deliverables (`docs/`, `exaix-dev-docs/`, README files, and documentation
spans embedded in skill examples) are exempt from the mandatory rule and are not scanned
as comment prose. The exemption covers the deliverable, not source-comment prose: code
comments remain eligible even inside a documentation-owned module.

## Manual migration

This gate is a ratchet, not a migration tool. Pre-existing comment lines that already
violate the rules are grandfathered by design and never block an unrelated staged change.
Migration of the historical corpus is a manual, owned process:

1. Run the full scan to enumerate findings: `deno task check:ste100-comments`.
2. Rewrite each confirmed finding by hand, preserving directives and literal spans.
3. Re-run the focused mode on the changed file:
   `deno run -A scripts/check_ste100_comments.ts --focused <path>`.
4. Stage the change; the `--staged` ratchet confirms every new/modified comment line
   complies before commit.

The historical corpus was deliberately left in place (Phase 195 gate-only scope); a
repository-wide migration is out of scope for this gate.

## See also

- `scripts/check_agent_prose.ts` — the companion instruction-prose gate (same rule core).
- `scripts/ste100_prose_rules.ts` — the shared normalization and counting core.
- `CODE_STYLE.md` §16 Comment Discipline — authoring rules this gate enforces.
