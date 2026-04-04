/**
 * @module FrontmatterParser
 * @path src/parsers/markdown.ts
 * @description Extracts and validates YAML frontmatter from markdown files, ensuring compliance with RequestSchema.
 * @architectural-layer Parsers
 * * @related-files [src/schemas/request.ts, src/services/request/request_processor.ts]
 */
import { parse as parseYaml } from "@std/yaml";
import { type Request, RequestSchema } from "../shared/schemas/request.ts";
import type { DatabaseService } from "../services/core/db.ts";
import { ActivityActor } from "../shared/enums.ts";
import { JSONValue, toSafeJson } from "../shared/types/json.ts";

/**
 * Result of parsing a request markdown file
 */
export interface IParsedRequest {
  request: Request;
  body: string;
}

/**
 * FrontmatterParser - Extracts and validates YAML frontmatter from markdown files
 *
 * Implements Step 2.2 of the Implementation Plan:
 * - Extracts YAML frontmatter between --- delimiters
 * - Parses YAML to JavaScript object
 * - Validates against RequestSchema using Zod
 * - Logs validation events to IActivity Journal (if database provided)
 */
export class FrontmatterParser {
  private db?: DatabaseService;

  constructor(db?: DatabaseService) {
    this.db = db;
  }

  /**
   * Parse markdown content and extract validated frontmatter
   */
  parse(markdown: string, filePath?: string): IParsedRequest {
    // Stage 1: Extract YAML frontmatter
    const { frontmatter, body } = this.extractFrontmatter(markdown);

    // Stage 2: Validate with Zod
    const result = RequestSchema.safeParse(frontmatter);

    if (!result.success) {
      // Build detailed error message
      const errors = result.error.issues.map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`).join("\n");

      // Log validation failure to database
      this.logActivity("request.validation_failed", {
        file_path: filePath ?? null,
        errors: toSafeJson(result.error.issues),
      });

      throw new Error(`Request validation failed:\n${errors}`);
    }

    // Log successful validation to database
    this.logActivity("request.validated", {
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

  /**
   * Log activity to the IActivity Journal (if database is available)
   */
  private logActivity(actionType: string, payload: Record<string, JSONValue>) {
    if (!this.db) {
      return; // No database, skip logging
    }

    try {
      this.db.logActivity(
        ActivityActor.SYSTEM,
        actionType,
        payload.file_path as string || null,
        payload,
        undefined, // No specific trace_id for validation operations
        null, // No identity_id (system operation)
      );
    } catch (error) {
      // Log error but don't fail the parsing
      console.error("Failed to log activity:", error);
    }
  }

  /**
   * Extract YAML frontmatter and body from markdown
   */
  private extractFrontmatter(markdown: string): { frontmatter: MarkdownFrontmatter; body: string } {
    // Match YAML frontmatter between --- delimiters
    const yamlRegex = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;
    const match = markdown.match(yamlRegex);

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

/**
 * Parsed frontmatter data from markdown
 */
interface MarkdownFrontmatter {
  [key: string]: string | number | boolean | string[] | null | undefined;
}
