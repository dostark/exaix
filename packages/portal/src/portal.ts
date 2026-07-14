/**
 * @module PortalService
 * @path packages/portal/src/portal.ts
 * @description Core service for managing external project portals.
 * @architectural-layer Services
 * @related-files [apps/exactl/src/commands/portal_commands.ts, "packages/core/src/types/i_portal_service.ts"]
 */

import { join, resolve } from "@std/path";
import { ensureDir, exists } from "@std/fs";
import type { Config, IPortalKnowledge } from "@exaix/schemas";

import {
  DEFAULT_PROJECTS_MEMORY_PATH,
  type PortalAnalysisMode,
  type PortalExecutionStrategy,
  PortalStatus,
  VerificationStatus,
} from "@exaix/core";
import type { IDisplayService, IPortalDetails, IPortalInfo, IVerificationResult } from "@exaix/core/types";
import { PORTAL_ALIAS_MAX_LENGTH } from "./constants.ts";

import { loadKnowledge, saveKnowledge } from "../knowledge/knowledge_persistence.ts";
import type {
  IConfigService,
  IContextCardGeneratorService,
  IPortalKnowledgeConfig,
  IPortalKnowledgeService,
} from "@exaix/core/types";
import type { Opt, Reason } from "@exaix/core/types";

export class PortalService {
  private portalsDir: string;
  private reservedNames = ["System", "Workspace", "Memory", "Blueprints", "Active", "Archive", "Portals"];

  constructor(
    private config: Config,
    private configService: IConfigService,
    private contextCardGenerator: IContextCardGeneratorService,
    private display: IDisplayService,
    private portalKnowledge?: IPortalKnowledgeService,
    private portalKnowledgeConfig?: IPortalKnowledgeConfig,
  ) {
    this.portalsDir = join(config.system.root as string, config.paths.portals as string);
  }

  /**
   * Add a new portal
   */
  async add(
    targetPath: string,
    alias: string,
    options?: { defaultBranch?: string; executionStrategy?: PortalExecutionStrategy },
  ): Promise<void> {
    this.validateAlias(alias);

    if (options?.defaultBranch !== undefined) {
      await this.validateBranchName(options.defaultBranch, { label: "default_branch" });
    }

    const absoluteTarget = resolve(targetPath);

    try {
      const stat = await Deno.stat(absoluteTarget);
      if (!stat.isDirectory) {
        throw new Error(`Target path is not a directory: ${absoluteTarget}`);
      }
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        throw new Error(`Target path does not exist: ${absoluteTarget}`);
      }
      throw error;
    }

