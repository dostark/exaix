# Changelog

> User-facing changes to Exaix. Each entry includes the date and Exaix version
> (or workspace schema version) when the change shipped.
>
> **Scope:** Only changes that affect how a user interacts with Exaix — CLI flags,
> config fields, env vars, deprecations, new commands, behavior changes.
> Internal refactors, test additions, and code moves do not belong here.
>
> **Format:** follows [Keep a Changelog](https://keepachangelog.com/) conventions
> with categories: Added, Changed, Deprecated, Removed, Fixed, Security.
>
> **Adding an entry:**
>
> 1. Add a new `## [version] — YYYY-MM-DD` section when a release ships.
> 2. During development, add entries under `## Unreleased — Phase <N>`.
> 3. Every entry must be a single sentence, user-facing, no internal file paths.
>    (e.g., write "Model Intent CLI flags" not "packages/ai/src/model_resolver.ts")
> 4. Link to the relevant section in `Exaix_User_Guide.md` for detailed docs.

## Unreleased — Phase 132 (Model Routing)

### Deprecations

- **Hardcoded `model:` in identity blueprints is deprecated.** Replace with
  `model_size:` + `characteristics:` frontmatter fields. See `Exaix_User_Guide.md §6.2`
  for migration guide.

### Added

- Model Intent CLI flags: `--model-size <S|M|L|XL>`, `--thinking`, `--effort`,
  `--characteristic`, `--preferred-provider` on `exactl request`.
- `EXA_MODEL_PRESET_OVERRIDE=test` env var for deterministic model resolution.
- `exactl logs` command — queries the activity journal with event-type shortcuts
  (e.g., `exactl logs --filter model_resolved`).
- ModelResolver — policy-driven model routing (chooses provider+model from capability requirements).
- `model.resolved` log events for tracing which model was chosen and why.
