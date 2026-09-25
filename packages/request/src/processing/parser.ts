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
import type { Opt, Reason } from "@exaix/core/types";
import { DomainEventType } from "@exaix/core/events";
import type { IParsedRequestFile, IRequestFrontmatter } from "@exaix/core/request";
import { coerceRequestStatus } from "@exaix/core/status";
import {
  DECLARATION_FIELD_EFFORT,
  DECLARATION_FIELD_THINKING,
  type DeclarationField,
  EffortDeclarationSchema,
  ThinkingDeclarationSchema,
} from "@exaix/schemas/model_intent.ts";

/** A declaration rejected at the request-file parse boundary — surfaces the failure as a
 *  typed result (never a swallowed error) so the processor can fail the file visibly and
 *  correlate the RequestFailed event to the request's trace (GAP-7). */
export interface IRequestParseRejection {
  rejected: true;
  filePath: string;
  traceId?: string;
  field: DeclarationField;
}

export function isRequestParseRejection(
  value: IParsedRequestFile | IRequestParseRejection,
): value is IRequestParseRejection {
  return (value as IRequestParseRejection).rejected === true && "field" in value;
}

export class RequestParser {
  constructor(private readonly logger: IEventLogger) {}

  /**
   * Parse a request file and extract frontmatter and body.
   */
  async parse(filePath: string): Promise<IParsedRequestFile | IRequestParseRejection | null> {
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
      this.validateEffortThinkingBoundary(frontmatter);

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
      // A rejected declaration is a typed outcome, not a parse failure: no second
      // FrontmatterParseFailed log, the processor owns the visible failure (GAP-7).
      if (error instanceof RequestFrontmatterRejectedError) {
        return {
          rejected: true,
          filePath,
          traceId: error.traceId,
          field: error.field,
        };
      }
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

  /** Reject an invalid declaration-time effort/thinking value, naming the field — requests
   *  are file-driven, so this covers the manual/hand-written channel the CLI-level check can
   *  never reach (GAP-5). The rejection surfaces as a typed IRequestParseRejection; the
   *  processor owns the visible RequestFailed + status transition (GAP-7). */
  private validateEffortThinkingBoundary(fm: IRequestFrontmatter): void {
    if (fm.effort !== undefined) {
      const parsedEffort = EffortDeclarationSchema.safeParse(fm.effort);
      if (!parsedEffort.success) {
        throw new RequestFrontmatterRejectedError(DECLARATION_FIELD_EFFORT, fm.trace_id);
      }
      fm.effort = parsedEffort.data;
    }
    if (fm.thinking !== undefined) {
      const parsedThinking = ThinkingDeclarationSchema.safeParse(fm.thinking);
      if (!parsedThinking.success) {
        throw new RequestFrontmatterRejectedError(DECLARATION_FIELD_THINKING, fm.trace_id);
      }
      fm.thinking = parsedThinking.data;
    }
  }
}

/** Signals a rejected request-file declaration; parse() converts it into a typed
 *  IRequestParseRejection so processing can stop before any provider call while the
 *  processor records a visible, trace-correlated failure (GAP-7). */
class RequestFrontmatterRejectedError extends Error {
  constructor(
    readonly field: DeclarationField,
    readonly traceId?: Opt<string, Reason.TraceAbsent>,
  ) {
    super(`Invalid '${field}' value in request file`);
    this.name = "RequestFrontmatterRejectedError";
  }
}
