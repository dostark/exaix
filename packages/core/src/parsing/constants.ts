/**
 * @module CoreParsingPackageConstants
 * @path packages/core/src/parsing/constants.ts
 * @description Package-local constants used by @exaix/parsing.
 */

export const FRONTMATTER_DELIMITER = "---" as const;
export const FRONTMATTER_REGEX = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;
