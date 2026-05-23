/**
 * @module CLIBase
 * @path packages/cli/src/base.ts
 * @related-files []
 * @description Provides the abstract base class for all CLI command handlers, offering shared utilities for configuration, database access, user identity, and YAML frontmatter processing.
 * @architectural-layer CLI
 * @ungrounded
 */

import type {
  IArchiveService,
  ICliApplicationContext,
  IContextCardGeneratorService,
  ICostTracker,
  IFlowValidatorService,
  IMemoryBankService,
  IMemoryEmbeddingService,
  IMemoryExtractorService,
  IMemoryService,
  IPlanService,
  IPortalService,
  IRequestService,
  ISkillsService,
} from "./types/cli_context.ts";
import type { Config } from "@exaix/schemas/config.ts";

export interface ICommandContext extends ICliApplicationContext {}

export abstract class BaseCommand {
  protected context: ICliApplicationContext;
  private _userIdentity: string | null = null;

  constructor(context: ICommandContext) {
    this.context = context;
  }

  protected get config(): Config {
    return this.context.config.getAll();
  }

  protected get db(): ICliApplicationContext["db"] {
    return this.context.db;
  }

  protected get display(): ICliApplicationContext["display"] {
    return this.context.display;
  }

  protected get logger(): ICliApplicationContext["display"] {
    return this.context.display;
  }

  protected getActionLogger(): ICliApplicationContext["display"] {
    return this.context.display;
  }

  protected get git(): ICliApplicationContext["git"] {
    return this.context.git;
  }

  protected get memory(): IMemoryService {
    if (!this.context.memory) throw new Error("Memory service not initialized");
    return this.context.memory;
  }

  protected get memoryBank(): IMemoryBankService {
    if (!this.context.memoryBank) throw new Error("Memory Bank service not initialized");
    return this.context.memoryBank;
  }

  protected get extractor(): IMemoryExtractorService {
    if (!this.context.extractor) throw new Error("Memory Extractor service not initialized");
    return this.context.extractor;
  }

  protected get embedding(): IMemoryEmbeddingService {
    if (!this.context.embeddings) throw new Error("Memory Embedding service not initialized");
    return this.context.embeddings;
  }

  protected get archive(): IArchiveService {
    if (!this.context.archive) throw new Error("Archive service not initialized");
    return this.context.archive;
  }

  protected get flowValidator(): IFlowValidatorService {
    if (!this.context.flowValidator) throw new Error("Flow Validator service not initialized");
    return this.context.flowValidator;
  }

  protected get contextCardGenerator(): IContextCardGeneratorService {
    if (!this.context.contextCards) throw new Error("Context Card Generator service not initialized");
    return this.context.contextCards;
  }

  protected get skills(): ISkillsService {
    if (!this.context.skills) throw new Error("Skills service not initialized");
    return this.context.skills;
  }

  protected get portals(): IPortalService {
    if (!this.context.portals) throw new Error("Portals service not initialized");
    return this.context.portals;
  }

  protected get requests(): IRequestService {
    if (!this.context.requests) throw new Error("Requests service not initialized");
    return this.context.requests;
  }

  protected get plans(): IPlanService {
    if (!this.context.plans) throw new Error("Plans service not initialized");
    return this.context.plans;
  }

  protected get cost(): ICostTracker {
    if (!this.context.cost) throw new Error("Cost tracking service not initialized");
    return this.context.cost;
  }

  protected async getUserIdentity(): Promise<string> {
    if (this._userIdentity) {
      return this._userIdentity;
    }

    try {
      const _branchIdent = await this.context.git.getCurrentBranch();
      this._userIdentity = "cli-user";
    } catch {
      this._userIdentity = "unknown-user";
    }

    return this._userIdentity;
  }

  protected extractFrontmatter(content: string): Record<string, string | boolean | number> {
    const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*/);
    if (!match) {
      return {};
    }

    const frontmatter: Record<string, string | boolean | number> = {};
    const lines = match[1].split("\n");

    for (const line of lines) {
      const colonIndex = line.indexOf(":");
      if (colonIndex === -1) continue;

      const key = line.substring(0, colonIndex).trim();
      let value = line.substring(colonIndex + 1).trim();

      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.substring(1, value.length - 1);
      }

      if (value.toLowerCase() === "true") {
        frontmatter[key] = true;
      } else if (value.toLowerCase() === "false") {
        frontmatter[key] = false;
      } else if (!isNaN(Number(value)) && value.trim() !== "") {
        frontmatter[key] = Number(value);
      } else {
        frontmatter[key] = value;
      }
    }

    return frontmatter;
  }

  protected serializeFrontmatter(frontmatter: Record<string, string | boolean | number>): string {
    const lines = ["---"];
    for (const [key, rawValue] of Object.entries(frontmatter)) {
      const value = String(rawValue);
      const needsQuotes = typeof rawValue === "string" && (value.includes(":") ||
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value));

      if (needsQuotes) {
        lines.push(`${key}: "${value}"`);
      } else {
        lines.push(`${key}: ${value}`);
      }
    }
    lines.push("---");
    return lines.join("\n");
  }

  protected updateFrontmatter(
    content: string,
    updates: Record<string, string | boolean | number>,
  ): string {
    const frontmatter = this.extractFrontmatter(content);
    const updated = { ...frontmatter, ...updates };
    const body = content.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, "");
    return this.serializeFrontmatter(updated) + "\n" + body;
  }

  protected validateFrontmatter(
    frontmatter: Record<string, string | boolean | number>,
    required: string[],
    filePath: string,
  ): void {
    for (const field of required) {
      if (!frontmatter[field]) {
        throw new Error(
          `Invalid file format: missing required field '${field}' in ${filePath}`,
        );
      }
    }
  }

  protected formatTimestamp(isoString: string): string {
    const date = new Date(isoString);
    return date.toLocaleString();
  }

  protected truncate(str: string, maxLength: number): string {
    if (str.length <= maxLength) return str;
    return str.substring(0, maxLength - 3) + "...";
  }

  protected getCommandLine(): string[] {
    return Deno.args;
  }

  protected getCommandLineString(): string {
    return `exactl ${Deno.args.join(" ")}`;
  }

  public getConfig(): Config {
    return this.config;
  }
}
