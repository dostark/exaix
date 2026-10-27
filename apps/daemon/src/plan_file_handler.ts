/**
 * @module PlanFileHandler
 * @path apps/daemon/src/plan_file_handler.ts
 * @description Handles a file reported by the Active-plans watcher. A `_plan.md` file is journaled
 *   as detected, run through the plan executor, and its outcome is journaled. Other files are ignored.
 * @architectural-layer Services
 * @dependencies [@exaix/core/events, @exaix/core/logger, @exaix/core/types, @exaix/execution]
 * @related-files [apps/daemon/main.ts, apps/daemon/src/watcher.ts, packages/execution/src/execution_loop.ts]
 */

import { DomainEventType } from "@exaix/core/events";
import type { IEventLogger } from "@exaix/core/logger";
import { type LogMetadata, toSafeJson } from "@exaix/core/types";
import type { IExecutionResult } from "@exaix/execution";
import type { IFileReadyEvent } from "./watcher.ts";

/** Runs one plan to completion. ExecutionLoop implements it. */
export interface IPlanExecutor {
  processTask(planPath: string): Promise<IExecutionResult>;
}

/** Handles one file that the watcher reports as ready. */
interface IPlanFileHandler {
  handle(event: IFileReadyEvent): Promise<void>;
}

/** Filename marker that identifies a plan file among the files in Workspace/Active. */
const PLAN_FILE_MARKER = "_plan.md";

export class PlanFileHandler implements IPlanFileHandler {
  constructor(
    private readonly executor: IPlanExecutor,
    private readonly logger: IEventLogger,
  ) {}

  async handle(event: IFileReadyEvent): Promise<void> {
    if (!event.path.includes(PLAN_FILE_MARKER)) {
      return;
    }

    await this.logger.info(DomainEventType.PlanDetected, event.path, {
      size: event.content.length,
    });

    // The executor parses, validates, runs, and reports the plan. It also manages the lifecycle.
    const result = await this.executor.processTask(event.path);

    if (result.success) {
      await this.logger.info(
        DomainEventType.PlanExecutionManaged,
        event.path,
        toSafeJson({
          trace_id: result.traceId,
          status: "completed",
        }) as LogMetadata,
      );
      return;
    }

    await this.logger.error(
      DomainEventType.PlanExecutionManagedFailure,
      event.path,
      toSafeJson({
        trace_id: result.traceId,
        error: result.error,
      }) as LogMetadata,
    );
  }
}
