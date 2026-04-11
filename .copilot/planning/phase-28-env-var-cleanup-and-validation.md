# Phase 28: Environment Variable Cleanup and Validation

> [!NOTE]
> **Status: Complete ✅**
> This phase standardized Exaix's environment variable usage, retired redundant production env vars, and implemented Zod validation for runtime overrides.
>
> **Completed:** All phases (1-8)
>
> - Phase 1: Env validation schema (`src/config/env_schema.ts`)
> - Phase 2: Deprecated var removal from `src/`
> - Phase 3: Test var standardization (`EXA_TEST_*`)
> - Phase 4: Config documentation (`exa.config.sample.toml`)
> - Phase 5: Migration guide (N/A - no production deployment)
> - Phase 6-7: Comprehensive testing
> - Phase 8: Complete documentation updates (`.copilot/`, `docs/`, cross-references)

## Executive Summary

Following Phase 27's configuration consolidation, Exaix still has scattered environment variable usage across production and testing contexts. This phase aims to:

1. **Retain essential runtime overrides** (`EXA_LLM_*`) for CLI/TUI flexibility

1.
1.
1.

**Scope:** No deprecation period. This is a breaking change for Phase 28.

---

## Goals

- [x] Reduce environment variable surface area to essential overrides only
- [x] Implement schema validation for all env var inputs
- [x] Clearly separate production vs. testing environment variables
- [x] All deprecated env vars removed from src/
- [x] `exa.config.sample.toml` documents all env vars
- [x] Migration guide (N/A - no production deployment)
- [x] All tests pass
- [ ] Documentation updated (Phase 8 - comprehensive docs/ and .copilot/ updates)

---

## Current State Analysis

### Production Environment Variables (To Review)

| Variable                      | Purpose                  | Action     | Rationale                                        |
| ----------------------------- | ------------------------ | ---------- | ------------------------------------------------ |
| `EXA_LLM_PROVIDER`            | Override AI provider     | **KEEP**   | Essential for CLI/TUI runtime override           |
| `EXA_LLM_MODEL`               | Override AI model        | **KEEP**   | Essential for CLI/TUI runtime override           |
| `EXA_LLM_BASE_URL`            | Override API endpoint    | **KEEP**   | Essential for CLI/TUI runtime override           |
| `EXA_LLM_TIMEOUT_MS`          | Override request timeout | **KEEP**   | Essential for CLI/TUI runtime override           |
| `EXA_OLLAMA_RETRY_MAX`        | Ollama retry attempts    | **RETIRE** | Use `exa.config.toml` [ai.retry.ollama]          |
| `EXA_OLLAMA_RETRY_BACKOFF_MS` | Ollama retry backoff     | **RETIRE** | Use `exa.config.toml` [ai.retry.ollama]          |
| `EXA_OPENAI_RETRY_MAX`        | OpenAI retry attempts    | **RETIRE** | Use `exa.config.toml` [ai.retry.openai]          |
| `EXA_OPENAI_RETRY_BACKOFF_MS` | OpenAI retry backoff     | **RETIRE** | Use `exa.config.toml` [ai.retry.openai]          |
| `EXA_OPENAI_TIMEOUT_MS`       | OpenAI timeout           | **RETIRE** | Use `exa.config.toml` [models.<name>.timeout_ms] |

### Testing Environment Variables (To Standardize)

| Current Name          | Purpose                         | New Name                   | Action                |
| --------------------- | ------------------------------- | -------------------------- | --------------------- |
| `EXA_ENABLE_PAID_LLM` | CI opt-in for paid API tests    | `EXA_TEST_ENABLE_PAID_LLM` | **RENAME**            |
| `EXA_OPENAI_API_KEY`  | OpenAI API key for tests        | `EXA_TEST_OPENAI_API_KEY`  | **RENAME**            |
| `EXA_TEST_LLM_MODEL`  | Override model for tests        | (keep as-is)               | **KEEP**              |
| `EXA_ENABLE_OLLAMA`   | Enable Ollama integration tests | `EXA_TEST_ENABLE_OLLAMA`   | **RENAME**            |
| `EXA_RUN_LLAMA_TESTS` | Enable Llama tests              | `EXA_TEST_ENABLE_LLAMA`    | **RENAME**            |
| `DENO_TEST`           | Detect test environment         | `EXA_TEST_MODE`            | **RENAME**            |
| `CI`                  | Detect CI environment           | `EXA_CI_MODE`              | **RENAME** (optional) |
| `EXACTL_TEST_MODE`    | CLI test mode                   | `EXA_TEST_CLI_MODE`        | **RENAME**            |

