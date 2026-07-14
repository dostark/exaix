/**
 * @module MilestoneEmitterFactory
 * @path packages/core/src/observability/milestone_emitter_factory.ts
 * @description Builds the composite IMilestoneEmitter (bus streaming + optional
 * journal file) from Config.execution settings (Phase 92). Shared by any caller
 * that constructs a milestone-emitting service (RequestProcessor, AgentRunner)
 * so both sides of a DI boundary build the identical emitter from one Config.
 * @architectural-layer Services
 * @dependencies [@exaix/schemas]
 * @related-files [packages/core/src/observability/composite_milestone_emitter.ts, packages/core/src/observability/file_append_milestone_emitter.ts, packages/core/src/observability/event_bus_service.ts]
 */

import { join } from "@std/path";
import type { Config } from "@exaix/schemas/config.ts";
import { type IMilestoneEmitter, MilestoneEventBusEmitter } from "./milestone_emitter.ts";
import { CompositeMilestoneEmitter } from "./composite_milestone_emitter.ts";
import { FileAppendMilestoneEmitter } from "./file_append_milestone_emitter.ts";
import { EventBusService } from "./event_bus_service.ts";

/** Builds the milestone emitter implied by config.execution, or undefined when neither sink is enabled. */
export function buildMilestoneEmitterFromConfig(config: Config): IMilestoneEmitter | undefined {
  const emitters: IMilestoneEmitter[] = [];
  if (config.execution?.milestone_streaming_enabled) {
    emitters.push(new MilestoneEventBusEmitter(EventBusService.getInstance()));
  }
  if (config.execution?.milestone_journal_path) {
    emitters.push(
      new FileAppendMilestoneEmitter(
        join(config.system.root, config.execution.milestone_journal_path),
      ),
    );
  }
  return emitters.length > 0 ? new CompositeMilestoneEmitter(emitters) : undefined;
}
