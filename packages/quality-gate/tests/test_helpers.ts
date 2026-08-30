/**
 * @module QualityGateTestHelpers
 * @path packages/quality-gate/tests/test_helpers.ts
 * @related-files []
 * @architectural-layer Services
 * @description Test helpers for quality-gate tests. Provides factory functions
 * that create minimal implementations of interfaces consumed by quality-gate
 * modules, avoiding imports from root src/services/.
 */

import type { ZodType } from "zod";
import type { IOutputValidator, IValidationResult } from "../src/internal_types.ts";

/** Creates a test validator that performs JSON parsing and Zod validation without repair. */
export function createTestValidator(): IOutputValidator {
  return {
    validate<T>(
      content: string,
      schema: ZodType<T>,
    ): IValidationResult<T> {
      try {
        const parsed = JSON.parse(content);
        const value = schema.parse(parsed);
        return { success: true, value, repairAttempted: false, repairSucceeded: false, raw: content };
      } catch {
        return { success: false, repairAttempted: false, repairSucceeded: false, raw: content };
      }
    },
  };
}
