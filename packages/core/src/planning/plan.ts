/**
 * @module PlanService
 * @path packages/core/src/planning/plan.ts
 * @description Core service for managing AI execution plans.
 * @architectural-layer Services
 * @related-files [apps/exactl/src/commands/plan_commands.ts, "packages/core/src/types/i_plan_service.ts"]
 */

import { join } from "@std/path";
import { ensureDir, exists } from "@std/fs";
import type { Config } from "@exaix/schemas/config.ts";
import { PlanStatus } from "@exaix/core/status";
import type { PlanStatusType } from "@exaix/core/status";
import type { IPlanDetails, IPlanMetadata } from "@exaix/core/types";
import type { IDisplayService } from "@exaix/core/types";
import type { IConfigService } from "@exaix/core/types";
import type { IDatabaseService } from "@exaix/storage-sqlite";
import type { Opt, Reason } from "@exaix/core/types";

export class PlanService {
  private workspacePlansDir: string;
  private workspaceActiveDir: string;
  private workspaceRequestsDir: string;
  private workspaceRejectedDir: string;
  private workspaceArchiveDir: string;

  constructor(
    private config: Config,
    private configService: IConfigService,
    private db: IDatabaseService,
    private display: IDisplayService,
    private userIdentityGetter: () => Promise<string>,
  ) {
    const root = config.system.root!;
    const workspace = config.paths.workspace!;
    this.workspacePlansDir = join(root, workspace, config.paths.plans!);
    this.workspaceActiveDir = join(root, workspace, config.paths.active!);
    this.workspaceRejectedDir = join(root, workspace, config.paths.rejected!);
    this.workspaceArchiveDir = join(root, workspace, config.paths.archive!);
    this.workspaceRequestsDir = join(root, workspace, config.paths.requests!);
  }

  // Private helpers

