/**
 * @module RequestProcessingTypesShim
 * @path src/services/request_processing/types.ts
 * @description Compatibility shim for request frontmatter contracts now owned by @exaix/core.
 * @architectural-layer Services
 * @related-files ["packages/core/src/request/request_frontmatter.ts"]
 */

import type {
  IRequestFrontmatter as CoreRequestFrontmatter,
  ParsedRequestFile as CoreParsedRequestFile,
} from "@exaix/core/request";

export type IRequestFrontmatter = CoreRequestFrontmatter;
export type ParsedRequestFile = CoreParsedRequestFile;
