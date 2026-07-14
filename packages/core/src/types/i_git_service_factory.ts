/**
 * @module IGitServiceFactory
 * @path packages/core/src/types/i_git_service_factory.ts
 * @description Factory interface for creating per-execution IGitService instances.
 * Injected into ExecutionLoop via IExecutionLoopConfig so the concrete
 * GitService class stays in the composition root (apps/daemon/main.ts).
 * @architectural-layer Shared
 * @related-files ["packages/execution/src/execution_loop.ts"]
 */
import type { IGitService } from "./i_git_service.ts";

export interface IGitServiceFactory {
  createGitService(repoPath: string, traceId: string): IGitService;
}