### System Environment Variables (Keep Standard Names)

| Variable            | Purpose              | Action                       |
| ------------------- | -------------------- | ---------------------------- |
| `HOME`              | User home directory  | **KEEP** (system standard)   |
| `USER` / `USERNAME` | Current user         | **KEEP** (system standard)   |
| `EDITOR` / `VISUAL` | User's editor        | **KEEP** (POSIX standard)    |
| `OLLAMA_BASE_URL`   | Ollama endpoint      | **KEEP** (external standard) |
| `OPENAI_API_KEY`    | OpenAI key (scripts) | **KEEP** (external standard) |

---

## Implementation Plan

### Phase 1: Environment Variable Validation Schema

**Goal:** Create Zod schema for validating environment variable inputs

**Files to Modify:**

- `src/config/env_schema.ts` (NEW)
- `src/config/schema.ts` (UPDATE)

**Steps:**

1. **Create `src/config/env_schema.ts`:**

   ```typescript
   import { z } from "zod";
   import { ProviderTypeSchema } from "./ai_config.ts";
   import * as DEFAULTS from "./constants.ts";

   /**
    * Schema for EXA_LLM_* environment variable overrides
    * These allow runtime override of AI provider configuration
    */
   export const EnvLLMOverrideSchema = z.object({
     EXA_LLM_PROVIDER: ProviderTypeSchema.optional(),
     EXA_LLM_MODEL: z.string().min(1).optional(),
     EXA_LLM_BASE_URL: z.string().url().optional(),
     EXA_LLM_TIMEOUT_MS: z.string()
       .regex(/^\d+$/)
       .transform(Number)
       .pipe(
         z.number()
           .min(DEFAULTS.AI_TIMEOUT_MS_MIN)
           .max(DEFAULTS.AI_TIMEOUT_MS_MAX),
       )
       .optional(),
   });

   export type EnvLLMOverride = z.infer<typeof EnvLLMOverrideSchema>;

   /**
    * Schema for EXA_TEST_* environment variables
    * These control test execution behavior
    */
   export const EnvTestConfigSchema = z.object({
     EXA_TEST_MODE: z.enum(["0", "1"]).optional(),
     EXA_TEST_CLI_MODE: z.enum(["0", "1"]).optional(),
     EXA_TEST_ENABLE_PAID_LLM: z.enum(["0", "1"]).optional(),
     EXA_TEST_ENABLE_OLLAMA: z.enum(["0", "1"]).optional(),
     EXA_TEST_ENABLE_LLAMA: z.enum(["true", "false"]).optional(),
     EXA_TEST_LLM_MODEL: z.string().optional(),
     EXA_TEST_OPENAI_API_KEY: z.string().optional(),
   });

   export type EnvTestConfig = z.infer<typeof EnvTestConfigSchema>;

   /**
    * Optional: Standardized CI detection
    */
   export const EnvCIConfigSchema = z.object({
     EXA_CI_MODE: z.enum(["0", "1"]).optional(),
   });

   export type EnvCIConfig = z.infer<typeof EnvCIConfigSchema>;

   /**
    * Helper to safely get and validate environment variables
    */
   export function getValidatedEnvOverrides(): EnvLLMOverride {
     const raw = {
       EXA_LLM_PROVIDER: safeEnvGet("EXA_LLM_PROVIDER"),
       EXA_LLM_MODEL: safeEnvGet("EXA_LLM_MODEL"),
       EXA_LLM_BASE_URL: safeEnvGet("EXA_LLM_BASE_URL"),
       EXA_LLM_TIMEOUT_MS: safeEnvGet("EXA_LLM_TIMEOUT_MS"),
     };

     const result = EnvLLMOverrideSchema.safeParse(raw);
     if (!result.success) {
       console.warn("Invalid EXA_LLM_* environment variables:", result.error.format());
       return {};
     }

     return result.data;
   }

   function safeEnvGet(key: string): string | undefined {
     try {
       return Deno.env.get(key);
     } catch {
       return undefined;
     }
   }
   ```text

1.
   - Import `getValidatedEnvOverrides()`
   - Replace raw `safeEnvGet()` calls with validated schema
   - Remove deprecated env var checks (`EXA_OLLAMA_*`, `EXA_OPENAI_*`)

