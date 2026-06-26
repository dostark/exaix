/**
 * @module FileAppendMilestoneEmitter
 * @path packages/core/src/observability/file_append_milestone_emitter.ts
 * @description IMilestoneEmitter implementation that appends milestones as NDJSON lines to a file.
 * Used for E2E test verification and debugging milestone streams (Phase 92).
 * @architectural-layer Services
 * @dependencies [@exaix/schemas]
 * @related-files [packages/core/src/observability/milestone_emitter.ts, tests/integration/flow_milestone_streaming_e2e_test.ts]
 */

import type { IExecutionMilestone } from "@exaix/schemas";
import type { IMilestoneEmitter } from "./milestone_emitter.ts";

export class FileAppendMilestoneEmitter implements IMilestoneEmitter {
  constructor(private readonly filePath: string) {}

  async emit(milestone: IExecutionMilestone): Promise<void> {
    const line = JSON.stringify(milestone) + "\n";
    await Deno.writeTextFile(this.filePath, line, { append: true, create: true });
  }
}
