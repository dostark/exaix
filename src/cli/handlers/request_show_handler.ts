/**
 * @module RequestShowHandler
 * @path src/cli/handlers/request_show_handler.ts
 * @description Handles displaying detailed information for a specific request, including body extraction and associated plan token statistics.
 * @architectural-layer CLI
 * * @related-files [src/cli/request_commands.ts, src/schemas/request.ts]
 */

import { join } from "@std/path";
import { exists } from "@std/fs";
import { BaseCommand, type ICommandContext } from "../base.ts";
import type { IRequestAnalysis } from "@exaix/schemas/request_analysis.ts";
import type { IRequestShowResult } from "../../shared/types/request.ts";
import { coerceRequestStatus } from "../../shared/status/request_status.ts";
import { PlanStatus } from "../../shared/status/plan_status.ts";
import { AnalysisMode } from "../../shared/types/request.ts";
import { RequestKind, RequestPriority } from "../../shared/enums.ts";
import { getWorkspaceRequestsDir } from "./request_paths.ts";
import { DEFAULT_IDENTITY_ID, PORTAL_LABEL } from "../../shared/constants.ts";

export class RequestShowHandler extends BaseCommand {
  private workspaceRequestsDir: string;

  constructor(context: ICommandContext) {
    super(context);
    this.workspaceRequestsDir = getWorkspaceRequestsDir(context);
  }

  /**
   * Run analysis on a specific request
   */
  async analyze(
    idOrFilename: string,
    mode: AnalysisMode = AnalysisMode.HYBRID,
    force?: boolean,
  ): Promise<IRequestAnalysis> {
    return await this.requests.analyze(idOrFilename, { mode, force });
  }

  async show(idOrFilename: string): Promise<IRequestShowResult> {
    // Check if directory exists
    if (!await exists(this.workspaceRequestsDir)) {
      throw new Error(`Request not found: ${idOrFilename}`);
    }

    const { matchingFile, matchingFrontmatter } = await this.findMatchingRequestFile(idOrFilename);
    const requestId = matchingFile.split("/").pop()?.replace(/\.md$/, "") ?? "";
    const planTokens = await this.findPlanTokenStats(requestId);

    // Read full content
    const fullContent = await Deno.readTextFile(matchingFile);

    // Extract body (content after YAML frontmatter)
    const body = fullContent.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, "").trim();

    // Get analysis if exists (requests service may not be available in all contexts)
    const analysis = this.context.requests ? await this.context.requests.getAnalysis(requestId) : null;