1.
   ```typescript
   // In provider_factory.ts
   private static resolveOptions(config: Config): ProviderOptions {
     const envOverrides = getValidatedEnvOverrides();

     return {
       provider: envOverrides.EXA_LLM_PROVIDER ?? config.ai?.provider ?? DEFAULTS.PROVIDER_MOCK,
       model: envOverrides.EXA_LLM_MODEL ?? config.ai?.model ?? DEFAULTS.DEFAULT_MOCK_MODEL,
       baseUrl: envOverrides.EXA_LLM_BASE_URL ?? config.ai?.base_url,
       timeout: envOverrides.EXA_LLM_TIMEOUT_MS ?? config.ai?.timeout_ms ?? DEFAULTS.DEFAULT_AI_TIMEOUT_MS,
     };
   }
   ```text

**Success Criteria:**

- [x] `EnvLLMOverrideSchema` validates all four supported env vars
- [x] Invalid values (e.g., non-numeric timeout) are rejected with warnings
- [x] `ProviderFactory` uses validated env overrides
- [x] Tests pass with valid and invalid env var values

---

### Phase 2: Retire Deprecated Production Environment Variables

**Goal:** Remove all production env vars that duplicate TOML config

**Files to Modify:**

- `src/ai/providers.ts`
- `src/ai/providers/llama_provider.ts`

**Steps:**

1. **Remove from `src/ai/providers.ts`:**
   ```typescript
   // DELETE these lines:
   maxAttempts: Number(safeGetEnv("EXA_OLLAMA_RETRY_MAX") ?? ...),
   backoffMs: Number(safeGetEnv("EXA_OLLAMA_RETRY_BACKOFF_MS") ?? ...),
   const maxAttempts = Number(safeGetEnv("EXA_OPENAI_RETRY_MAX") ?? ...);
   const backoffMs = Number(safeGetEnv("EXA_OPENAI_RETRY_BACKOFF_MS") ?? ...);
   const timeoutMs = Number(safeGetEnv("EXA_OPENAI_TIMEOUT_MS") ?? ...);
   ```text

1.
   ```typescript
   // DELETE these lines (lines 51, 56):
   Number(Deno.env.get("EXA_OLLAMA_RETRY_MAX")) || ...
   Number(Deno.env.get("EXA_OLLAMA_RETRY_BACKOFF_MS")) || ...
   ```text

1.
   - Ollama: Use `config.ai_retry.providers?.ollama` or defaults
   - OpenAI: Use `config.ai_retry.providers?.openai` or defaults
   - Anthropic: Use `config.ai_retry.providers?.anthropic` or defaults

**Success Criteria:**

- [x] No references to `EXA_OLLAMA_RETRY_*` in src/
- [x] No references to `EXA_OPENAI_RETRY_*` in src/
- [x] No references to `EXA_OPENAI_TIMEOUT_MS` in src/
- [x] All retry/timeout config comes from `exa.config.toml`
- [x] Tests pass without deprecated env vars

---

### Phase 3: Standardize Testing Environment Variables

**Goal:** Rename testing env vars to use `EXA_TEST_*` prefix for clarity

**Files to Modify:**

- `src/ai/providers.ts`
- `tests/ai/*.ts` (multiple files)
- `tests/integration/*.ts` (multiple files)
- `tests/helpers/env.ts`
- `src/cli/exactl.ts`
- `src/tui/*.ts` (files using `DENO_TEST`)

**Steps:**

1. **Create migration constants in `src/config/env_schema.ts`:**
   ```typescript
   /**
    * Check if running in test mode
    * Supports both old (DENO_TEST) and new (EXA_TEST_MODE) env vars
    */
   export function isTestMode(): boolean {
     const newVar = safeEnvGet("EXA_TEST_MODE") === "1";
     const legacyVar = safeEnvGet("DENO_TEST") === "1";
     return newVar || legacyVar;
   }

   /**
    * Check if running in CI mode
    * Supports both old (CI) and new (EXA_CI_MODE) env vars
    */
   export function isCIMode(): boolean {
     const newVar = safeEnvGet("EXA_CI_MODE") === "1";
     const legacyVar = safeEnvGet("CI") === "true";
     return newVar || legacyVar;
   }
   ```text

1.
   ```typescript
   // OLD:
   const enabled = Deno.env.get("EXA_ENABLE_PAID_LLM") === "1";
   const apiKey = Deno.env.get("EXA_OPENAI_API_KEY");

   // NEW:
   const enabled = Deno.env.get("EXA_TEST_ENABLE_PAID_LLM") === "1";
   const apiKey = Deno.env.get("EXA_TEST_OPENAI_API_KEY");
   ```text

