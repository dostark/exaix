/**
 * @module CliConfirmationInterceptor
 * @path src/services/tool/cli_confirmation_interceptor.ts
 * @description Synchronous Phase 79 confirmation adapter that prompts on the CLI
 * and resolves approval or denial in-process.
 * @architectural-layer Services
 * @related-files [src/flows/dynamic_step_executor.ts, packages/core/src/types/tool_confirmation_interceptor.ts]
 */

import { TextLineStream } from "@std/streams";
import {
  DEFAULT_TOOL_CONFIRMATION_TIMEOUT_S,
  TOOL_CONFIRMATION_DECIDED_BY_TIMEOUT,
  TOOL_CONFIRMATION_EVENT_APPROVED,
  TOOL_CONFIRMATION_EVENT_DENIED,
} from "@exaix/core";
import { isTestMode } from "@exaix/core/config";
import type { IToolConfirmationInterceptor } from "@exaix/core/types";
import type { ToolConfirmationDecision, ToolConfirmationRequest } from "@exaix/schemas/tool_confirmation.ts";
import type { IActivityJournal } from "../../flows/dynamic_step_executor.ts";

const USER_DECLINED_REASON = "User declined";
const TIMEOUT_REASON = "TIMEOUT";

export class CliConfirmationInterceptor implements IToolConfirmationInterceptor {
  readonly timeoutMs: number;
  private readonly readerFn: () => Promise<string | null>;

  constructor(
    private readonly activityJournal: IActivityJournal,
    timeoutMs = DEFAULT_TOOL_CONFIRMATION_TIMEOUT_S * 1000,
    readerFn?: () => Promise<string | null>,
  ) {
    this.timeoutMs = timeoutMs;
    this.readerFn = readerFn ?? defaultReaderFn;
  }

  async requestApproval(request: ToolConfirmationRequest): Promise<ToolConfirmationDecision> {
    this.printPrompt(request);

    const decision = await this.awaitDecision(request);

    await this.activityJournal.log({
      traceId: request.traceId,
      stepId: request.stepId,
      event: decision.approved ? TOOL_CONFIRMATION_EVENT_APPROVED : TOOL_CONFIRMATION_EVENT_DENIED,
      tool: request.toolName,
      confirmationId: request.id,
      ...(decision.reason !== undefined ? { reason: decision.reason } : {}),
      ...(decision.decidedBy !== undefined ? { decidedBy: decision.decidedBy } : {}),
    });

    return decision;
  }

  private async awaitDecision(request: ToolConfirmationRequest): Promise<ToolConfirmationDecision> {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const input = await Promise.race<string | null | typeof TIMEOUT_SENTINEL>([
      this.readerFn(),
      new Promise<typeof TIMEOUT_SENTINEL>((resolve) => {
        timeoutId = setTimeout(() => resolve(TIMEOUT_SENTINEL), this.timeoutMs);
      }),
    ]);

    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }

    const decidedAt = new Date().toISOString();

    if (input === TIMEOUT_SENTINEL) {
      return {
        id: request.id,
        approved: false,
        reason: TIMEOUT_REASON,
        decidedAt,
        decidedBy: TOOL_CONFIRMATION_DECIDED_BY_TIMEOUT,
      };
    }

    if ((input ?? "").trim().toLowerCase() === "y") {
      return {
        id: request.id,
        approved: true,
        decidedAt,
      };
    }

    return {
      id: request.id,
      approved: false,
      reason: USER_DECLINED_REASON,
      decidedAt,
    };
  }

  private printPrompt(request: ToolConfirmationRequest): void {
    console.log(`Tool approval required: ${request.toolName}`);
    console.log(`Step: ${request.stepId}`);
    console.log(`Args: ${JSON.stringify(request.args)}`);
    console.log("Approve? [y/N]:");
  }
}

const TIMEOUT_SENTINEL = Symbol("tool_confirmation_timeout");

async function defaultReaderFn(): Promise<string | null> {
  if (isTestMode()) {
    return null;
  }

  const reader = Deno.stdin.readable
    .pipeThrough(new TextDecoderStream())
    .pipeThrough(new TextLineStream())
    .getReader();

  try {
    const result = await reader.read();
    return result.done ? null : result.value;
  } finally {
    reader.releaseLock();
  }
}