    return {
      metadata: this.mapToMetadata(matchingFile, matchingFrontmatter, planTokens),
      content: body,
      analysis: analysis || undefined,
    };
  }

  private mapToMetadata(
    matchingFile: string,
    matchingFrontmatter: Record<string, string | boolean | number>,
    planTokens: Record<string, string> | null,
  ): IRequestShowResult["metadata"] {
    const identityValue = String(matchingFrontmatter.identity || matchingFrontmatter.agent || DEFAULT_IDENTITY_ID);
    const metadata: IRequestShowResult["metadata"] & { agent: string } = {
      path: matchingFile,
      filename: matchingFile.split("/").pop() || "",
      status: coerceRequestStatus(String(matchingFrontmatter.status || "")),
      trace_id: String(matchingFrontmatter.trace_id || ""),
      priority: String(
        matchingFrontmatter.priority || RequestPriority.NORMAL,
      ) as IRequestShowResult["metadata"]["priority"],
      identity: identityValue,
      agent: identityValue,
      created: String(matchingFrontmatter.created || ""),
      created_by: String(matchingFrontmatter.created_by || "unknown"),
      source: String(matchingFrontmatter.source || "unknown") as IRequestShowResult["metadata"]["source"],
    };

    type OptionalMetadataStringKey =
      | "portal"
      | "target_branch"
      | "model"
      | "flow"
      | "error"
      | "rejected_path"
      | "subject";

    const optionalFields: Array<{
      sourceKey: string;
      targetKey: OptionalMetadataStringKey;
    }> = [
      { sourceKey: PORTAL_LABEL, targetKey: "portal" },
      { sourceKey: "target_branch", targetKey: "target_branch" },
      { sourceKey: "model", targetKey: "model" },
      { sourceKey: RequestKind.FLOW, targetKey: "flow" },
      { sourceKey: PlanStatus.ERROR, targetKey: "error" },
      { sourceKey: "rejected_path", targetKey: "rejected_path" },
      { sourceKey: "subject", targetKey: "subject" },
    ];

    for (const { sourceKey, targetKey } of optionalFields) {
      const value = matchingFrontmatter[sourceKey];
      if (value) {
        (metadata as IRequestShowResult["metadata"] & Record<OptionalMetadataStringKey, string>)[targetKey] = String(
          value,
        );
      }
    }

    const skills = matchingFrontmatter.skills;
    if (skills) {
      metadata.skills = JSON.parse(String(skills));
    }

    if (planTokens) {
      Object.assign(metadata, planTokens);
    }

    return metadata;
  }

  private async findMatchingRequestFile(
    idOrFilename: string,
  ): Promise<{ matchingFile: string; matchingFrontmatter: Record<string, string | boolean | number> }> {
    let matchingFile: string | null = null;
    let matchingFrontmatter: Record<string, string | boolean | number> | null = null;

    for await (const entry of Deno.readDir(this.workspaceRequestsDir)) {
      if (!entry.isFile || !entry.name.endsWith(".md")) continue;

      const filePath = join(this.workspaceRequestsDir, entry.name);
      const content = await Deno.readTextFile(filePath);
      const frontmatter = this.extractFrontmatter(content);

      const nameWithoutExt = entry.name.replace(/\.md$/i, "");
      if (
        entry.name === idOrFilename ||
        nameWithoutExt === idOrFilename ||
        frontmatter.trace_id === idOrFilename ||
        frontmatter.subject === idOrFilename
      ) {
        return { matchingFile: filePath, matchingFrontmatter: frontmatter };
      }

      if (frontmatter.trace_id && String(frontmatter.trace_id).startsWith(idOrFilename)) {
        if (matchingFile) {
          throw new Error(`Ambiguous request ID: ${idOrFilename}. Please use a longer ID.`);
        }
        matchingFile = filePath;
        matchingFrontmatter = frontmatter;
      }
    }

    if (!matchingFile || !matchingFrontmatter) {
      throw new Error(`Request not found: ${idOrFilename}`);
    }

    return { matchingFile, matchingFrontmatter };
  }

  private async findPlanTokenStats(requestId: string): Promise<Record<string, string> | null> {
    if (!requestId) {
      return null;
    }

    const workspaceRoot = join(this.config.system.root, this.config.paths.workspace);
    const plansDir = join(workspaceRoot, this.config.paths.plans);
    const rejectedDir = join(workspaceRoot, this.config.paths.rejected);
    const activeDir = join(workspaceRoot, this.config.paths.active);
    const archiveDir = join(workspaceRoot, this.config.paths.archive);

    const planId = `${requestId}_plan`;
    const candidatePaths = [
      join(plansDir, `${planId}.md`),
      join(rejectedDir, `${planId}_rejected.md`),
      join(activeDir, `${planId}.md`),
      join(archiveDir, `${planId}.md`),
    ];

    for (const planPath of candidatePaths) {
      if (await exists(planPath)) {
        const content = await Deno.readTextFile(planPath);
        const frontmatter = this.extractFrontmatter(content);
        const tokenFields: Record<string, string> = {};
        if (frontmatter.input_tokens !== undefined) tokenFields.input_tokens = String(frontmatter.input_tokens);
        if (frontmatter.output_tokens !== undefined) tokenFields.output_tokens = String(frontmatter.output_tokens);
        if (frontmatter.total_tokens !== undefined) tokenFields.total_tokens = String(frontmatter.total_tokens);
        if (frontmatter.token_provider !== undefined) tokenFields.token_provider = String(frontmatter.token_provider);
        if (frontmatter.token_model !== undefined) tokenFields.token_model = String(frontmatter.token_model);
        if (frontmatter.token_cost_usd !== undefined) tokenFields.token_cost_usd = String(frontmatter.token_cost_usd);
        return Object.keys(tokenFields).length > 0 ? tokenFields : null;
      }
    }

    return null;
  }
}