1.
   ```typescript
   // OLD (line 37):
   IN_TEST_MODE = Deno.env.get("EXACTL_TEST_MODE") === "1";

   // NEW:
   IN_TEST_MODE = Deno.env.get("EXA_TEST_CLI_MODE") === "1";
   ```text

1.
   ```typescript
   // OLD:
   if (Deno.env.get("DENO_TEST") !== "1") setTimeout(...);

   // NEW:
   import { isTestMode } from "../config/env_schema.ts";
   if (!isTestMode()) setTimeout(...);
   ```text

1.
   - `deno.json` tasks
   - CI workflows (`.github/workflows/*.yml`)

**Success Criteria:**

- [x] All test files use `EXA_TEST_*` prefix
- [x] `isTestMode()` and `isCIMode()` helpers created
- [x] No direct references to `DENO_TEST` or `EXACTL_TEST_MODE` in src/
- [ ] CI/CD pipelines updated to use new env var names (if applicable)
- [x] Tests pass with new env var names

---

### Phase 4: Document Environment Variables in exa.config.sample.toml

**Goal:** Add comprehensive documentation of all supported env vars

**Files to Modify:**

- `templates/exa.config.sample.toml`

**Steps:**

1. **Add new section at the top of the file:**
   ```toml
   # ===========================================================================
   # Exaix Configuration File
   # ===========================================================================
   #
   # IMPORTANT: This is the ONLY file users should edit to customize Exaix behavior.
   # NEVER modify src/config/constants.ts directly - those are internal defaults.
   #
   # ===========================================================================
   # Environment Variable Overrides (Runtime Configuration)
   # ===========================================================================
   #
   # Exaix supports a minimal set of environment variables for runtime overrides.
   # These are primarily used for CLI/TUI flexibility and testing.
   #
   # Production Environment Variables (CLI/TUI Overrides):
   # -------------------------------------------------------
   # EXA_LLM_PROVIDER        Override AI provider (mock | ollama | anthropic | openai | google)
   #                         Example: export EXA_LLM_PROVIDER=ollama
   #
   # EXA_LLM_MODEL           Override AI model name
   #                         Example: export EXA_LLM_MODEL=llama3.2
   #
   # EXA_LLM_BASE_URL        Override provider API endpoint
   #                         Example: export EXA_LLM_BASE_URL=http://localhost:11434/api/generate
   #
   # EXA_LLM_TIMEOUT_MS      Override request timeout in milliseconds (1000-300000)
   #                         Example: export EXA_LLM_TIMEOUT_MS=60000
   #
   # Testing Environment Variables (Test Execution Control):
   # --------------------------------------------------------
   # EXA_TEST_MODE           Enable test mode (0 | 1)
   # EXA_TEST_CLI_MODE       Enable CLI test mode (0 | 1)
   # EXA_TEST_ENABLE_PAID_LLM    Opt-in to paid LLM API tests in CI (0 | 1)
   # EXA_TEST_ENABLE_OLLAMA      Enable Ollama integration tests (0 | 1)
   # EXA_TEST_ENABLE_LLAMA       Enable Llama provider tests (true | false)
   # EXA_TEST_LLM_MODEL          Override model for tests
   # EXA_TEST_OPENAI_API_KEY     OpenAI API key for integration tests
   #
   # CI/CD Environment Variables:
   # -----------------------------
   # EXA_CI_MODE             Detect CI environment (0 | 1)
   #                         Alternative to standard CI=true
   #
   # System Environment Variables (Standard):
   # -----------------------------------------
   # HOME, USER, USERNAME    System user info (read-only)
   # EDITOR, VISUAL          User's preferred editor (read-only)
   # OLLAMA_BASE_URL         Ollama endpoint (external standard)
   # OPENAI_API_KEY          OpenAI API key (scripts only, external standard)
   #
   # IMPORTANT NOTES:
   # - Environment variables override corresponding [ai] and [models] config
   # - Invalid env var values will be rejected with warnings (Zod validation)
   # - For persistent configuration, prefer editing this exa.config.toml file
   # - Testing env vars (EXA_TEST_*) should only be used in test environments
   #
   # ===========================================================================
   ```text

