/**
 * @module FlowCheckpointService
 * @path src/services/flow/flow_checkpoint_service.ts
 * @description Persistence service for FlowRunner step checkpoints under Memory/Execution/{traceId}/checkpoint.json.
 * @architectural-layer Services
 * @related-files [src/flows/flow_runner.ts, src/shared/schemas/flow.ts]
 */

import { ensureDir, exists } from "@std/fs";
import { dirname, join } from "@std/path";
import { FLOW_CHECKPOINT_SCHEMA_VERSION } from "../../shared/constants.ts";
import type { Config } from "../../shared/schemas/config.ts";
import type { IFlowCheckpoint, IFlowStepResultSnapshot } from "../../shared/schemas/flow.ts";
import { ZFlowCheckpoint } from "../../shared/schemas/flow.ts";

export interface IFlowCheckpointService {
  getCheckpointPath(traceId: string): string;
  save(
    traceId: string,
    flowContentHash: string,
    completedSteps: Record<string, IFlowStepResultSnapshot>,
  ): Promise<IFlowCheckpoint>;
  load(traceId: string): Promise<IFlowCheckpoint | null>;
  delete(traceId: string): Promise<void>;
}

const CHECKPOINT_FILE_NAME = "checkpoint.json";

export class FlowCheckpointService implements IFlowCheckpointService {
  constructor(private readonly config: Config) {}

  getCheckpointPath(traceId: string): string {
    const executionRoot = this.config.paths.memoryExecution.includes("/")
      ? this.config.paths.memoryExecution
      : join(this.config.paths.memory, this.config.paths.memoryExecution);

    return join(
      this.config.system.root,
      executionRoot,
      traceId,
      CHECKPOINT_FILE_NAME,
    );
  }

  async save(
    traceId: string,
    flowContentHash: string,
    completedSteps: Record<string, IFlowStepResultSnapshot>,
  ): Promise<IFlowCheckpoint> {
    const checkpointPath = this.getCheckpointPath(traceId);
    await ensureDir(dirname(checkpointPath));

    const checkpoint = ZFlowCheckpoint.parse({
      traceId,
      flowContentHash,
      schemaVersion: FLOW_CHECKPOINT_SCHEMA_VERSION,
      completedSteps,
      savedAt: new Date().toISOString(),
    });

    await Deno.writeTextFile(checkpointPath, JSON.stringify(checkpoint, null, 2));
    return checkpoint;
  }

  async load(traceId: string): Promise<IFlowCheckpoint | null> {
    const checkpointPath = this.getCheckpointPath(traceId);
    if (!(await exists(checkpointPath))) {
      return null;
    }

    const raw = await Deno.readTextFile(checkpointPath);
    return ZFlowCheckpoint.parse(JSON.parse(raw));
  }

  async delete(traceId: string): Promise<void> {
    const checkpointPath = this.getCheckpointPath(traceId);
    if (!(await exists(checkpointPath))) {
      return;
    }
    await Deno.remove(checkpointPath);
  }
}
