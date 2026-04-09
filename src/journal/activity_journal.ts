/**
 * @module ActivityJournal
 * @path src/journal/activity_journal.ts
 * @description Audit logging for dynamic step execution, integrating with existing event logger.
 * @architectural-layer Journal
 * * @related-files [src/flows/dynamic_step_executor.ts, src/flows/flow_runner.ts]
 */
import type { IActivityJournal, JournalEntry } from "../flows/dynamic_step_executor.ts";
import type { IFlowEventLogger } from "../flows/flow_runner.ts";

export class ActivityJournal implements IActivityJournal {
  constructor(private readonly eventLogger: IFlowEventLogger) {}

  async log(entry: JournalEntry): Promise<void> {
    const { traceId, stepId, event, ...payload } = entry;

    // Map JournalEntry fields to IFlowEventLogger.log call
    this.eventLogger.log(typeof event === "string" ? event : "dynamic_step_event", {
      traceId: typeof traceId === "string" ? traceId : undefined,
      target: typeof stepId === "string" ? stepId : "dynamic_step",
      ...payload,
    });
    await Promise.resolve();
  }
}
