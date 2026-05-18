/**
 * @module ToolCommands
 * @path src/cli/commands/tool_commands.ts
 * @description CLI commands for listing, approving, and denying queued tool confirmations.
 * @architectural-layer CLI
 * @related-files [src/cli/exactl.ts, src/services/core/db.ts, src/services/tool/notification_queue_confirmation_interceptor.ts]
 */

import { z } from "zod";
import { BaseCommand, type ICommandContext } from "../base.ts";
import type { ToolConfirmationRequest } from "@exaix/schemas/tool_confirmation.ts";

const DEFAULT_DENIAL_REASON = "User declined";

export class ToolCommands extends BaseCommand {
  constructor(context: ICommandContext) {
    super(context);
  }

  async pending(): Promise<void> {
    const pending = await this.db.listPendingToolConfirmations();
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
    console.log(`Tool confirmation denied: ${request.id}`);
  }

  private async requirePendingRequest(id: string): Promise<ToolConfirmationRequest> {
    const parseResult = z.string().uuid().safeParse(id);
    if (!parseResult.success) {
      this.fail(`Invalid confirmation ID: must be a valid UUID. Got: \"${id}\"`);
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