    const symlinkPath = join(this.portalsDir, alias);
    try {
      await Deno.lstat(symlinkPath);
      throw new Error(`Portal '${alias}' already exists`);
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) {
        throw error;
      }
    }

    await ensureDir(this.portalsDir);

    try {
      await Deno.symlink(absoluteTarget, symlinkPath);

      await this.contextCardGenerator.generate({
        alias,
        path: absoluteTarget,
        techStack: [],
      });

      await this.configService.addPortal(alias, absoluteTarget, {
        defaultBranch: options?.defaultBranch,
        executionStrategy: options?.executionStrategy,
      });

      // Trigger portal knowledge analysis post-mount (fire-and-forget on failure)
      if (this.portalKnowledge && this.portalKnowledgeConfig?.autoAnalyzeOnMount) {
        const sysRoot = this.config.system.root as string;
        const projectsDir = join(
          sysRoot,
          this.config.paths.memory as string,
          DEFAULT_PROJECTS_MEMORY_PATH,
        );
        (async () => {
          try {
            const knowledge = await this.portalKnowledge!.analyze(alias, absoluteTarget);
            await saveKnowledge(alias, knowledge, null, projectsDir);
          } catch {
            // Analysis failure must not block mount
          }
        })();
      }

      await this.display.info("portal.added", alias, {
        target: absoluteTarget,
        symlink: `Portals/${alias}`,
        context_card: "generated",
        hint: "Restart daemon to apply changes: exactl daemon restart",
      });
    } catch (error) {
      try {
        await Deno.remove(symlinkPath);
      } catch {
        // Ignore cleanup errors
      }
      try {
        await this.configService.removePortal(alias);
      } catch {
        // Ignore config rollback errors
      }
      throw error;
    }
  }

  private async resolvePortalPaths(alias: string): Promise<{ symlinkPath: string; contextCardPath: string }> {
    const symlinkPath = join(this.portalsDir, alias);
    const contextCardPath = join(
      this.config.system.root!,
      this.config.paths.memory!,
      DEFAULT_PROJECTS_MEMORY_PATH,
      alias,
      "portal.md",
    );
    try {
      await Deno.lstat(symlinkPath);
    } catch {
      throw new Error(`Portal '${alias}' not found`);
    }
    return { symlinkPath, contextCardPath };
  }

  async list(): Promise<IPortalInfo[]> {
    const portals: IPortalInfo[] = [];

    try {
      if (!await exists(this.portalsDir)) return [];

      for await (const entry of Deno.readDir(this.portalsDir)) {
        if (!entry.isSymlink) continue;

        const symlinkPath = join(this.portalsDir, entry.name);
        const contextCardPath = join(
          this.config.system.root!,
          this.config.paths.memory!,
          DEFAULT_PROJECTS_MEMORY_PATH,
          entry.name,
          "portal.md",
        );

        let targetPath: string;
        let status: PortalStatus;

        try {
          targetPath = await Deno.readLink(symlinkPath);
          await Deno.stat(targetPath);
          status = PortalStatus.ACTIVE;
        } catch {
          targetPath = "(unknown)";
          status = PortalStatus.BROKEN;
        }

        const configPortal = this.configService.getPortal(entry.name);

        portals.push({
          alias: entry.name,
          targetPath,
          symlinkPath,
          contextCardPath,
          status,
          created: configPortal?.created,
          defaultBranch: configPortal?.default_branch,
          executionStrategy: configPortal?.execution_strategy,
        });
      }
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) {
        throw error;
      }
    }

    return portals;
  }

  async show(alias: string): Promise<IPortalDetails> {
    const { symlinkPath, contextCardPath } = await this.resolvePortalPaths(alias);

    let targetPath: string;
    let status: PortalStatus;
    let permissions: string | undefined;

    try {
      targetPath = await Deno.readLink(symlinkPath);
      const stat = await Deno.stat(targetPath);
      status = stat.isDirectory ? PortalStatus.ACTIVE : PortalStatus.BROKEN;

      try {
        for await (const _ of Deno.readDir(targetPath)) {
          break;
        }
        permissions = "Read/Write";
      } catch {
        permissions = "Read Only";
      }
    } catch {
      targetPath = await Deno.readLink(symlinkPath).catch(() => "(unknown)");
      status = PortalStatus.BROKEN;
    }

    const configPortal = this.configService.getPortal(alias);

    return {
      alias,
      targetPath,
      symlinkPath,
      contextCardPath,
      status,
      permissions,
      created: configPortal?.created,
      defaultBranch: configPortal?.default_branch,
      executionStrategy: configPortal?.execution_strategy,
    };
  }

  async remove(alias: string, options?: { keepCard?: boolean }): Promise<void> {
    const { symlinkPath, contextCardPath } = await this.resolvePortalPaths(alias);

    await Deno.remove(symlinkPath);
    await this.configService.removePortal(alias);

    if (!options?.keepCard) {
      const archivedDir = join(
        this.config.system.root,
        this.config.paths.memory,
        DEFAULT_PROJECTS_MEMORY_PATH,
        "_archived",
      );
      await ensureDir(archivedDir);

      const timestamp = new Date().toISOString().split("T")[0].replace(/-/g, "");
      const archivedPath = join(archivedDir, `${alias}_${timestamp}.md`);

      try {
        await Deno.rename(contextCardPath, archivedPath);
      } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) {
          throw error;
        }
      }
    }

    await this.display.info("portal.removed", alias, {
      context_card: options?.keepCard ? "kept" : "archived",
      hint: "Restart daemon to apply changes: exactl daemon restart",
    });
  }

  async verify(alias?: Opt<string, Reason.OptionalContext>): Promise<IVerificationResult[]> {
    const results: IVerificationResult[] = [];
    const portalsToVerify = alias ? [alias] : (await this.list()).map((p) => p.alias);

    for (const portalAlias of portalsToVerify) {
      const issues: string[] = [];
      const symlinkPath = join(this.portalsDir, portalAlias);
      const contextCardPath = join(
        this.config.system.root!,
        this.config.paths.memory!,
        DEFAULT_PROJECTS_MEMORY_PATH,
        portalAlias,
        "portal.md",
      );

      try {
        await Deno.lstat(symlinkPath);
      } catch {
        issues.push("Symlink does not exist");
      }

      let targetPath: string | null = null;
      try {
        targetPath = await Deno.readLink(symlinkPath);
        await Deno.stat(targetPath);
      } catch {
        issues.push("Target directory not found");
      }

      try {
        await Deno.stat(contextCardPath);
      } catch {
        issues.push("Context card missing");
      }

      if (targetPath) {
        try {
          for await (const _ of Deno.readDir(targetPath)) {
            break;
          }
        } catch {
          issues.push("Target directory not readable");
        }
      }

      const configPortal = this.configService.getPortal(portalAlias);
      if (!configPortal) {
        issues.push("Portal not found in configuration");
      } else if (targetPath && configPortal.target_path !== targetPath) {
        issues.push(`Config mismatch: expected ${configPortal.target_path}, found ${targetPath}`);
      }

      results.push({
        alias: portalAlias,
        status: issues.length === 0 ? VerificationStatus.OK : VerificationStatus.FAILED,
        issues: issues.length > 0 ? issues : undefined,
      });
    }

    await this.display.info("portal.verified", "portals", {
      portals_checked: results.length,
      failed: results.filter((r) => r.status === VerificationStatus.FAILED).length,
    });

    return results;
  }

  async refresh(alias: string): Promise<void> {
    const symlinkPath = join(this.portalsDir, alias);

    try {
      await Deno.lstat(symlinkPath);
    } catch {
      throw new Error(`Portal '${alias}' not found`);
    }

    const targetPath = await Deno.readLink(symlinkPath);

    await this.contextCardGenerator.generate({
      alias,
      path: targetPath,
      techStack: [],
    });

    await this.display.info("portal.refreshed", alias, {
      target: targetPath,
    });
  }

  private validateAlias(alias: string): void {
    if (alias.length === 0) {
      throw new Error("Alias cannot be empty");
    }
    if (alias.length > PORTAL_ALIAS_MAX_LENGTH) {
      throw new Error(`Alias cannot exceed ${PORTAL_ALIAS_MAX_LENGTH} characters`);
    }
    if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(alias)) {
      if (/^[0-9]/.test(alias)) {
        throw new Error("Alias cannot start with a number");
      }
      throw new Error("Alias contains invalid characters. Use alphanumeric, dash, underscore only.");
    }
    if (this.reservedNames.includes(alias)) {
      throw new Error(`Alias '${alias}' is reserved`);
    }
  }

  /**
   * Load persisted portal knowledge (knowledge.json) for the given alias.
   * Returns `null` when no analysis has been run yet.
   */
  async getKnowledge(portalAlias: string): Promise<IPortalKnowledge | null> {
    const symlinkPath = join(this.portalsDir, portalAlias);
    try {
      await Deno.lstat(symlinkPath);
    } catch {
      throw new Error(`Portal '${portalAlias}' not found`);
    }

    const projectsDir = join(
      this.config.system.root as string,
      this.config.paths.memory as string,
      DEFAULT_PROJECTS_MEMORY_PATH,
    );
    return loadKnowledge(portalAlias, projectsDir);
  }

  async analyze(
    alias: string,
    options?: { mode?: PortalAnalysisMode; force?: boolean },
  ): Promise<string> {
    const symlinkPath = join(this.portalsDir, alias);

    try {
      await Deno.lstat(symlinkPath);
    } catch {
      throw new Error(`Portal '${alias}' not found`);
    }

    const portalPath = await Deno.readLink(symlinkPath);

    if (!this.portalKnowledge) {
      throw new Error("Portal knowledge service is not available");
    }

    const mode = options?.mode;
    const knowledge = await this.portalKnowledge.analyze(alias, portalPath, mode);

    // Persist knowledge.json
    const sysRoot = this.config.system.root as string;
    const projectsDir = join(
      sysRoot,
      this.config.paths.memory as string,
      DEFAULT_PROJECTS_MEMORY_PATH,
    );
    await saveKnowledge(alias, knowledge, null, projectsDir);

    await this.display.info("portal.analyzed", alias, {
      mode: knowledge.metadata.mode,
      filesScanned: knowledge.metadata.filesScanned,
      durationMs: knowledge.metadata.durationMs,
    });

    return [
      `Portal: ${alias}`,
      `Mode:   ${knowledge.metadata.mode}`,
      `Files scanned: ${knowledge.metadata.filesScanned}`,
      `Duration: ${knowledge.metadata.durationMs}ms`,
    ].join("\n");
  }

  private async validateBranchName(
    branch: string,
    opts?: Opt<{ label: string }, Reason.OptionalInput>,
  ): Promise<void> {
    const label = opts!.label;
    if (typeof branch !== "string" || branch.trim().length === 0) {
      throw new Error(`Invalid ${label}: must be non-empty string`);
    }

    const cmd = new Deno.Command("git", {
      args: ["check-ref-format", "--branch", branch],
      stdout: "null",
      stderr: "piped",
    });

    const { success } = await cmd.output();
    if (!success) {
      throw new Error(`Invalid ${label}: '${branch}' is not a safe git branch name`);
    }
  }
}
