/**
 * @module ToolCommands
 * @path apps/exactl/src/commands/tool_commands.ts
 * @description CLI commands for listing, approving, and denying queued tool confirmations.
 * @architectural-layer CLI
 * @related-files [apps/exactl/src/exactl.ts, packages/storage-sqlite/src/database_service.ts, packages/tool-runtime/src/notification_queue_confirmation_interceptor.ts]
 */

import { z } from "zod";
import { BaseCommand, type ICommandContext } from "@exaix/cli/base.ts";
import type { ToolConfirmationDecision, ToolConfirmationRequest } from "@exaix/schemas/tool_confirmation.ts";
import { DomainEventType, type IToolConfirmationDecidedPayload } from "@exaix/core/events";
import type { Opt, Reason } from "@exaix/core/types";
import { ExaCtlError, ExaCtlExitCode } from "../exactl_errors.ts";

const DEFAULT_DENIAL_REASON = "User declined";

export class ToolCommands extends BaseCommand {
  constructor(context: ICommandContext) {
    super(context);
  }

  async listPending(): Promise<ToolConfirmationRequest[]> {
    return await this.db.listPendingToolConfirmations();
  }

  async confirm(id: string): Promise<void> {
    const request = await this.requirePendingRequest(id);
    const decidedBy = await this.getUserIdentity();
    await this.writeDecision(id, {
      approved: true,
      decidedAt: new Date().toISOString(),
      decidedBy,
    });
    await this.logDecision(request, true, undefined, decidedBy);
    console.log(`Tool confirmation approved: ${request.id}`);
  }

  async deny(id: string, reason: string = DEFAULT_DENIAL_REASON): Promise<void> {
    const request = await this.requirePendingRequest(id);
    const decidedBy = await this.getUserIdentity();
    await this.writeDecision(id, {
      approved: false,
      reason,
      decidedAt: new Date().toISOString(),
      decidedBy,
    });
    await this.logDecision(request, false, reason, decidedBy);
    console.log(`Tool confirmation denied: ${request.id}`);
  }

  private async logDecision(
    request: ToolConfirmationRequest,
    approved: boolean,
    reason: Opt<string, Reason.OptionalInput>,
    decidedBy: string,
  ): Promise<void> {
    const payload: IToolConfirmationDecidedPayload = {
      confirmation_id: request.id,
      tool_name: request.toolName,
      step_id: request.stepId ?? null,
      approved,
      reason: reason ?? null,
      decided_by: decidedBy,
    };
    await this.display.info(DomainEventType.ToolConfirmationDecided, request.id, { ...payload }, request.traceId);
  }

  /** A confirmation is decided once. The write refuses a second decision, so a lost race exits with a state conflict. */
  private async writeDecision(id: string, decision: Omit<ToolConfirmationDecision, "id">): Promise<void> {
    if (!(await this.db.writeToolConfirmationDecision(id, decision))) {
      throw new ExaCtlError(ExaCtlExitCode.STATE_CONFLICT, `Tool confirmation ${id} was decided meanwhile.`);
    }
  }

  private async requirePendingRequest(id: string): Promise<ToolConfirmationRequest> {
    if (!z.string().uuid().safeParse(id).success) {
      throw new ExaCtlError(ExaCtlExitCode.USAGE, "Invalid confirmation ID: must be a valid UUID.");
    }

    const request = (await this.db.listPendingToolConfirmations()).find((entry) => entry.id === id);
    if (!request) {
      const decided = await this.db.getToolConfirmationDecision(id);
      if (decided !== null) {
        throw new ExaCtlError(
          ExaCtlExitCode.STATE_CONFLICT,
          `Tool confirmation ${id} is already decided (approved: ${decided.approved}).`,
        );
      }
      throw new ExaCtlError(ExaCtlExitCode.NOT_FOUND, `No pending tool confirmation found for ID: ${id}`);
    }

    if (Date.parse(request.expiresAt) <= Date.now()) {
      throw new ExaCtlError(ExaCtlExitCode.STATE_CONFLICT, `Tool confirmation has expired: ${id}`);
    }

    return request;
  }
}
