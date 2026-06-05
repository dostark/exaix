/**
 * @module TriggerIngestionService
 * @path packages/triggers/services/ingestion_service.ts
 * @architectural-layer Triggers
 * @dependencies ["@exaix/core/triggers", "@exaix/core/logger", "@exaix/core/events", "@exaix/flow"]
 * @related-files []
 * @ungrounded
 * @description Orchestrates trigger ingestion: validates via policy gate, dispatches
 * start_flow (writes .md file to Workspace/Requests/) or resume_flow (transitions
 * wait state), emits typed TriggerIngested/TriggerAccepted/TriggerRejected events.
 */

import { join } from "@std/path";
import { ensureDir } from "@std/fs";
import type {
  ExecutionTriggerEnvelope,
  IIdempotencyLedger,
  ITriggerDispatchResult,
  ITriggerIngestionService,
  ITriggerPolicyGate,
} from "@exaix/core/triggers";
import type { IEventLogger } from "@exaix/core/logger";
import { DomainEventType } from "@exaix/core/events";
import type { IWaitStateService } from "@exaix/flow/wait_states/wait_state_service.ts";
import { TriggerDisposition } from "@exaix/core/types";

export interface ITriggerIngestionConfig {
  policyGate: ITriggerPolicyGate;
  eventLogger: IEventLogger;
  requestsDir: string;
  idempotencyLedger: IIdempotencyLedger;
  waitStateService?: IWaitStateService;
}

export class TriggerIngestionService implements ITriggerIngestionService {
  constructor(private readonly config: ITriggerIngestionConfig) {}

  async ingest(trigger: ExecutionTriggerEnvelope): Promise<ITriggerDispatchResult> {
    // 1. Emit TriggerIngested
    await this.config.eventLogger.info(
      DomainEventType.TriggerIngested,
      trigger.subject,
      { triggerId: trigger.triggerId, source: trigger.source, action: trigger.action },
    );

    // 2. Evaluate policy gate
    const decision = await this.config.policyGate.evaluate(trigger);
    if (!decision.accepted) {
      await this.config.eventLogger.info(
        DomainEventType.TriggerRejected,
        trigger.subject,
        { triggerId: trigger.triggerId, rejectionReason: decision.rejectionReason },
      );
      return {
        triggerId: trigger.triggerId,
        accepted: false,
        disposition: TriggerDisposition.REJECTED,
      };
    }

    // 3. Record idempotency key
    await this.config.idempotencyLedger.record(trigger.idempotencyKey, trigger.triggerId, true);

    // 4. Dispatch based on action
    if (trigger.action === "start_flow") {
      return await this.dispatchStartFlow(trigger);
    }
    if (trigger.action === "resume_flow") {
      return await this.dispatchResumeFlow(trigger);
    }
    if (trigger.action === "append_signal") {
      return await this.dispatchAppendSignal(trigger);
    }

    // Unknown action — reject
    return {
      triggerId: trigger.triggerId,
      accepted: false,
      disposition: TriggerDisposition.REJECTED,
    };
  }

  private async dispatchStartFlow(trigger: ExecutionTriggerEnvelope): Promise<ITriggerDispatchResult> {
    await ensureDir(this.config.requestsDir);

    const requestId = `trigger-${trigger.triggerId}`;
    const filePath = join(this.config.requestsDir, `${requestId}.md`);

    const frontmatter = [
      "---",
      `trigger_id: ${trigger.triggerId}`,
      `source: ${trigger.source}`,
      `action: start_flow`,
      `subject: ${trigger.subject}`,
      `idempotency_key: ${trigger.idempotencyKey}`,
      trigger.traceId ? `trace_id: ${trigger.traceId}` : null,
      "---",
      "",
      trigger.subject,
      "",
    ].filter(Boolean).join("\n");

    await Deno.writeTextFile(filePath, frontmatter);

    await this.config.eventLogger.info(
      DomainEventType.TriggerAccepted,
      trigger.subject,
      { triggerId: trigger.triggerId, requestId, disposition: "started" },
    );

    return {
      triggerId: trigger.triggerId,
      accepted: true,
      resultingRequestId: requestId,
      disposition: TriggerDisposition.STARTED,
    };
  }

  private async dispatchResumeFlow(trigger: ExecutionTriggerEnvelope): Promise<ITriggerDispatchResult> {
    if (!this.config.waitStateService || !trigger.targetFlowId) {
      return {
        triggerId: trigger.triggerId,
        accepted: false,
        disposition: TriggerDisposition.REJECTED,
      };
    }

    const waitState = await this.config.waitStateService.getByToken(trigger.targetFlowId);
    if (!waitState) {
      return {
        triggerId: trigger.triggerId,
        accepted: false,
        disposition: TriggerDisposition.REJECTED,
      };
    }

    await this.config.waitStateService.transition({
      waitStateId: waitState.waitStateId,
      action: "resume",
      resumeToken: trigger.targetFlowId,
    });

    await this.config.eventLogger.info(
      DomainEventType.TriggerAccepted,
      trigger.subject,
      { triggerId: trigger.triggerId, waitStateId: waitState.waitStateId, disposition: "resumed" },
    );

    return {
      triggerId: trigger.triggerId,
      accepted: true,
      disposition: TriggerDisposition.RESUMED,
    };
  }

  private dispatchAppendSignal(_trigger: ExecutionTriggerEnvelope): Promise<ITriggerDispatchResult> {
    return Promise.resolve({
      triggerId: _trigger.triggerId,
      accepted: true,
      disposition: TriggerDisposition.QUEUED,
    });
  }
}
