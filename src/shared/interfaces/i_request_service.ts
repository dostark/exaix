/**
 * @module IrequestService
 * @path src/shared/interfaces/i_request_service.ts
 * @description Module for IrequestService.
 * @architectural-layer Shared
 * * @related-files [src/shared/types/request.ts]
 */

import type { RequestStatusType } from "../status/request_status.ts";
import type { RequestSource } from "../enums.ts";
import type { IRequestEntry, IRequestMetadata, IRequestOptions, IRequestShowResult } from "../types/request.ts";

import type { IRequestAnalysis } from "../schemas/request_analysis.ts";
import type { AnalysisMode } from "../types/request.ts";

export interface IRequestService {
  /**
   * Create a new request with the given description.
   */
  create(
    description: string,
    options?: IRequestOptions,
    source?: RequestSource,
  ): Promise<IRequestMetadata>;

  /**
   * Alias for create() for TUI compatibility.
   */
  createRequest(description: string, options?: IRequestOptions): Promise<IRequestMetadata>;

  /**
   * List requests, optionally filtered by status.
   */
  list(
    status?: RequestStatusType,
    includeArchived?: boolean,
  ): Promise<IRequestEntry[]>;

  /**
   * Alias for list() for TUI compatibility.
   */
  listRequests(status?: RequestStatusType, includeArchived?: boolean): Promise<IRequestEntry[]>;

  /**
   * Show details of a specific request.
   */
  show(idOrFilename: string): Promise<IRequestShowResult>;

  /**
   * Get the markdown content of a request.
   */
  getRequestContent(requestId: string): Promise<string>;

  /**
   * Update the status of a request.
   */
  updateRequestStatus(requestId: string, status: RequestStatusType): Promise<boolean>;

  /**
   * Get the analysis for a specific request.
   */
  getAnalysis(requestId: string): Promise<IRequestAnalysis | null>;

  /**
   * Run intent analysis for a specific request.
   */
  analyze(requestId: string, options?: { mode?: AnalysisMode; force?: boolean }): Promise<IRequestAnalysis>;
}
