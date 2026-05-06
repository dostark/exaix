---
agent: general
scope: dev
title: "Infrastructure/Config Skill (#infra)"
description: Plan and implement infrastructure or configuration changes with validation and rollback steps
short_summary: "Plan and implement Exaix infra/config changes: TOML schema, Zod validation, PathResolver, CI verification."
version: "1.0"
topics: ["infrastructure", "configuration", "deployment", "setup"]
qwen_skill: infra
---

```text
Key points
- Config lives in exa.config.toml; sections map to Zod schemas in @exaix/core/config/
- Always validate new env vars via Zod: use getValidatedEnvOverrides() for EXA_LLM_* overrides
- All new file paths MUST go through PathResolver / PathSecurity.resolveAndValidate() — never raw concatenation
- Run deno check src/main.ts after any config-schema change to catch type propagation errors early
- Have an explicit rollback path before applying any change to shared config

Canonical prompt (short):
"Implement infrastructure/config change: {goal}.
Update TOML schema + Zod validation, add PathResolver for any new paths,
write tests, run deno check + deno task check:style, document rollback."

Exaix config patterns
  # TOML section → Zod schema → typed config object
  # exa.config.toml
  [quality_gate]
  mode = "hybrid"

  # @exaix/core/config/schemas.ts
  export const QualityGateConfigSchema = z.object({
    mode: z.enum(["heuristic", "llm", "hybrid"]).default("hybrid"),
  });

  # Never use direct Deno.env.get() for EXA_LLM_* without validation
  # ✅ GOOD:
  import { getValidatedEnvOverrides } from "@exaix/core/config/env_schema.ts";
  const overrides = getValidatedEnvOverrides();

  # Supported production env vars (validated, typed):
  # EXA_LLM_PROVIDER  EXA_LLM_MODEL  EXA_LLM_BASE_URL  EXA_LLM_TIMEOUT_MS

  # Test/CI env vars use EXA_TEST_* prefix; use isTestMode() / isCIMode() helpers

Validation checklist
  [ ] deno check src/main.ts              — no type errors from schema changes
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
- CODE_STYLE.md — authoritative naming, type, import, and constants rules
```

## Examples

- `#infra Add new TOML section [llm_cache] with Zod schema and env override`
- `#infra Move hardcoded timeout to exa.config.toml with validated default`
- `#infra Add PathSecurity.resolveAndValidate() for user-supplied log path`
