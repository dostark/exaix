# Changelog

## Unreleased — Phase 132 (Model Routing)

### Deprecations

- **Hardcoded `model:` in identity blueprints is deprecated.** Replace with
  `model_size:` + `characteristics:` frontmatter fields. See `docs/Model_Intent.md`
  for migration guide.

### Added

- Model Intent CLI flags: `--model-size <S|M|L|XL>`, `--thinking`, `--effort`,
  `--characteristic`, `--preferred-provider` on `exactl request`.
- `EXA_MODEL_PRESET_OVERRIDE=test` env var for deterministic model resolution.
- `exactl logs` command — queries the activity journal with event-type shortcuts
  (e.g., `exactl logs --filter model_resolved`).
- `ModelResolver` — policy-driven model resolution service (`packages/ai/src/model_resolver.ts`).
- `model.resolved` trace events for auditability.
