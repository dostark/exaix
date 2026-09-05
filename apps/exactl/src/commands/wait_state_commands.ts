/**
 * @module WaitStateCommands
 * @path apps/exactl/src/commands/wait_state_commands.ts
 * @description CLI commands for listing, approving, rejecting, amending, and expiring durable wait states.
 * @architectural-layer CLI
 * @related-files [packages/flow/src/wait_states/]
 */

import { join } from "@std/path";
import { ensureDir } from "@std/fs";
import { BaseCommand, type ICommandContext } from "@exaix/cli/base.ts";
import {
  DefaultWaitStateTransitionPolicy,
  type IWaitState,
  type WaitStateAction,
  WaitStateSchema,
  type WaitStateStatus,
} from "@exaix/flow";
import type { Opt, Reason } from "@exaix/core/types";

export interface IWaitStateListEntry {
  waitStateId: string;
  traceId: string;
  kind: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  deadlineAt?: string;
  resumeToken: string;
  requestedBy?: string;
  assignedApprover?: string;
  amendmentOf?: string;
}

/** The status each action transitions a wait state to; a `resume`-shaped action (not exposed
 *  by any public method here) leaves the current status unchanged. */
const ACTION_STATUS: Partial<Record<WaitStateAction, WaitStateStatus>> = {
  approve: "fulfilled",
  reject: "rejected",
  amend: "amended",
  expire: "expired",
  cancel: "cancelled",
};

function resolveActionStatus(action: WaitStateAction, currentStatus: WaitStateStatus): WaitStateStatus {
  return ACTION_STATUS[action] ?? currentStatus;
}

export class WaitStateCommands extends BaseCommand {
  private workspaceWaitStatesDir: string;

  constructor(context: ICommandContext) {
    super(context);
    const config = context.config.getAll();
    const root = config.system.root!;
    const workspace = config.paths.workspace!;
    this.workspaceWaitStatesDir = join(root, workspace, config.paths.waitStates!);
  }

  async initStore(): Promise<void> {
    await ensureDir(this.workspaceWaitStatesDir);
  }

  async list(status?: Opt<string, Reason.OptionalInput>): Promise<IWaitStateListEntry[]> {
    await this.initStore();
    const entries: IWaitStateListEntry[] = [];

    for await (const traceDir of Deno.readDir(this.workspaceWaitStatesDir)) {
      if (!traceDir.isDirectory) continue;
      const tracePath = join(this.workspaceWaitStatesDir, traceDir.name);
      for await (const file of Deno.readDir(tracePath)) {
        if (!file.isFile || !file.name.endsWith(".json")) continue;
        const content = await Deno.readTextFile(join(tracePath, file.name));
        try {
          const parsed = JSON.parse(content) as IWaitState;
          if (!status || parsed.status === status) {
            entries.push({
              waitStateId: parsed.waitStateId,
              traceId: parsed.traceId,
              kind: parsed.kind,
              status: parsed.status,
              createdAt: parsed.createdAt,
              updatedAt: parsed.updatedAt,
              deadlineAt: parsed.deadlineAt,
              resumeToken: parsed.resumeToken,
              requestedBy: parsed.requestedBy,
              assignedApprover: parsed.assignedApprover,
              amendmentOf: parsed.amendmentOf,
            });
          }
        } catch {
          continue;
        }
      }
    }

    return entries.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }

  async approve(
    resumeToken: string,
    resolutionSummary?: Opt<string, Reason.OptionalInput>,
    resolvedBy?: Opt<string, Reason.OptionalInput>,
  ): Promise<IWaitState> {
    return await this.transitionByToken(resumeToken, "approve", resolutionSummary, resolvedBy);
  }

  async reject(
    resumeToken: string,
    resolutionSummary?: Opt<string, Reason.OptionalInput>,
    resolvedBy?: Opt<string, Reason.OptionalInput>,
  ): Promise<IWaitState> {
    return await this.transitionByToken(resumeToken, "reject", resolutionSummary, resolvedBy);
  }

  async amend(
    resumeToken: string,
    resolutionSummary?: Opt<string, Reason.OptionalInput>,
    resolvedBy?: Opt<string, Reason.OptionalInput>,
  ): Promise<IWaitState> {
    return await this.transitionByToken(resumeToken, "amend", resolutionSummary, resolvedBy);
  }

  async expire(
    resumeToken: string,
    resolutionSummary?: Opt<string, Reason.OptionalInput>,
    resolvedBy?: Opt<string, Reason.OptionalInput>,
  ): Promise<IWaitState> {
    return await this.transitionByToken(resumeToken, "expire", resolutionSummary, resolvedBy);
  }

  async cancel(
    resumeToken: string,
    resolutionSummary?: Opt<string, Reason.OptionalInput>,
    resolvedBy?: Opt<string, Reason.OptionalInput>,
  ): Promise<IWaitState> {
    return await this.transitionByToken(resumeToken, "cancel", resolutionSummary, resolvedBy);
  }

  /** `resolvedBy` (an actor identity, e.g. `"user-simulator:<persona>"`) is merged into the
   *  wait-state's existing free-form `metadata` when provided; omitted, it leaves `metadata`
   *  byte-identical to today's behavior — no `WaitStateSchema` change needed. */
  private async transitionByToken(
    resumeToken: string,
    action: WaitStateAction,
    resolutionSummary?: Opt<string, Reason.OptionalInput>,
    resolvedBy?: Opt<string, Reason.OptionalInput>,
  ): Promise<IWaitState> {
    await this.initStore();
    const policy = new DefaultWaitStateTransitionPolicy();

    for await (const traceDir of Deno.readDir(this.workspaceWaitStatesDir)) {
      if (!traceDir.isDirectory) continue;
      const tracePath = join(this.workspaceWaitStatesDir, traceDir.name);
      for await (const file of Deno.readDir(tracePath)) {
        if (!file.isFile || !file.name.endsWith(".json")) continue;
        const filePath = join(tracePath, file.name);
        const content = await Deno.readTextFile(filePath);
        let parsed: IWaitState | undefined;
        try {
          parsed = WaitStateSchema.parse(JSON.parse(content)) as IWaitState;
        } catch {
          continue;
        }
        if (!parsed || parsed.resumeToken !== resumeToken) continue;

        const validation = policy.validate({ current: parsed, action });
        if (!validation.allowed) {
          throw new Error(validation.reason!);
        }

        const updated: IWaitState = {
          ...parsed,
          status: resolveActionStatus(action, parsed.status),
          updatedAt: new Date().toISOString(),
          resolutionSummary: resolutionSummary ?? parsed.resolutionSummary,
          ...(resolvedBy !== undefined ? { metadata: { ...parsed.metadata, resolvedBy } } : {}),
        };

        await Deno.writeTextFile(filePath, JSON.stringify(updated, null, 2));
        return updated;
      }
    }

    throw new Error(`wait state not found for resume token: ${resumeToken}`);
  }
}
