/**
 * @module PortalContextBuilder
 * @path packages/request/src/portal_context_builder.ts
 * @description Builds portal-derived prompt context: a capped directory file
 * listing for a configured portal alias, and portal knowledge context resolved
 * via relevance-based retrieval with fallback to a capped summary. Extracted
 * from RequestProcessor (god-object decomposition,
 * .copilot/skills/refactor/SKILL.md step d) since this logic depends only on
 * config.portals and an optional portalKnowledgeService — no other
 * RequestProcessor field.
 * @architectural-layer Services
 * @related-files ["packages/request/src/processor.ts"]
 */
import { join } from "@std/path";
import type { Config } from "@exaix/schemas/config.ts";
import type { IPortalKnowledgeService } from "@exaix/core/types";
import type { IPortalKnowledge } from "@exaix/schemas/portal_knowledge.ts";
import type { IEventLogger } from "@exaix/core/logger";
import type { Opt, Reason } from "@exaix/core/types";
import { PORTAL_KNOWLEDGE_PROMPT_MAX_LINES } from "@exaix/core";
import { buildPortalContextBlock } from "@exaix/core/func";
import { buildPortalKnowledgeSummary } from "./processor.ts";

export interface IPortalContextBuilderConfig {
  config: Config;
  portalKnowledgeService?: IPortalKnowledgeService;
}

export interface IPortalContextBuilder {
  buildFileContext(
    portalAlias: Opt<string, Reason.OptionalContext>,
    traceLogger?: Opt<IEventLogger, Reason.OptionalDependency>,
  ): Promise<string | null>;
  resolveKnowledgeContext(
    body: string,
    portalAlias: Opt<string, Reason.OptionalInput>,
    portalKnowledge: IPortalKnowledge,
  ): Promise<string>;
}

interface IScanContext {
  files: string[];
  MAX_FILES: number;
  MAX_DEPTH: number;
}

export class PortalContextBuilder implements IPortalContextBuilder {
  private readonly config: Config;
  private readonly portalKnowledgeService?: IPortalKnowledgeService;

  constructor(deps: IPortalContextBuilderConfig) {
    this.config = deps.config;
    this.portalKnowledgeService = deps.portalKnowledgeService;
  }

  async buildFileContext(
    portalAlias: Opt<string, Reason.OptionalContext>,
    traceLogger?: Opt<IEventLogger, Reason.OptionalDependency>,
  ): Promise<string | null> {
    if (!portalAlias) return null;

    const portal = this.config.portals.find((p) => p.alias === portalAlias);
    if (!portal) {
      traceLogger?.warn("portal.context.not_found", portalAlias, { portal: portalAlias });
      return null;
    }

    const fileSummary = await this.getPortalFileSummary(portal.target_path);

    return buildPortalContextBlock({
      portalAlias,
      portalRoot: portal.target_path,
      fileList: fileSummary,
    });
  }

  async resolveKnowledgeContext(
    body: string,
    portalAlias: Opt<string, Reason.OptionalInput>,
    portalKnowledge: IPortalKnowledge,
  ): Promise<string> {
    const fallback = buildPortalKnowledgeSummary(portalKnowledge);
    if (!this.portalKnowledgeService || !portalAlias) return fallback;

    const portalPath = (this.config.portals ?? []).find(
      (p) => p.alias === portalAlias,
    )?.target_path;
    if (!portalPath) return fallback;

    try {
      const relevant = await this.portalKnowledgeService.getRelevantContext(
        body,
        portalPath,
        PORTAL_KNOWLEDGE_PROMPT_MAX_LINES * 50,
      );
      return relevant ?? fallback;
    } catch {
      return fallback;
    }
  }

  private async getPortalFileSummary(portalPath: string): Promise<string> {
    const files: string[] = [];
    const context: IScanContext = { files, MAX_FILES: 200, MAX_DEPTH: 3 };

    try {
      await this.scanPortalDirectory(portalPath, 0, context);
    } catch {
      return "Unable to list portal directory.";
    }

    if (files.length === 0) return "Portal directory is empty.";
    return files.join("\n");
  }

  private async scanPortalDirectory(
    dir: string,
    currentDepth: number,
    context: IScanContext,
  ): Promise<void> {
    if (currentDepth > context.MAX_DEPTH || context.files.length >= context.MAX_FILES) return;

    try {
      const entries = [];
      for await (const entry of Deno.readDir(dir)) {
        entries.push(entry);
      }

      // Sort entries: directories first, then files alphabetically
      entries.sort((a, b) => {
        if (a.isDirectory && !b.isDirectory) return -1;
        if (!a.isDirectory && b.isDirectory) return 1;
        return a.name.localeCompare(b.name);
      });

      for (const entry of entries) {
        if (context.files.length >= context.MAX_FILES) break;
        if (entry.name.startsWith(".")) continue;

        const indent = "  ".repeat(currentDepth);
        context.files.push(`${indent}${entry.isDirectory ? "[DIR] " : "- "}${entry.name}`);

        if (entry.isDirectory) {
          await this.scanPortalDirectory(join(dir, entry.name), currentDepth + 1, context);
        }
      }
    } catch {
      // Ignore read errors for specific directories
    }
  }
}
