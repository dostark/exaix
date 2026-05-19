/**
 * @module ValidationTypes
 * @path packages/core/src/types/validation.ts
 * @description Shared validation result types.
 */

export interface IValidationError {
  path: string;
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
  parsed?: T;
}