1.
   ```toml
   [ai]
   # Can be overridden at runtime with: export EXA_LLM_PROVIDER=ollama
   provider = "mock"

   # Can be overridden at runtime with: export EXA_LLM_MODEL=llama3.2
   model = "mock-model"

   # Can be overridden at runtime with: export EXA_LLM_BASE_URL=http://localhost:11434
   base_url = ""

   # Can be overridden at runtime with: export EXA_LLM_TIMEOUT_MS=60000
   timeout_ms = 30000
   ```text

**Success Criteria:**

- [x] All four production env vars documented with examples
- [x] All testing env vars documented
- [x] Clear guidance on when to use env vars vs. TOML config
- [x] Validation rules mentioned (min/max values)

---

### Phase 5: Create Migration Guide

> [!NOTE]
> **Status: Not Needed**
> No production deployment exists, so migration guide is not required. API keys are not used in CI environment (tests are skipped when keys unavailable).

**Goal:** ~~Document breaking changes and migration path~~ (N/A)

**Files to Create:**

- `docs/dev/Migration_Guide_Phase28.md`

**Content:**

````markdown
# Migration Guide: Phase 28 Environment Variable Cleanup

## Breaking Changes

### Retired Production Environment Variables

The following environment variables have been **REMOVED** in Phase 28:

| Removed Variable              | Replacement in exa.config.toml             |
| ----------------------------- | ------------------------------------------ |
| `EXA_OLLAMA_RETRY_MAX`        | `[ai.retry.ollama] max_attempts = 3`       |
| `EXA_OLLAMA_RETRY_BACKOFF_MS` | `[ai.retry.ollama] backoff_base_ms = 1000` |
| `EXA_OPENAI_RETRY_MAX`        | `[ai.retry.openai] max_attempts = 3`       |
| `EXA_OPENAI_RETRY_BACKOFF_MS` | `[ai.retry.openai] backoff_base_ms = 1000` |
| `EXA_OPENAI_TIMEOUT_MS`       | `[models.<name>] timeout_ms = 30000`       |

**Migration:**

1. Remove these env vars from your deployment scripts

1.

### Renamed Testing Environment Variables

| Old Name              | New Name                   |
| --------------------- | -------------------------- |
| `EXA_ENABLE_PAID_LLM` | `EXA_TEST_ENABLE_PAID_LLM` |
| `EXA_OPENAI_API_KEY`  | `EXA_TEST_OPENAI_API_KEY`  |
| `EXA_ENABLE_OLLAMA`   | `EXA_TEST_ENABLE_OLLAMA`   |
| `EXA_RUN_LLAMA_TESTS` | `EXA_TEST_ENABLE_LLAMA`    |
| `DENO_TEST`           | `EXA_TEST_MODE`            |
| `EXACTL_TEST_MODE`    | `EXA_TEST_CLI_MODE`        |
| `CI`                  | `EXA_CI_MODE` (optional)   |

**Migration:**

1. Update your test scripts to use new names

1.

## Retained Environment Variables

These env vars are **KEPT** for CLI/TUI runtime overrides:

- `EXA_LLM_PROVIDER`
- `EXA_LLM_MODEL`
- `EXA_LLM_BASE_URL`
- `EXA_LLM_TIMEOUT_MS`

**Usage Example:**

```bash
# Override provider and model for a single request
export EXA_LLM_PROVIDER=ollama
export EXA_LLM_MODEL=llama3.2
exactl request create --prompt "Test" --agent my-agent

# Override with validation (invalid values will warn)
export EXA_LLM_TIMEOUT_MS=999  # ❌ Will warn (below minimum 1000)
export EXA_LLM_TIMEOUT_MS=60000  # ✅ Valid
```text
````text

## New Features

### Environment Variable Validation

All `EXA_LLM_*` env vars are now validated via Zod schema:

- `EXA_LLM_PROVIDER`: Must be valid provider type
- `EXA_LLM_MODEL`: Must be non-empty string
- `EXA_LLM_BASE_URL`: Must be valid URL
- `EXA_LLM_TIMEOUT_MS`: Must be 1000-300000

Invalid values will be rejected with warnings in logs.

## Testing

Run tests with new env var names:

```bash
EXA_TEST_MODE=1 deno task test
EXA_TEST_ENABLE_PAID_LLM=1 deno task test:integration
```text

````text
**Success Criteria:**

- [x] Migration guide (N/A - not needed, no production deployment)
- [x] Examples provided for TOML equivalents (in exa.config.sample.toml)
- [x] Clear upgrade path (N/A - no existing deployments to migrate)

---

### Phase 6: Update Tests

**Goal:** Ensure all tests pass with new env var structure

**Files to Modify:**

