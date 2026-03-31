/**
 * @module RequestParser
 * @path src/services/request_processing/request_parser.ts
 * @description Parses request files, extracting YAML frontmatter and body while normalizing status.
 * @architectural-layer Services
 * * @related-files [src/services/request_processor.ts, src/requests/request_status.ts]
 */
import { parse as parseYaml } from "@std/yaml";
import { exists } from "@std/fs";
import type { EventLogger } from "../core/event_logger.ts";
import type { IRequestFrontmatter, ParsedRequestFile } from "./types.ts";
import { coerceRequestStatus } from "../../shared/status/request_status.ts";

export class RequestParser {
  constructor(private readonly logger: EventLogger) {}

  /**
   * Parse a request file and extract frontmatter and body
   */
  async parse(filePath: string): Promise<ParsedRequestFile | null> {
    // Check file exists
    if (!await exists(filePath)) {
      await this.logger.error("file.not_found", filePath, {});
      return null;
    }

    try {
      const content = await Deno.readTextFile(filePath);

      // Extract YAML frontmatter between --- delimiters
      const yamlMatch = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
      if (!yamlMatch) {
        await this.logger.error("frontmatter.invalid", filePath, {
          error: "Missing or malformed --- delimiters",
        });
        return null;
      }

      const yamlContent = yamlMatch[1];
      const body = yamlMatch[2] || "";

      // Parse YAML
      const frontmatter = parseYaml(yamlContent) as IRequestFrontmatter;

      // Normalize status to canonical set (guards against malformed/unknown values)
      frontmatter.status = coerceRequestStatus(frontmatter.status);

      // Runtime guards for Phase 49 structured fields — strip malformed values.
      await this.validateAcceptanceCriteria(frontmatter, filePath);
      await this.validateExpectedOutcomes(frontmatter, filePath);
      await this.validateScopeField(frontmatter, filePath);

      // Validate required fields
      if (!frontmatter.trace_id) {
        await this.logger.error("frontmatter.missing_trace_id", filePath, {});
        return null;
      }

      return {
        frontmatter,
        body,
        rawContent: content,
      };
    } catch (error) {
      await this.logger.error("file.parse_failed", filePath, {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /** Strip acceptance_criteria if not a string array; log a warning. */
  private async validateAcceptanceCriteria(fm: IRequestFrontmatter, filePath: string): Promise<void> {
    const value = fm.acceptance_criteria;
    if (value === undefined) return;
    const valid = Array.isArray(value) && (value as unknown[]).every((v) => typeof v === "string");
    if (!valid) {
      await this.logger.warn("frontmatter.acceptance_criteria.malformed", filePath, {});
      fm.acceptance_criteria = undefined;
    }
  }

  /** Strip expected_outcomes if not a string array; log a warning. */
  private async validateExpectedOutcomes(fm: IRequestFrontmatter, filePath: string): Promise<void> {
    const value = fm.expected_outcomes;
    if (value === undefined) return;
    const valid = Array.isArray(value) && (value as unknown[]).every((v) => typeof v === "string");
    if (!valid) {
      await this.logger.warn("frontmatter.expected_outcomes.malformed", filePath, {});
      fm.expected_outcomes = undefined;
    }
  }

  /** Strip the scope frontmatter field if it is not a plain object; log a warning. */
  private async validateScopeField(fm: IRequestFrontmatter, filePath: string): Promise<void> {
    const value = fm.scope;
    if (value === undefined) return;
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      await this.logger.warn("frontmatter.scope.malformed", filePath, {});
      fm.scope = undefined;
    }
  }
}
