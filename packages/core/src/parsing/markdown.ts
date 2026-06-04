/**
 * @module CoreParsingPackageFrontmatterParser
 * @path packages/core/src/parsing/markdown.ts
 * @description Frontmatter parser implementation for the @exaix/parsing package.
 * @architectural-layer Parsing
 * @related-files [@exaix/schemas/request.ts]
 */
import { parse as parseYaml } from "@std/yaml";
import { type Request, RequestSchema } from "@exaix/schemas";

import { FRONTMATTER_REGEX } from "./constants.ts";
import { ParserActivityActionType } from "./enums.ts";
import type { IEventLogger } from "@exaix/core/logger";

export interface IParsedRequest {
  request: Request;
  body: string;
}

export class FrontmatterParser {
  private readonly logger?: IEventLogger;

  constructor(logger?: IEventLogger) {
    this.logger = logger;
  }

  parse(markdown: string, filePath?: string): IParsedRequest {
    const { frontmatter, body } = this.extractFrontmatter(markdown);

    const result = RequestSchema.safeParse(frontmatter);
    if (!result.success) {
      const errors = result.error.issues
        .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
        .join("\n");

      this.logger?.info(
        ParserActivityActionType.REQUEST_VALIDATION_FAILED,
        filePath ?? null,
        { errors },
      );

      throw new Error(`Request validation failed:\n${errors}`);
    }

    this.logger?.info(
      ParserActivityActionType.REQUEST_VALIDATED,
      filePath ?? null,
      {
        trace_id: result.data.trace_id,
        identity_id: result.data.identity_id,
        status: result.data.status,
      },
    );

    return {
      request: result.data,
      body,
    };
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
