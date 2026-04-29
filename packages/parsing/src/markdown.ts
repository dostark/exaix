/**
 * @module ParsingPackageFrontmatterParser
 * @path packages/parsing/src/markdown.ts
 * @description Frontmatter parser implementation for the @exaix/parsing package.
 * @architectural-layer Parsing
 * @related-files [src/parsers/markdown.ts, @exaix/schemas/request.ts]
 */
import { parse as parseYaml } from "@std/yaml";
import { type Request, RequestSchema } from "@exaix/schemas/request.ts";
import type { JSONValue } from "@exaix/core";
import { FRONTMATTER_REGEX } from "./constants.ts";
import { SYSTEM_ACTIVITY_ACTOR } from "@exaix/core";
import { ParserActivityActionType } from "./enums.ts";

export interface IParsedRequest {
  request: Request;
  body: string;
}

export interface IDatabaseService {
  logActivity(
    actor: string,
    actionType: string,
    target: string | null,
    payload: Record<string, JSONValue>,
    traceId?: string,
    actorType?: string | null,
    identityId?: string | null,
    agentKind?: string | null,
    promptTokens?: number,
    completionTokens?: number,
    costUsd?: number,
  ): void;
}

export class FrontmatterParser {
  private readonly db?: IDatabaseService;

  constructor(db?: IDatabaseService) {
    this.db = db;
  }

  parse(markdown: string, filePath?: string): IParsedRequest {
    const { frontmatter, body } = this.extractFrontmatter(markdown);

    const result = RequestSchema.safeParse(frontmatter);
    if (!result.success) {
      const errors = result.error.issues
        .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
        .join("\n");

      this.logActivity(ParserActivityActionType.REQUEST_VALIDATION_FAILED, {
        file_path: filePath ?? null,
        errors,
      });

      throw new Error(`Request validation failed:\n${errors}`);
    }

    this.logActivity(ParserActivityActionType.REQUEST_VALIDATED, {
      file_path: filePath ?? null,
      trace_id: result.data.trace_id,
      identity_id: result.data.identity_id,
      status: result.data.status,
    });

    return {
      request: result.data,
      body,
    };
  }

  private logActivity(actionType: string, payload: Record<string, JSONValue>): void {
    if (!this.db) {
      return;
    }

    try {
      this.db.logActivity(
        SYSTEM_ACTIVITY_ACTOR,
        actionType,
        (payload.file_path as string) ?? null,
        payload,
        undefined,
        null,
        null,
        null,
        0,
        0,
        0,
      );
    } catch (_error) {
      // Preserve parser behavior even if logging fails.
    }
  }

  private extractFrontmatter(markdown: string): { frontmatter: MarkdownFrontmatter; body: string } {
    const match = markdown.match(FRONTMATTER_REGEX);

    if (!match) {
      throw new Error("No frontmatter found: markdown must start with --- and end with ---");
    }

    const yamlContent = match[1];
    const body = match[2] || "";

    try {
      const frontmatter = parseYaml(yamlContent) as MarkdownFrontmatter;
      if (!frontmatter || typeof frontmatter !== "object") {
        throw new Error("Frontmatter must be a YAML object");
      }
      return { frontmatter, body };
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Failed to parse YAML frontmatter: ${error.message}`);
      }
      throw error;
    }
  }
}

interface MarkdownFrontmatter {
  [key: string]: string | number | boolean | string[] | null | undefined;
}
