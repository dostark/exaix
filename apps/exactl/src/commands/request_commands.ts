/**
 * @module RequestCommands
 * @path apps/exactl/src/commands/request_commands.ts
 * @description Provides CLI commands for creating and managing agent requests, serving as the primary interface for human-to-agent communication.
 * @architectural-layer CLI
 * @related-files ["packages/schemas/src/request.ts", "apps/daemon/main.ts"]
 */

import { BaseCommand, type ICommandContext } from "@exaix/cli/base.ts";
import type { RequestStatusType } from "@exaix/core/status";
import { RequestCreateHandler } from "../handlers/request_create_handler.ts";
import { RequestListHandler } from "../handlers/request_list_handler.ts";
import { RequestShowHandler } from "../handlers/request_show_handler.ts";
import {
  type IClarifyOptions,
  type IClarifyResult,
  RequestClarifyHandler,
} from "../handlers/request_clarify_handler.ts";
import type { IRequestAnalysis } from "@exaix/schemas/request_analysis.ts";
import { RequestSource } from "@exaix/core";
import { RequestStatus } from "@exaix/core/status";
import {
  AnalysisMode,
  type IRequestCancelResult,
  type IRequestEntry,
  type IRequestMetadata,
  type IRequestOptions,
  type IRequestShowResult,
} from "@exaix/core/request";
import { join } from "@std/path";
import type { Opt, Reason } from "@exaix/core/types";
import { WaitStateSchema } from "@exaix/flow";
import { WaitStateCommands } from "./wait_state_commands.ts";
import { ApprovalKind } from "./approval_id.ts";
import { ExaCtlError, ExaCtlExitCode } from "../exactl_errors.ts";

const WAIT_LIST_COMMAND = `exactl approval list --kind ${ApprovalKind.WAIT}`;

/** All operations are logged to activity_log with actor='human'. */
export class RequestCommands extends BaseCommand {
  private createHandler: RequestCreateHandler;
  private listHandler: RequestListHandler;
  private showHandler: RequestShowHandler;
  private clarifyHandler: RequestClarifyHandler;
  private waitStateCommands: WaitStateCommands;

  constructor(
    context: ICommandContext,
  ) {
    super(context);
    this.createHandler = new RequestCreateHandler(context);
    this.listHandler = new RequestListHandler(context);
    this.showHandler = new RequestShowHandler(context);
    this.clarifyHandler = new RequestClarifyHandler(context);
    this.waitStateCommands = new WaitStateCommands(context);
  }

  /** Internal helper for request promotion or manual trigger. */
  async analyze(
    idOrFilename: string,
    mode: AnalysisMode = AnalysisMode.HYBRID,
    force?: Opt<boolean, Reason.OptionalInput>,
  ): Promise<IRequestAnalysis> {
    return await this.showHandler.analyze(idOrFilename, mode, force);
  }

  async create(
    description: string,
    options: IRequestOptions = {},
    source: RequestSource = RequestSource.CLI,
  ): Promise<IRequestMetadata> {
    return await this.createHandler.create(description, options, source);
  }

  async createFromFile(
    filePath: string,
    options: IRequestOptions = {},
  ): Promise<IRequestMetadata> {
    return await this.createHandler.createFromFile(filePath, options);
  }

  /** Requests are sorted by created date, newest first. */
  async list(
    status?: Opt<RequestStatusType, Reason.QueryFilter>,
    includeArchived?: Opt<boolean, Reason.QueryFilter>,
  ): Promise<IRequestEntry[]> {
    return await this.listHandler.list(status, includeArchived);
  }

  /** `idOrFilename` accepts a full trace_id, an 8-char short trace_id, or a filename. */
  async show(idOrFilename: string): Promise<IRequestShowResult> {
    return await this.showHandler.show(idOrFilename);
  }

  async getRequestContent(requestId: string): Promise<string> {
    const result = await this.show(requestId);
    return result.content;
  }

  /** Cancels a pending or needs_clarification request and its pending clarification wait states.
   *  Each wait cancel names the user, so it is journaled. A failed one is reported with its command. */
  async cancel(requestId: string, reason: Opt<string, Reason.OptionalInput>): Promise<IRequestCancelResult> {
    const result = await this.requests.cancelRequest(requestId, reason);
    if (result.previous_status === RequestStatus.NEEDS_CLARIFICATION) {
      const failed = await this.cancelClarificationWaits(result.trace_id, reason);
      if (failed.length > 0) {
        throw new ExaCtlError(
          ExaCtlExitCode.FAILURE,
          `Request ${result.trace_id} is cancelled, but a clarification wait state is still pending. Run ${
            failed.join(", ")
          }.`,
        );
      }
    }
    return result;
  }

  /** The recovery commands of every wait step that failed. A scan that fails leaves the list command. */
  private async cancelClarificationWaits(
    traceId: string,
    reason: Opt<string, Reason.OptionalInput>,
  ): Promise<string[]> {
    const actor = await this.getUserIdentity();
    let tokens: string[];
    try {
      tokens = await this.pendingClarificationTokens(traceId);
    } catch (error) {
      return [`'${WAIT_LIST_COMMAND}' (${error instanceof Error ? error.message : String(error)})`];
    }
    const failed: string[] = [];
    for (const resumeToken of tokens) {
      try {
        await this.waitStateCommands.cancel(resumeToken, reason, actor);
      } catch (error) {
        failed.push(
          `'exactl approval cancel ${ApprovalKind.WAIT}:${resumeToken}' (${
            error instanceof Error ? error.message : String(error)
          })`,
        );
      }
    }
    return failed;
  }

  /** The cancel that the TUI reaches through the request adapter. It is the same path as `cancel`. */
  async cancelRequest(requestId: string, reason: Opt<string, Reason.OptionalInput>): Promise<IRequestCancelResult> {
    return await this.cancel(requestId, reason);
  }

  /** Resume tokens of the pending clarification wait states of a trace. A missing wait directory yields none. */
  private async pendingClarificationTokens(traceId: string): Promise<string[]> {
    const cfg = this.context.config.getAll();
    const waitDir = join(cfg.system.root, cfg.paths.workspace, cfg.paths.waitStates, traceId);
    const tokens: string[] = [];
    try {
      for await (const entry of Deno.readDir(waitDir)) {
        if (!entry.isFile || !entry.name.endsWith(".json")) continue;
        let parsed;
        try {
          parsed = WaitStateSchema.parse(JSON.parse(await Deno.readTextFile(join(waitDir, entry.name))));
        } catch {
          continue;
        }
        if (parsed.kind === "clarification" && parsed.status === "pending") tokens.push(parsed.resumeToken);
      }
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
    return tokens;
  }

  /** `options.engine` is for DI in tests. */
  async clarify(
    requestId: string,
    options?: Opt<IClarifyOptions, Reason.OptionalInput>,
  ): Promise<IClarifyResult> {
    if (!options?.onClarificationResolved) {
      const resolvedBy = options?.resolvedBy;
      const resolveCallback = async (traceId: string) => {
        try {
          for (const resumeToken of await this.pendingClarificationTokens(traceId)) {
            // WaitStateCommands keeps the resolvedBy audit attribution of every wait-state gate.
            await this.waitStateCommands.approve(resumeToken, undefined, resolvedBy);
          }
        } catch {
          // wait directory may not exist — ignore
        }
      };
      return await this.clarifyHandler.clarify(requestId, { ...options, onClarificationResolved: resolveCallback });
    }
    return await this.clarifyHandler.clarify(requestId, options);
  }
}