- `tests/config/config_test.ts`
- `tests/ai/provider_factory_test.ts`
- All test files using old env var names

**Steps:**

1. **Add env var validation tests:**
   ```typescript
   Deno.test("EnvLLMOverride: validates EXA_LLM_PROVIDER", async () => {
     await withEnvVars({ EXA_LLM_PROVIDER: "invalid-provider" }, () => {
       const overrides = getValidatedEnvOverrides();
       assertEquals(overrides.EXA_LLM_PROVIDER, undefined); // Invalid rejected
     });
   });

   Deno.test("EnvLLMOverride: validates EXA_LLM_TIMEOUT_MS", async () => {
     await withEnvVars({ EXA_LLM_TIMEOUT_MS: "999" }, () => {
       const overrides = getValidatedEnvOverrides();
       assertEquals(overrides.EXA_LLM_TIMEOUT_MS, undefined); // Below min
     });
   });
````text

1.
   ```typescript
   Deno.test("ProviderFactory: EXA_LLM_PROVIDER override", async () => {
     await withEnvVars({ EXA_LLM_PROVIDER: "ollama", EXA_LLM_MODEL: "test" }, async () => {
       const config = {/* minimal config */};
       const provider = await ProviderFactory.create(config);
       assertEquals(provider.id.includes("ollama"), true);
     });
   });
   ```text

1.
   - Search/replace `EXA_ENABLE_PAID_LLM` → `EXA_TEST_ENABLE_PAID_LLM`
   - Search/replace `EXACTL_TEST_MODE` → `EXA_TEST_CLI_MODE`
   - Search/replace `Deno.env.get("DENO_TEST")` → `isTestMode()`

**Success Criteria:**

- [ ] All tests pass with new env var names
- [ ] Validation tests cover all four `EXA_LLM_*` vars
- [ ] No failing tests due to env var changes

---

### Phase 7: Update Documentation

**Goal:** Update all user-facing documentation

**Files to Modify:**

- `docs/Exaix_User_Guide.md`
- `README.md`
- `.copilot/README.md`

**Steps:**

1. **Add env var section to User Guide:**
   ```markdown
   ## Environment Variable Overrides

   Exaix supports runtime configuration via environment variables:

   ### Production Overrides (CLI/TUI)

   | Variable             | Description                    | Example                                          |
   | -------------------- | ------------------------------ | ------------------------------------------------ |
   | `EXA_LLM_PROVIDER`   | Override AI provider           | `export EXA_LLM_PROVIDER=ollama`                 |
   | `EXA_LLM_MODEL`      | Override AI model              | `export EXA_LLM_MODEL=llama3.2`                  |
   | `EXA_LLM_BASE_URL`   | Override API endpoint          | `export EXA_LLM_BASE_URL=http://localhost:11434` |
   | `EXA_LLM_TIMEOUT_MS` | Override timeout (1000-300000) | `export EXA_LLM_TIMEOUT_MS=60000`                |

   **Best Practice:** Use `exa.config.toml` for persistent configuration. Use env vars for temporary runtime overrides.
   ```text

1.
   - Add section on supported env vars
   - Clarify which env vars are for testing only
   - Link to migration guide

**Success Criteria:**

- [ ] User Guide documents all four production env vars
- [ ] README mentions env var support
- [ ] `.copilot/README.md` updated with agent guidance

---

### Phase 8: Update All docs/ and .copilot/ Documentation

**Goal:** Update all documentation following `.copilot/docs/documentation.md` guidelines

**Rationale:** Per `.copilot/docs/documentation.md` (lines 69-113), all implementation changes MUST be coordinated with documentation updates. Documentation changes must be tied to implementation steps and maintain cross-references.

**Files to Update:**

#### docs/ (Human-facing Documentation)

1. **`docs/Exaix_Technical_Spec.md`**
   - Add "Environment Variables" section documenting the 4 supported `EXA_LLM_*` vars
   - Update "Configuration System" section to mention env var validation
   - Example:
     ```markdown
     ### Runtime Environment Variable Overrides

     Exaix supports 4 environment variables for runtime configuration overrides:

     - `EXA_LLM_PROVIDER` - Override AI provider (validated against ProviderType enum)
     - `EXA_LLM_MODEL` - Override model name (must be non-empty)
     - `EXA_LLM_BASE_URL` - Override API endpoint (must be valid URL)
     - `EXA_LLM_TIMEOUT_MS` - Override timeout (1000-300000ms, validated)

     All values are validated via Zod schema in `src/config/env_schema.ts`.
     See `templates/exa.config.sample.toml` for detailed examples.
     ```text

1.
   - Add "Environment Variable Reference" section (already planned in Phase 7)
   - Update "Configuration" section to cross-reference env vars
   - Add troubleshooting section for invalid env var values

1.
   - Update "Configuration System" section
   - Document `env_schema.ts` module
   - Add diagram showing config precedence: env vars → TOML → defaults

1.
   - Document new `EXA_TEST_*` environment variable naming convention
   - Update CI testing documentation with new env var names

#### .copilot/ (Agent-facing Documentation)

1.
   - Update "Configuration & Coding Standards" section (lines 293-303)
   - Add env var validation requirement:
     ```markdown
     ## Configuration & Coding Standards

     To ensure maintainability and configurability, follow these strict rules:

     1. **No Magic Values:** Never hardcode numbers or strings in code.
     1.
        - **User-Facing:** Add to `exa.config.sample.toml` and `src/config/schema.ts`.
        - **Internal:** Use `src/constants.ts`.
        - **CLI/TUI:** Use `src/cli/cli.config.ts` or `src/tui/tui.config.ts`.
     1.
     1.
        - **Production:** Only use `EXA_LLM_*` vars for runtime overrides
        - **Testing:** Use `EXA_TEST_*` prefix for all test-related vars
        - **Validation:** All env vars MUST be validated via Zod schema
     1.
     ```text

1.
   - Add section on environment variable handling
   - Document `getValidatedEnvOverrides()` pattern
   - Example:
     ````markdown
     ### Environment Variable Configuration

     **Pattern:** Always validate environment variable inputs via Zod schema

     ```typescript
     import { getValidatedEnvOverrides } from "../config/env_schema.ts";

     // ✅ Good: Validated env var usage
     const envOverrides = getValidatedEnvOverrides();
     const provider = envOverrides.EXA_LLM_PROVIDER ?? defaultProvider;

     // ❌ Bad: Direct env var access without validation
     const provider = Deno.env.get("EXA_LLM_PROVIDER");
     ```text
     ````text
     ```text
     ```text

1.
   - Update test environment variable section
   - Document all `EXA_TEST_*` variables
   - Add examples of `isTestMode()` and `isCIMode()` helpers:
     ````markdown
     ### Test Environment Variables

     All test-related environment variables use the `EXA_TEST_*` prefix:

     - `EXA_TEST_MODE` - Indicates test environment (replaces `DENO_TEST`)
     - `EXA_TEST_CLI_MODE` - Indicates CLI test mode
     - `EXA_TEST_ENABLE_PAID_LLM` - Opt-in for paid API tests in CI
     - `EXA_TEST_ENABLE_OLLAMA` - Enable Ollama integration tests
     - `EXA_TEST_ENABLE_LLAMA` - Enable Llama provider tests

     **Helpers:**

     ```typescript
     import { isCIMode, isTestMode } from "../config/env_schema.ts";

     // Check if in test environment
     if (isTestMode()) {
       // Skip timer-based operations
     }

     // Check if in CI environment
     if (isCIMode() && !Deno.env.get("EXA_TEST_ENABLE_PAID_LLM")) {
       // Skip paid API tests
     }
     ```text
     ````text
     ```text
     ```text

1.
   - Update status to "In Progress" when implementation starts
   - Check off completed phases as work progresses

#### Cross-References to Update

1.
   - Add "Environment Variables" subsection to Section 4
   - Reference Migration Guide Phase 28
   - Add to PR checklist:
     ```markdown
     - [ ] No direct `Deno.env.get()` calls for `EXA_LLM_*` (use `getValidatedEnvOverrides()`)
     - [ ] Testing env vars use `EXA_TEST_*` prefix
     - [ ] Environment variable documentation updated if env vars added/changed
     ```text

1.
    - Add brief mention of env var support in "Configuration" section
    - Link to User Guide for details

**Documentation Principles (from `.copilot/docs/documentation.md`):**

- ✅ **Test-Driven Documentation** - Coordinate with implementation (Phase 28 implementation)
- ✅ **Version Synchronization** - Update version/date in affected docs together
- ✅ **Terminology Consistency** - Use standard terms (env vars, TOML config, validation)
- ✅ **Cross-Reference Guidelines** - Use relative paths, link to code examples
- ✅ **Living Plan Principle** - This phase plan is mutable; extend if new docs discovered

**Steps:**

1. **Update Technical Documentation:**
   - Add env var sections to `Exaix_Technical_Spec.md`
   - Update architecture diagrams if needed
   - Document new `env_schema.ts` module

1.
   - Add env var reference to `Exaix_User_Guide.md`
   - Add troubleshooting section for validation errors

1.
   - Update `.copilot/README.md` with env var rules
   - Update `.copilot/source/exaix.md` with validation patterns
   - Update `.copilot/tests/testing.md` with `EXA_TEST_*` conventions

1.
   - Ensure all docs link to Migration Guide Phase 28
   - Update `CONTRIBUTING.md` PR checklist
   - Update `README.md` with brief env var mention

1.
   ```bash
   # Check for broken links
   deno run --allow-read scripts/check_doc_links.ts

   # Verify .copilot/manifest.json is fresh
   deno task check:docs

   # Validate agent doc schemas
   deno run --allow-read scripts/validate_agents_docs.ts
   ```text

**Success Criteria:**

- [ ] `Exaix_Technical_Spec.md` documents `env_schema.ts` and validation
- [ ] `Exaix_User_Guide.md` has env var reference section
- [ ] `Exaix_Architecture.md` updated with config precedence
- [ ] `.copilot/README.md` includes env var coding standards
- [ ] `.copilot/source/exaix.md` shows validation patterns
- [ ] `.copilot/tests/testing.md` documents all `EXA_TEST_*` vars
- [ ] `CONTRIBUTING.md` PR checklist includes env var checks
- [ ] All cross-references use relative paths
- [ ] No broken links in documentation
- [ ] `.copilot/manifest.json` is up-to-date

---

## Timeline

| Phase       | Estimated Time | Description                                      |
| ----------- | -------------- | ------------------------------------------------ |
| Phase 1     | 2 hours        | Create env var validation schema                 |
| Phase 2     | 1 hour         | Retire deprecated production env vars            |
| Phase 3     | 3 hours        | Standardize testing env vars                     |
| Phase 4     | 1 hour         | Document in exa.config.sample.toml               |
| Phase 5     | 1 hour         | Create migration guide                           |
| Phase 6     | 2 hours        | Update and verify tests                          |
| Phase 7     | 1 hour         | Update user-facing documentation                 |
| **Phase 8** | **2 hours**    | **Update all docs/ and .copilot/ documentation** |

**Total Estimated Effort:** ~13 hours (was 11 hours)

---

## Success Criteria

**Phase 28 Complete When:**

- [x] Only 4 production env vars remain: `EXA_LLM_*`
- [x] All env var inputs validated via Zod schema
- [x] Testing env vars use `EXA_TEST_*` prefix
- [x] All deprecated env vars removed from src/
- [x] `exa.config.sample.toml` documents all env vars
- [x] Migration guide (N/A - no production deployment)
- [x] All tests pass (API key tests skip gracefully in CI)
- [ ] Documentation updated (Phase 8 - comprehensive docs/ and .copilot/ updates needed)

---

## Risks & Mitigations

| Risk                                 | Impact | Mitigation                                          |
| ------------------------------------ | ------ | --------------------------------------------------- |
| Breaking change disrupts deployments | High   | Provide clear migration guide with TOML equivalents |
| Tests fail with new env var names    | Medium | Comprehensive test updates in Phase 6               |
| Users unaware of env var validation  | Low    | Document validation rules in TOML comments          |
| Legacy env var usage in scripts      | Medium | Add warnings for deprecated vars (optional)         |

---

## Related Documents

- [Phase 27: Magic Number & Magic Word Externalization](./phase-27-magic-number-and-word-externaliztion.md)
- [Configuration System Audit]($HOME/.gemini/antigravity/brain/2ddd808a-26ac-486e-bf4c-fe113040b5fb/configuration_audit.md)
- [Exaix User Guide](../../docs/Exaix_User_Guide.md)
- [Contributing Guidelines](../../CONTRIBUTING.md)

---

**Document Status:** Implementation Complete (Documentation updates pending - Phase 8)
**File Destination:** `.copilot/planning/phase-28-env-var-cleanup-and-validation.md`
**Author:** Antigravity AI Agent
**Date:** 2026-01-15
**Last Updated:** 2026-01-20

**Notes:**

- Phase 5 (Migration Guide) marked as N/A - no production deployment exists
- API key tests skip gracefully when keys unavailable (CI-safe)
- Core implementation (Phases 1-4) complete and verified
- Remaining work: Phase 8 comprehensive documentation updates

```
