/**
 * @module CompositeMilestoneEmitter
 * @path packages/core/src/observability/composite_milestone_emitter.ts
 * @description IMilestoneEmitter implementation that fans out emit() to multiple child emitters.
 * Used when both bus streaming and file journaling are active (Phase 92).
 * @architectural-layer Services
 * @dependencies [@exaix/schemas]
 * @related-files [packages/core/src/observability/milestone_emitter.ts, packages/core/src/observability/file_append_milestone_emitter.ts]
 */

import type { IExecutionMilestone } from "@exaix/schemas";
import type { IMilestoneEmitter } from "./milestone_emitter.ts";

export class CompositeMilestoneEmitter implements IMilestoneEmitter {
  constructor(private readonly emitters: IMilestoneEmitter[]) {}

  async emit(milestone: IExecutionMilestone): Promise<void> {
    await Promise.all(this.emitters.map((e) => e.emit(milestone)));
  }
}
