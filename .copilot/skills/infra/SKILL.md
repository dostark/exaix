---
name: infra
agent: general
tools:
  - read_file
  - write_file
  - patch_file
  - search_files
  - run_command
scope: dev
title: "Infrastructure/Config Skill (#infra)"
description: Plan and implement infrastructure or configuration changes with validation and rollback steps
short_summary: "Plan and implement Exaix infra/config changes: TOML schema, Zod validation, PathResolver, CI verification."
version: "1.0.0"
topics: ["infrastructure", "configuration", "deployment", "setup"]
qwen_skill: infra
---

```text
Key points
- Config DB (.exa/config.db) is the canonical store; TOML (exa.config.toml) is bootstrap-only (system.root)
- Tunable DEFAULT_* constants use `configurable()` from `@exaix/core/config` — override via `exactl config set`
- Always validate new env vars via Zod: use getValidatedEnvOverrides() for EXA_LLM_* overrides
- All new file paths MUST go through PathResolver / PathSecurity.resolveAndValidate() — never raw concatenation
- Run deno check packages/ apps/ tests/ after any config-schema change to catch type propagation errors early
- Have an explicit rollback path before applying any change to shared config

Canonical prompt (short):
"Implement infrastructure/config change: {goal}.
Register new configurable() key + add Zod validation, add PathResolver for any new paths,
write tests, run deno check + deno task check:style, document rollback."

Exaix config patterns
  # configurable() registry → Config DB → exactl config set
  # packages/core/src/types/constants.ts
  export const MY_SETTING: number = configurable({
    key: "my.setting",
    default: 42,
    type: ConfigValueType.NUMBER,
    description: "Description of the setting",
    min: 1,
    max: 100,
    swap: SwapClass.RESTART,
  });

  # Override at runtime:
  exactl config set my.setting 50

  # Never use direct Deno.env.get() for EXA_LLM_* without validation
  # ✅ GOOD:
  import { getValidatedEnvOverrides } from "@exaix/core/config/env_schema.ts";
  const overrides = getValidatedEnvOverrides();

  # Supported production env vars (validated, typed):
  # EXA_LLM_PROVIDER  EXA_LLM_MODEL  EXA_LLM_BASE_URL  EXA_LLM_TIMEOUT_MS

  # Test/CI env vars use EXA_TEST_* prefix; use isTestMode() / isCIMode() helpers

Validation checklist
  [ ] deno check packages/ apps/ tests/   — no type errors from schema changes
  [ ] deno lint                           — no lint issues
  [ ] deno task check:style               — no style violations
  [ ] deno test --allow-all <test-file>   — config tests pass
  [ ] Rollback documented (revert TOML + schema, re-run deno check)

For submodule config changes
  See .copilot/skills/submodule-workflow/SKILL.md for safe handling of exaix-dev-docs changes.

Do / Don't
- ✅ Do add a Zod schema for every new TOML section
- ✅ Do use PathSecurity.resolveAndValidate() for any new configurable path
- ✅ Do use getValidatedEnvOverrides() for EXA_LLM_* env vars
- ✅ Do document the rollback steps before applying
- ❌ Don't use Deno.env.get("EXA_LLM_*") without validation
- ❌ Don't add raw numeric/string defaults in TOML without corresponding Zod defaults
- ❌ Don't skip deno check after schema changes — type errors cascade silently

Related
- [CODE_STYLE.md](../../../CODE_STYLE.md) — authoritative naming, type, import, and constants rules
```

## Output Format

1. **Change summary** — what config or infra was added/changed, with rollback path.
1. **Validation results** — `deno check`, `deno lint`, `check:style`, config tests.
1. **Submodule handling** — if any exaix-dev-docs changes were needed.
1. **CI gate results** — all gates passing.
1. **Commit payload** — use `#commit` for the structured commit message.

## Examples

- `#infra Add new TOML section [llm_cache] with Zod schema and env override`
- `#infra Move hardcoded timeout to exa.config.toml with validated default`

---
exaix:
  skill_id: infra
  triggers:
    keywords: [infra, infrastructure, config, configuration, ci, pipeline, toml]
    task_types: [feature, chore]
    tags: [infrastructure, configuration]
  constraints:
    - "All new config values must have Zod schema validation"
    - "Include rollback steps in the implementation plan"
    - "Use exa.config.toml for runtime configuration — not hardcoded values"
    - "Validate path security for any user-supplied paths"
    - "Test both the change and the rollback procedure"
  output_requirements:
    - "Infrastructure change applied with validation"
    - "Rollback plan documented and tested"
    - "New config values validated via Zod schema"
    - "CI pipeline updated if applicable"
  quality_criteria:
    - name: validation_coverage
      description: All new config values have Zod schema guards
      weight: 40
    - name: rollback_readiness
      description: Rollback procedure documented and tested
      weight: 30
    - name: security_check
      description: Path security applied for user-supplied paths
      weight: 30
---

- `#infra Add PathSecurity.resolveAndValidate() for user-supplied log path`
