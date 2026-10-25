/**
 * @module UnslopCheckError
 * @path packages/execution/src/unslop_check_error.ts
 * @description Categorical failures crossing the portal verification helper boundaries.
 * @architectural-layer Services
 * @dependencies [@exaix/schemas]
 * @related-files [packages/execution/src/unslop_check_runner.ts]
 */

import type { UnslopErrorClass } from "@exaix/schemas";

/** Carries only a validated fixed error category. */
export class UnslopCheckError extends Error {
  constructor(readonly errorClass: UnslopErrorClass) {
    super(errorClass);
    this.name = "UnslopCheckError";
  }
}
