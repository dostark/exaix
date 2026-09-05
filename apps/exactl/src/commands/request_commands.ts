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
import {
  AnalysisMode,
  type IRequestEntry,
  type IRequestMetadata,
  type IRequestOptions,
  type IRequestShowResult,
} from "@exaix/core/request";
import { join } from "@std/path";
import type { Opt, Reason } from "@exaix/core/types";
import { WaitStateSchema } from "@exaix/flow";
import { WaitStateCommands } from "./wait_state_commands.ts";

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

  /** `options.engine` is for DI in tests. */
  async clarify(
    requestId: string,
    options?: Opt<IClarifyOptions, Reason.OptionalInput>,
  ): Promise<IClarifyResult> {
    if (!options?.onClarificationResolved) {
      const cfg = this.context.config.getAll();
      const waitStatesRoot = join(cfg.system.root, cfg.paths.workspace, cfg.paths.waitStates ?? "WaitStates");
      const resolvedBy = options?.resolvedBy;
      const resolveCallback = async (traceId: string) => {
        const waitDir = join(waitStatesRoot, traceId);
        try {
          for await (const entry of Deno.readDir(waitDir)) {
            if (!entry.isFile || !entry.name.endsWith(".json")) continue;
            const content = await Deno.readTextFile(join(waitDir, entry.name));
            let parsed;
            try {
              parsed = WaitStateSchema.parse(JSON.parse(content));
            } catch {
              continue;
            }
            if (parsed.kind === "clarification" && parsed.status === "pending") {
              // Route through WaitStateCommands (not a direct file write) so this resolution
              // carries the same resolvedBy audit attribution as every other wait-state gate.
              await this.waitStateCommands.approve(parsed.resumeToken, undefined, resolvedBy);
            }
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
