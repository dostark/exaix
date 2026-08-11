/**
 * @module QualityGateInternalTypes
 * @path packages/quality-gate/src/internal_types.ts
 * @related-files []
 * @architectural-layer Services
 * @description Minimal output-validator contract consumed by quality-gate modules.
 * The concrete OutputValidator from src/services/tool/ satisfies this interface
 * structurally, allowing the quality-gate package to avoid importing from src/services/.
 * Types are defined locally (not pulled from @exaix/core/types) because the real
 * OutputValidator uses `path: string[]` on IValidationError while the core type uses
 * `path: string`, making them structurally incompatible as a TypeScript interface.
 */

import type { ZodType } from "zod";

// Local validation-error type matching OutputValidator's real return shape.
export interface IValidationError {
  path: string[];
  message: string;
  code: string;
  expected?: string;
  received?: string;
}

export interface IValidationResult<T = unknown> {
  success: boolean;
  value?: T;
  errors?: IValidationError[];
  repairAttempted: boolean;
  repairSucceeded: boolean;
  raw: string;
}

export interface IOutputValidator {
  validate<T>(
    content: string,
    schema: ZodType<T>,
  ): IValidationResult<T>;
}
