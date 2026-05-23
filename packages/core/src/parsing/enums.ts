/**
 * @module CoreParsingPackageEnums
 * @path packages/core/src/parsing/enums.ts
 * @related-files []
 * @architectural-layer Core
 * @description Package-local enums used by @exaix/parsing.
 */

export const ParserActivityActionType = {
  REQUEST_VALIDATED: "request.validated",
  REQUEST_VALIDATION_FAILED: "request.validation_failed",
} as const;

export type ParserActivityActionType = typeof ParserActivityActionType[keyof typeof ParserActivityActionType];
