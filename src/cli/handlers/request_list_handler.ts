/**
 * @module RequestListHandler
 * @path src/cli/handlers/request_list_handler.ts
 * @description Handles listing and filtering agent requests from the workspace inbox, including status coercion and sorting.
 * @architectural-layer CLI
 * @related-files ["src/cli/commands/request_commands.ts", "packages/schemas/src/request.ts"]
 */

import { join } from "@std/path";
import { exists } from "@std/fs";
import { BaseCommand, type ICommandContext } from "../base.ts";
import type { IRequestEntry } from "@exaix/core/types";
import { getWorkspaceArchiveDir, getWorkspaceRejectedDir, getWorkspaceRequestsDir } from "./request_paths.ts";
import { DEFAULT_IDENTITY_ID, PORTAL_LABEL } from "@exaix/core";
import { RequestKind, RequestPriority } from "@exaix/core";
import { coerceRequestStatus, type RequestStatusType } from "@exaix/core/status";

export class RequestListHandler extends BaseCommand {
  private workspaceRequestsDir: string;

  constructor(context: ICommandContext) {
    super(context);
    this.workspaceRequestsDir = getWorkspaceRequestsDir(context);
  }

  async list(status?: RequestStatusType, includeArchived?: boolean): Promise<IRequestEntry[]> {
    const dirsToScan = this.getDirectoriesToScan(includeArchived);
    const requests = await this.scanDirectories(dirsToScan, status);

    // Sort by created date descending (newest first)
    requests.sort((a, b) => {
      const dateA = new Date(a.created).getTime();
      const dateB = new Date(b.created).getTime();
      return dateB - dateA;
    });

    return requests;
  }

  private getDirectoriesToScan(includeArchived?: boolean): string[] {
    const dirs = [this.workspaceRequestsDir];
    if (includeArchived) {
      dirs.push(getWorkspaceArchiveDir(this.context));
      dirs.push(getWorkspaceRejectedDir(this.context));
    }
    return dirs;
  }

  private async scanDirectories(dirs: string[], statusFilter?: RequestStatusType): Promise<IRequestEntry[]> {
    const requests: IRequestEntry[] = [];
    for (const dir of dirs) {
      if (!await exists(dir)) continue;

      for await (const entry of Deno.readDir(dir)) {
        if (!entry.isFile || !entry.name.endsWith(".md") || entry.name.includes("_plan")) {
          continue;
        }

        const entryResult = await this.processRequestEntry(dir, entry.name, statusFilter);
        if (entryResult) {
          requests.push(entryResult);
        }
      }
    }
    return requests;
  }

  private async processRequestEntry(
    dir: string,
    filename: string,
    statusFilter?: RequestStatusType,
  ): Promise<IRequestEntry | null> {
    const filePath = join(dir, filename);
    try {
      const content = await Deno.readTextFile(filePath);
      const frontmatter = this.extractFrontmatter(content);
      const parsedStatus = coerceRequestStatus(String(frontmatter.status || ""));

      if (statusFilter && parsedStatus !== statusFilter) {
        return null;
      }

      return this.mapFrontmatterToRequestEntry(filename, filePath, frontmatter, parsedStatus);
    } catch (error) {
      console.warn(`Failed to read request file ${filePath}:`, error);
      return null;
    }
  }

  private mapFrontmatterToRequestEntry(
    filename: string,
    filePath: string,
    frontmatter: Record<string, string | boolean | number>,
    status: RequestStatusType,
  ): IRequestEntry {
    const identityValue = String(frontmatter.identity || frontmatter.agent || DEFAULT_IDENTITY_ID);
    const entry: IRequestEntry & { agent: string } = {
      filename,
      path: filePath,
      status,
      trace_id: String(frontmatter.trace_id || ""),
      priority: String(frontmatter.priority || RequestPriority.NORMAL) as IRequestEntry["priority"],
      identity: identityValue,
      agent: identityValue,
      created: String(frontmatter.created || ""),
      created_by: String(frontmatter.created_by || "unknown"),
      source: String(frontmatter.source || "unknown") as IRequestEntry["source"],
    };

    if (frontmatter[PORTAL_LABEL]) entry.portal = String(frontmatter[PORTAL_LABEL]);
    if (frontmatter.target_branch) entry.target_branch = String(frontmatter.target_branch);
    if (frontmatter.model) entry.model = String(frontmatter.model);
    if (frontmatter[RequestKind.FLOW]) entry.flow = String(frontmatter[RequestKind.FLOW]);
    if (frontmatter.rejected_path) entry.rejected_path = String(frontmatter.rejected_path);
    if (frontmatter.subject) entry.subject = String(frontmatter.subject);

    if (frontmatter.skills) entry.skills = JSON.parse(String(frontmatter.skills));

    return entry;
  }
}
