/**
 * @module RequestCommands
 * @path src/cli/commands/request_commands.ts
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

/**
 * RequestCommands provides CLI operations for creating and managing requests.
 * All operations are logged to activity_log with actor='human'.
 */
export class RequestCommands extends BaseCommand {
  private createHandler: RequestCreateHandler;
  private listHandler: RequestListHandler;
  private showHandler: RequestShowHandler;
  private clarifyHandler: RequestClarifyHandler;

  constructor(
    context: ICommandContext,
  ) {
    super(context);
    this.createHandler = new RequestCreateHandler(context);
    this.listHandler = new RequestListHandler(context);
    this.showHandler = new RequestShowHandler(context);
    this.clarifyHandler = new RequestClarifyHandler(context);
  }

  /**
   * Run intent analysis for a specific request.
   * Internal helper for request promotion or manual trigger.
   */
  async analyze(
    idOrFilename: string,
    mode: AnalysisMode = AnalysisMode.HYBRID,
    force?: boolean,
  ): Promise<IRequestAnalysis> {
    return await this.showHandler.analyze(idOrFilename, mode, force);
  }

  /**
   * Create a new request with the given description
   * @param description The request description/task
   * @param options Optional settings (agent, priority, portal)
   * @param source How the request was created (cli, file, interactive)
   * @returns Request metadata including path and trace_id
   */
  async create(
    description: string,
    options: IRequestOptions = {},
    source: RequestSource = RequestSource.CLI,
  ): Promise<IRequestMetadata> {
    return await this.createHandler.create(description, options, source);
  }

  /**
   * Create a request from a file's content
   * @param filePath Path to file containing the request description
   * @param options Optional settings (agent, priority, portal)
   * @returns Request metadata
   */
  async createFromFile(
    filePath: string,
    options: IRequestOptions = {},
  ): Promise<IRequestMetadata> {
    return await this.createHandler.createFromFile(filePath, options);
  }

  /**
   * List requests in the inbox
   * @param status Optional status filter
   * @returns Array of request entries sorted by created date (newest first)
   */
  async list(status?: RequestStatusType, includeArchived?: boolean): Promise<IRequestEntry[]> {
    return await this.listHandler.list(status, includeArchived);
  }

  /**
   * Show details of a specific request
   * @param idOrFilename Full trace_id, short trace_id (8 chars), or filename
   * @returns Request metadata and content body
   */
  async show(idOrFilename: string): Promise<IRequestShowResult> {
    return await this.showHandler.show(idOrFilename);
  }

  async getRequestContent(requestId: string): Promise<string> {
    const result = await this.show(requestId);
    return result.content;
  }

  /**
   * Manage the clarification Q&A loop for a REFINING request.
   * @param requestId The request ID (filename without .md)
   * @param options Flags: answers, proceed, cancel, engine (for DI in tests)
   * @returns Current clarification state with pending questions and quality score
   */
  async clarify(requestId: string, options?: IClarifyOptions): Promise<IClarifyResult> {
    return await this.clarifyHandler.clarify(requestId, options);
  }
}
