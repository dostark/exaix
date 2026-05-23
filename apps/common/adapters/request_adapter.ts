/**
 * @module RequestAdapter
 * @path apps/common/adapters/request_adapter.ts
 * @description Module for RequestAdapter.
 * @architectural-layer Services
 * @ungrounded
 * @related-files [apps/exactl/src/commands/request_commands.ts, "packages/core/src/types/i_request_service.ts"]
 */

import type { IRequestService } from "@exaix/core/types";
import type { IRequestAnalysis } from "@exaix/schemas/request_analysis.ts";
import type { RequestStatusType } from "@exaix/core/status";
import type { AnalysisMode } from "@exaix/core/types";
import type { RequestSource } from "@exaix/core";
import type { IRequestEntry, IRequestMetadata, IRequestOptions, IRequestShowResult } from "@exaix/core/request";

interface IRequestCommandService {
  create(description: string, options?: IRequestOptions, source?: RequestSource): Promise<IRequestMetadata>;
  list(status?: RequestStatusType, includeArchived?: boolean): Promise<IRequestEntry[]>;
  show(idOrFilename: string): Promise<IRequestShowResult>;
  getRequestContent(requestId: string): Promise<string>;
  updateRequestStatus?(requestId: string, status: RequestStatusType): Promise<boolean>;
  getAnalysis?(requestId: string): Promise<IRequestAnalysis | null>;
  analyze(
    requestId: string,
    options?: { mode?: AnalysisMode; force?: boolean } | AnalysisMode,
    force?: boolean,
  ): Promise<IRequestAnalysis>;
}

export class RequestAdapter implements IRequestService {
  constructor(private service: IRequestCommandService) {}

  async create(
    description: string,
    options?: IRequestOptions,
    source?: RequestSource,
  ): Promise<IRequestMetadata> {
    return await this.service.create(description, options, source);
  }

  async createRequest(description: string, options?: IRequestOptions): Promise<IRequestMetadata> {
    return await this.create(description, options);
  }

  async list(
    status?: RequestStatusType,
    includeArchived?: boolean,
  ): Promise<IRequestEntry[]> {
    return await this.service.list(status, includeArchived);
  }

  async listRequests(status?: RequestStatusType, includeArchived?: boolean): Promise<IRequestEntry[]> {
    return await this.list(status, includeArchived);
  }

  async show(idOrFilename: string): Promise<IRequestShowResult> {
    return await this.service.show(idOrFilename);
  }

  async getRequestContent(requestId: string): Promise<string> {
    return await this.service.getRequestContent(requestId);
  }

  async updateRequestStatus(requestId: string, status: RequestStatusType): Promise<boolean> {
    if (typeof this.service.updateRequestStatus !== "function") {
      return false;
    }
    return await this.service.updateRequestStatus(requestId, status);
  }

  async getAnalysis(requestId: string): Promise<IRequestAnalysis | null> {
    if (typeof this.service.getAnalysis === "function") {
      return await this.service.getAnalysis(requestId);
    }
    // Command implementation
    const result = await this.service.show(requestId);
    return result.analysis || null;
  }

  async analyze(
    requestId: string,
    options?: { mode?: AnalysisMode; force?: boolean },
  ): Promise<IRequestAnalysis> {
    return await this.service.analyze(requestId, options);
  }
}
