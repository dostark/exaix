/**
 * @module RequestParser
 * @path packages/request/src/processing/parser.ts
 * @description Parses request files, extracting YAML frontmatter and body while normalizing status.
 * @architectural-layer Services
 * @related-files ["packages/request/src/processor.ts", "packages/core/src/status/request_status.ts"]
 */
import { parse as parseYaml } from "@std/yaml";
import { exists } from "@std/fs";
import type { IEventLogger } from "@exaix/core/logger";
import { DomainEventType } from "@exaix/core/events";
import type { IParsedRequestFile, IRequestFrontmatter } from "@exaix/core/request";
import { coerceRequestStatus } from "@exaix/core/status";

export class RequestParser {
  constructor(private readonly logger: IEventLogger) {}

  /**
   * Parse a request file and extract frontmatter and body
   */
  async parse(filePath: string): Promise<IParsedRequestFile | null> {
    // Check file exists
    if (!await exists(filePath)) {
      await this.logger.error(DomainEventType.FrontmatterNotFound, filePath, {});
      return null;
    }

    try {
      const content = await Deno.readTextFile(filePath);

      // Extract YAML frontmatter between --- delimiters
      const yamlMatch = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
      if (!yamlMatch) {
        await this.logger.error(DomainEventType.FrontmatterInvalid, filePath, {
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

      // Runtime guards for structured fields — strip malformed values.
      await this.validateAcceptanceCriteria(frontmatter, filePath);
      await this.validateExpectedOutcomes(frontmatter, filePath);
      await this.validateScopeField(frontmatter, filePath);

      // Validate required fields
      if (!frontmatter.trace_id) {
        await this.logger.error(DomainEventType.FrontmatterMissingTraceId, filePath, {});
        return null;
      }

      return {
        frontmatter,
        body,
        rawContent: content,
      };
    } catch (error) {
      await this.logger.error(DomainEventType.FrontmatterParseFailed, filePath, {
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
      await this.logger.warn(DomainEventType.FrontmatterAcceptanceCriteriaMalformed, filePath, {});
      fm.acceptance_criteria = undefined;
    }
  }

  /** Strip expected_outcomes if not a string array; log a warning. */
  private async validateExpectedOutcomes(fm: IRequestFrontmatter, filePath: string): Promise<void> {
    const value = fm.expected_outcomes;
    if (value === undefined) return;
    const valid = Array.isArray(value) && (value as unknown[]).every((v) => typeof v === "string");
    if (!valid) {
      await this.logger.warn(DomainEventType.FrontmatterExpectedOutcomesMalformed, filePath, {});
      fm.expected_outcomes = undefined;
    }
  }

  /** Strip the scope frontmatter field if it is not a plain object; log a warning. */
  private async validateScopeField(fm: IRequestFrontmatter, filePath: string): Promise<void> {
    const value = fm.scope;
    if (value === undefined) return;
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      await this.logger.warn(DomainEventType.FrontmatterScopeMalformed, filePath, {});
      fm.scope = undefined;
    }
  }
}
