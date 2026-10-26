/**
 * @module IGitService
 * @path packages/git/src/i_git_service.ts
 * @related-files []
 * @architectural-layer Services
 * @ungrounded
 * @description Git service interface definitions for @exaix/git.
 */

import type { Config } from "@exaix/schemas";
import type { IEventLogger } from "@exaix/core/logger";

interface IGitServiceContext {
  config?: Config | { get(): Config };
}

export interface IGitServiceConfig {
  config: Config;
  logger?: IEventLogger;
  traceId?: string;
  agentRole?: string;
  repoPath?: string;
  context?: IGitServiceContext;
}

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
