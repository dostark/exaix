/**
 * @module ToolCommands
 * @path apps/exactl/src/commands/tool_commands.ts
 * @description CLI commands for listing, approving, and denying queued tool confirmations.
 * @architectural-layer CLI
 * @related-files [apps/exactl/src/exactl.ts, packages/storage-sqlite/src/database_service.ts, packages/tool-runtime/src/notification_queue_confirmation_interceptor.ts]
 */

import { z } from "zod";
import { BaseCommand, type ICommandContext } from "@exaix/cli/base.ts";
import type { ToolConfirmationRequest } from "@exaix/schemas/tool_confirmation.ts";
import { DomainEventType, type IToolConfirmationDecidedPayload } from "@exaix/core/events";
import type { Opt, Reason } from "@exaix/core/types";

const DEFAULT_DENIAL_REASON = "User declined";

export class ToolCommands extends BaseCommand {
  constructor(context: ICommandContext) {
    super(context);
  }

  async listPending(): Promise<ToolConfirmationRequest[]> {
    return await this.db.listPendingToolConfirmations();
  }

  async pending(): Promise<void> {
    const pending = await this.listPending();
    if (pending.length === 0) {
      console.log("No pending tool confirmations.");
      return;
    }

    for (const request of pending) {
      console.log([
        request.id,
        request.toolName,
        request.stepId,
        request.expiresAt,
      ].join("\t"));
    }
  }

  async confirm(id: string): Promise<void> {
    const request = await this.requirePendingRequest(id);
    const decidedBy = await this.getUserIdentity();
    await this.db.writeToolConfirmationDecision(id, {
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
    await this.db.writeToolConfirmationDecision(id, {
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

  private async requirePendingRequest(id: string): Promise<ToolConfirmationRequest> {
    const parseResult = z.string().uuid().safeParse(id);
    if (!parseResult.success) {
      throw new Error(`Invalid confirmation ID: must be a valid UUID. Got: "${id}"`);
    }

    const pending = await this.db.listPendingToolConfirmations();
    const request = pending.find((entry) => entry.id === id);
    if (!request) {
      this.fail(`No pending tool confirmation found for ID: ${id}`);
    }

    if (Date.parse(request.expiresAt) <= Date.now()) {
      this.fail(`Tool confirmation has expired: ${id}`);
    }

    return request;
  }

  private fail(message: string): never {
    if (Deno.env.get("EXA_TEST_CLI_MODE") === "1") {
      throw new Error(message);
    }
    console.error(message);
    Deno.exit(1);
  }
}