  /** Parse YAML frontmatter and body from plan file content. Returns null when absent. */
  private parseFrontmatter(
    content: string,
  ): { fm: Record<string, string>; body: string } | null {
    const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
    if (!match) return null;
    const fm: Record<string, string> = {};
    match[1].split("\n").forEach((line) => {
      const parts = line.split(":");
      if (parts.length >= 2) {
        fm[parts[0].trim()] = parts.slice(1).join(":").trim().replace(/"/g, "");
      }
    });
    return { fm, body: match[2] };
  }

  /** Serialize updated frontmatter + body back to Markdown string. */
  private serializePlanContent(fm: Record<string, string>, body: string): string {
    const newFm = Object.entries(fm).map(([k, v]) => `${k}: "${v}"`).join("\n");
    return `---\n${newFm}\n---\n${body}`;
  }

  /** Throws if the plan cannot be found. */
  private async locatePlanFile(planId: string): Promise<string> {
    const searchDirs = [
      this.workspacePlansDir,
      this.workspaceRejectedDir,
      this.workspaceActiveDir,
      this.workspaceArchiveDir,
    ];
    for (const dir of searchDirs) {
      const suffix = dir === this.workspaceRejectedDir ? "_rejected" : "";
      const p = join(dir, `${planId}${suffix}.md`);
      if (await exists(p)) return p;
    }
    throw new Error(`Plan not found: ${planId}`);
  }

  // Public API

  async approve(planId: string, skills?: Opt<string[], Reason.OptionalInput>): Promise<void> {
    const sourcePath = join(this.workspacePlansDir, `${planId}.md`);
    const targetPath = join(this.workspaceActiveDir, `${planId}.md`);

    if (!await exists(sourcePath)) throw new Error(`Plan not found: ${planId}`);

    const content = await Deno.readTextFile(sourcePath);
    const parsed = this.parseFrontmatter(content);
    if (!parsed) throw new Error("Plan frontmatter missing");
    const { fm } = parsed;
    const body = parsed.body;

    if (fm.status !== PlanStatus.REVIEW) {
      throw new Error(`Only plans with status='review' can be approved. Current status: ${fm.status}`);
    }

    if (await exists(targetPath)) {
      await ensureDir(this.workspaceArchiveDir);
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const archivePath = join(this.workspaceArchiveDir, `${planId}_archived_${timestamp}.md`);
      await Deno.rename(targetPath, archivePath);
    }

    const actor = await this.userIdentityGetter();
    const now = new Date().toISOString();

    fm.status = PlanStatus.APPROVED;
    fm.approved_by = actor;
    fm.approved_at = now;
    if (skills && skills.length > 0) fm.skills = JSON.stringify(skills);

    const updatedContent = this.serializePlanContent(fm, body);

    await ensureDir(this.workspaceActiveDir);
    await Deno.writeTextFile(targetPath, updatedContent);
    await Deno.remove(sourcePath);

    await this.display.info("plan.approved", planId, {
      approved_at: now,
      via: "core-service",
    }, fm.trace_id);
  }

  async reject(planId: string, reason: string): Promise<void> {
    const sourcePath = await this.locatePlanFile(planId);
    const targetPath = join(this.workspaceRejectedDir, `${planId}_rejected.md`);
    const content = await Deno.readTextFile(sourcePath);
    const parsed = this.parseFrontmatter(content);
    if (!parsed) throw new Error("Plan frontmatter missing");
    const { fm } = parsed;
    const body = parsed.body;

    const actor = await this.userIdentityGetter();
    const now = new Date().toISOString();

    fm.status = PlanStatus.REJECTED;
    fm.rejected_by = actor;
    fm.rejected_at = now;
    fm.rejection_reason = reason;

    const updatedContent = this.serializePlanContent(fm, body);

    await ensureDir(this.workspaceRejectedDir);
    await Deno.writeTextFile(targetPath, updatedContent);
    await Deno.remove(sourcePath);

    await this.display.info("plan.rejected", planId, {
      reason,
      rejected_at: now,
      via: "core-service",
    }, fm.trace_id);
  }

  async list(statusFilter?: Opt<PlanStatusType, Reason.QueryFilter>): Promise<IPlanMetadata[]> {
    const plans: IPlanMetadata[] = [];
    const dirsToScan = statusFilter
      ? []
      : [this.workspacePlansDir, this.workspaceActiveDir, this.workspaceRejectedDir, this.workspaceArchiveDir];

    if (statusFilter === PlanStatus.APPROVED) dirsToScan.push(this.workspaceActiveDir, this.workspaceArchiveDir);
    else if (statusFilter === PlanStatus.REJECTED) dirsToScan.push(this.workspaceRejectedDir);
    else if (statusFilter) dirsToScan.push(this.workspacePlansDir);

    for (const dir of dirsToScan) {
      if (!await exists(dir)) continue;

      for await (const entry of Deno.readDir(dir)) {
        if (!entry.isFile || !entry.name.endsWith(".md")) continue;

        const planPath = join(dir, entry.name);
        const content = await Deno.readTextFile(planPath);
        const parsed = this.parseFrontmatter(content);
        if (!parsed) continue;
        const { fm } = parsed;

        const id = entry.name.replace(/\.md$/, "").replace(/_rejected$/, "");
        if (!statusFilter || fm.status === statusFilter) {
          plans.push({
            id,
            status: fm.status as PlanStatusType,
            trace_id: fm.trace_id,
            agent_role: fm.agent_role,
            request_id: fm.request_id,
            created_at: fm.created_at,
            subject: fm.subject,
          });
        }
      }
    }

    return plans.sort((a, b) => a.id.localeCompare(b.id));
  }

  async show(planId: string): Promise<IPlanDetails> {
    const sourcePath = await this.locatePlanFile(planId);
    const content = await Deno.readTextFile(sourcePath);
    const parsed = this.parseFrontmatter(content);

    if (!parsed) return { metadata: { id: planId, status: PlanStatus.REVIEW }, content: content.trim() };
    const { fm, body } = parsed;

    return {
      metadata: {
        id: planId,
        status: fm.status as PlanStatusType,
        trace_id: fm.trace_id,
        agent_role: fm.agent_role,
        request_id: fm.request_id,
        created_at: fm.created_at,
        subject: fm.subject,
      },
      content: body.trim(),
    };
  }

  async revise(planId: string, comments: string[]): Promise<void> {
    const planPath = join(this.workspacePlansDir, `${planId}.md`);
    if (!await exists(planPath)) throw new Error(`Plan not found: ${planId}`);

    const content = await Deno.readTextFile(planPath);
    const parsed = this.parseFrontmatter(content);
    if (!parsed) throw new Error("Plan frontmatter missing");
    const { fm } = parsed;
    const originalBody = parsed.body;

    const actor = await this.userIdentityGetter();
    const now = new Date().toISOString();

    fm.status = PlanStatus.NEEDS_REVISION;
    fm.reviewed_by = actor;
    fm.reviewed_at = now;

    const formattedComments = comments.map((c) => `- ${c}`).join("\n");
    const body = originalBody.trim() + "\n\n## Revision Comments\n\n" + formattedComments;

    const updatedContent = this.serializePlanContent(fm, `\n${body}`);

    await Deno.writeTextFile(planPath, updatedContent);

    await this.display.info("plan.revision_requested", planId, {
      comment_count: comments.length,
      reviewed_at: now,
      via: "core-service",
    }, fm.trace_id);
  }
}
