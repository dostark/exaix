/**
 * @module EnvSchema
 * @path src/config/env_schema.ts
 * @description Provides Zod validation for environment variable overrides (EXA_LLM_*), allowing runtime configuration of AI providers and test modes.
 * @architectural-layer Config
 * * @related-files [src/config/service.ts]
 */

import { z } from "zod";
import type { ProviderType } from "../shared/enums.ts";
import { ProviderTypeSchema } from "../shared/schemas/ai_config.ts";
import { AI_TIMEOUT_MS_MAX, AI_TIMEOUT_MS_MIN, KNOWN_PROVIDERS } from "../shared/constants.ts";

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
        .min(AI_TIMEOUT_MS_MIN)
        .max(AI_TIMEOUT_MS_MAX),
    )
    .optional(),
});

export type EnvLLMOverride = z.infer<typeof EnvLLMOverrideSchema>;

/**
 * Helper to safely get and validate environment variables
 *
 * @returns Validated environment variable overrides (empty object if none set or all invalid)
 */
export function getValidatedEnvOverrides(): EnvLLMOverride {
  const raw = {
    EXA_LLM_PROVIDER: safeEnvGet("EXA_LLM_PROVIDER"),
    EXA_LLM_MODEL: safeEnvGet("EXA_LLM_MODEL"),
    EXA_LLM_BASE_URL: safeEnvGet("EXA_LLM_BASE_URL"),
    EXA_LLM_TIMEOUT_MS: safeEnvGet("EXA_LLM_TIMEOUT_MS"),
  };

  // Validate each field individually to handle partial failures
  const result: Partial<EnvLLMOverride> = {};

  // Validate provider
  if (raw.EXA_LLM_PROVIDER) {
    const providerResult = ProviderTypeSchema.safeParse(raw.EXA_LLM_PROVIDER);
    if (providerResult.success) {
      // Additional validation: check against known providers
      const _normalized = raw.EXA_LLM_PROVIDER.toLowerCase().trim();
      if (KNOWN_PROVIDERS.includes(providerResult.data as ProviderType)) {
        result.EXA_LLM_PROVIDER = providerResult.data as ProviderType;
      } else {
        console.warn(`Invalid EXA_LLM_PROVIDER: "${raw.EXA_LLM_PROVIDER}" is not a known provider`);
      }
    }
  }

  // Validate model
  if (raw.EXA_LLM_MODEL) {
    const modelResult = z.string().min(1).safeParse(raw.EXA_LLM_MODEL);
    if (modelResult.success) {
      result.EXA_LLM_MODEL = modelResult.data;
    } else {
      console.warn(`Invalid EXA_LLM_MODEL: ${modelResult.error.message}`);
    }
  }

  // Validate base URL
  if (raw.EXA_LLM_BASE_URL) {
    const urlResult = z.string().url().safeParse(raw.EXA_LLM_BASE_URL);
    if (urlResult.success) {
      result.EXA_LLM_BASE_URL = urlResult.data;
    } else {
      console.warn(`Invalid EXA_LLM_BASE_URL: ${urlResult.error.message}`);
    }
  }

  // Validate timeout
  if (raw.EXA_LLM_TIMEOUT_MS) {
    const timeoutSchema = z.string()
      .regex(/^\d+$/)
      .transform(Number)
      .pipe(
        z.number()
          .min(AI_TIMEOUT_MS_MIN)
          .max(AI_TIMEOUT_MS_MAX),
      );
    const timeoutResult = timeoutSchema.safeParse(raw.EXA_LLM_TIMEOUT_MS);
    if (timeoutResult.success) {
      result.EXA_LLM_TIMEOUT_MS = timeoutResult.data;
    } else {
      console.warn(`Invalid EXA_LLM_TIMEOUT_MS: ${timeoutResult.error.message}`);
    }
  }

  return result as EnvLLMOverride;
}

/**
 * Safe environment getter that returns undefined when env access is not permitted
 *
 * @param key - Environment variable name
 * @returns Value or undefined if not set or access denied
 */
function safeEnvGet(key: string): string | undefined {
  try {
    return Deno.env.get(key);
  } catch {
    // Deno will throw NotCapable when env access is not allowed in the runtime.
    // Swallow that and return undefined so callers can fall back to defaults.
    return undefined;
  }
}

/**
 * Helper to check if a value represents a truthy boolean
 *
 * @param value - String value to check
 * @returns True if value represents a truthy boolean
 */
function isTruthyValue(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.toLowerCase().trim();
  return normalized !== "0" && normalized !== "false" && normalized !== "no" && normalized !== "off";
}

/**
 * Check if code is running in test mode
 *
 * @returns True if EXA_TEST_MODE or EXA_TEST_CLI_MODE is set to a truthy value
 */
export function isTestMode(): boolean {
  // Check EXA_TEST_MODE first (general test mode)
  if (isTruthyValue(safeEnvGet("EXA_TEST_MODE"))) {
    return true;
  }

  // Also check EXA_TEST_CLI_MODE (CLI-specific test mode)
  return safeEnvGet("EXA_TEST_CLI_MODE") === "1";
}

/**
 * Check if code is running in CI mode
 * Checks both EXA_CI_MODE (preferred) and CI (standard) environment variables
 *
 * @returns True if EXA_CI_MODE or CI is set to a truthy value
 */
export function isCIMode(): boolean {
  // Prefer EXA_CI_MODE if set (more explicit)
  const exaCiMode = safeEnvGet("EXA_CI_MODE");
  if (exaCiMode !== undefined) {
    return isTruthyValue(exaCiMode);
  }

  // Fall back to standard CI env var
  return isTruthyValue(safeEnvGet("CI"));
}
