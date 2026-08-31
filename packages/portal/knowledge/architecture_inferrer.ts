/**
 * @module ArchitectureInferrer
 * @path packages/portal/knowledge/architecture_inferrer.ts
 * @description Strategy 5 of PortalKnowledgeService: uses an LLM to produce a
 * Markdown architecture overview from combined strategy outputs (directory tree,
 * key files, detected conventions, config summary, dependency summary).
 * Retries up to ARCHITECTURE_INFERRER_MAX_RETRIES times with exponential backoff.
 * Falls back to a heuristic overview on all LLM failures.
 * Only runs in `standard` and `deep` analysis modes — never in `quick`.
 * @architectural-layer Services
 * @related-files [packages/portal/knowledge/pattern_detector.ts, packages/portal/knowledge/key_file_identifier.ts]
 */

import { z, type ZodType } from "zod";
import type { IModelOptions, IModelProvider } from "@exaix/ai";

import type { IValidationResult } from "@exaix/core/types";
import type { ICodeConvention, IFileSignificance } from "@exaix/schemas";

import {
  ARCHITECTURE_INFERRER_BACKOFF_MS,
  ARCHITECTURE_INFERRER_BACKOFF_MULTIPLIER,
  ARCHITECTURE_INFERRER_MAX_FILE_TOKENS,
  ARCHITECTURE_INFERRER_MAX_RETRIES,
  ARCHITECTURE_INFERRER_TOKEN_BUDGET,
  sleep,
} from "@exaix/core";
import type { ILogger, Opt, Reason } from "@exaix/core/types";

// Types

/** Minimal validator interface: only the method used by ArchitectureInferrer. */
export interface IArchitectureValidator {
  validate<T>(content: string, schema: ZodType<T>): IValidationResult<T>;
}

/** Input bag for a single inference call. */
export interface IArchitectureInferrerInput {
  portalPath: string;
  directoryTree: string[];
  keyFiles: IFileSignificance[];
  conventions: ICodeConvention[];
  configSummary: string;
  dependencySummary: string;
  /** Optional file contents keyed by path relative to portalPath. */
  fileContents?: Record<string, string>;
}

// Internal constants

/** Characters-per-token estimate used for budget enforcement. */
const CHARS_PER_TOKEN = 4;

/** Temperature for deterministic LLM output. */
const TEMPERATURE_ZERO = 0;

/** Zod schema used to validate the raw LLM response (non-empty string). */
const OverviewSchema = z.string().min(1);

/** Max directory-tree entries included in the prompt. */
const MAX_TREE_ENTRIES = 200;

const SYSTEM_PROMPT_PREFIX = `You are a senior software architect.
Analyse the following information about a codebase and write a concise Markdown
architecture overview (2-4 paragraphs). Describe the high-level structure,
primary design patterns, and key components. Do NOT output JSON — plain Markdown
only.

`;

// ArchitectureInferrer

export class ArchitectureInferrer {
  private readonly _provider: IModelProvider;
  private readonly _validator: IArchitectureValidator;
  private readonly _logger?: ILogger;

  /** Set to true when all retry attempts failed and fallback was used. */
  architectureInferenceFailed = false;

  constructor(
    provider: IModelProvider,
    validator: IArchitectureValidator,
    logger?: Opt<ILogger, Reason.OptionalDependency>,
  ) {
    this._provider = provider;
    this._validator = validator;
    this._logger = logger;
  }

  /** Retries with exponential backoff; returns a heuristic fallback overview when all
   *  retries fail. */
  async infer(input: IArchitectureInferrerInput): Promise<string> {
    const prompt = this._buildPrompt(input);
    const options: IModelOptions = { temperature: TEMPERATURE_ZERO };

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= ARCHITECTURE_INFERRER_MAX_RETRIES; attempt++) {
      try {
        const result = await this._provider.generate(prompt, options);
        const validated = this._validator.validate<string>(result.content, OverviewSchema);
        if (validated.success && validated.value) {
          this.architectureInferenceFailed = false;
          return validated.value;
        }
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < ARCHITECTURE_INFERRER_MAX_RETRIES) {
          const backoffMs = ARCHITECTURE_INFERRER_BACKOFF_MS *
            Math.pow(ARCHITECTURE_INFERRER_BACKOFF_MULTIPLIER, attempt - 1);
          await sleep(backoffMs);
        }
      }
    }

    this.architectureInferenceFailed = true;
    this._logger?.error(
      "ArchitectureInferrer failed after all retries",
      lastError ?? undefined,
    );
    return buildFallbackOverview(input);
  }

  // Private helpers

  private _buildPrompt(input: IArchitectureInferrerInput): string {
    const budgetChars = ARCHITECTURE_INFERRER_TOKEN_BUDGET * CHARS_PER_TOKEN;

    let prompt = SYSTEM_PROMPT_PREFIX;

    // Directory tree (capped)
    const tree = input.directoryTree.slice(0, MAX_TREE_ENTRIES);
    prompt += `## Directory Structure\n\`\`\`\n${tree.join("\n")}\n\`\`\`\n\n`;

    // Key files
    if (input.keyFiles.length > 0) {
      prompt += `## Key Files\n`;
      for (const kf of input.keyFiles) {
        prompt += `- ${kf.path} (${kf.role}): ${kf.description}\n`;
      }
      prompt += "\n";
    }

    // Conventions
    if (input.conventions.length > 0) {
      prompt += `## Detected Conventions\n`;
      for (const c of input.conventions) {
        prompt += `- ${c.name}: ${c.description}\n`;
      }
      prompt += "\n";
    }

    // Config summary
    if (input.configSummary) {
      prompt += `## Config Summary\n${input.configSummary}\n\n`;
    }

    // Dependency summary
    if (input.dependencySummary) {
      prompt += `## Dependencies\n${input.dependencySummary}\n\n`;
    }

    // File contents — truncate per-file, drop files when over budget
    if (input.fileContents) {
      const sortedFiles = this._sortFilesBySignificance(
        Object.keys(input.fileContents),
        input.keyFiles,
      );

      prompt += `## Selected File Contents\n`;
      for (const filePath of sortedFiles) {
        const raw = input.fileContents[filePath] ?? "";
        const lines = raw.split("\n").slice(0, ARCHITECTURE_INFERRER_MAX_FILE_TOKENS);
        const snippet = lines.join("\n");
        const candidate = `\n### ${filePath}\n\`\`\`\n${snippet}\n\`\`\`\n`;

        if ((prompt.length + candidate.length) > budgetChars) break;
        prompt += candidate;
      }
    }

    return prompt;
  }

  /** High-significance files (in keyFiles) come first, so the budget-cap in
   *  _buildPrompt drops the least important files. */
  private _sortFilesBySignificance(
    files: string[],
    keyFiles: IFileSignificance[],
  ): string[] {
    const keySet = new Set(keyFiles.map((k) => k.path));
    const primary = files.filter((f) => keySet.has(f));
    const secondary = files.filter((f) => !keySet.has(f));
    return [...primary, ...secondary];
  }
}

/** Fallback used when all LLM retry attempts fail. */
export function buildFallbackOverview(input: IArchitectureInferrerInput): string {
  const lines: string[] = [];

  lines.push("# Architecture Overview (Heuristic)");
  lines.push("");
  lines.push("> This overview was generated heuristically because the LLM-based inference did not produce a result.");

  if (input.configSummary) {
    lines.push("");
    lines.push("## Technology Stack");
    lines.push(input.configSummary);
  }

  if (input.keyFiles.length > 0) {
    lines.push("");
    lines.push("## Key Files");
    for (const kf of input.keyFiles) {
      lines.push(`- **${kf.path}** (${kf.role}): ${kf.description}`);
    }
  }

  if (input.conventions.length > 0) {
    lines.push("");
    lines.push("## Detected Conventions");
    for (const c of input.conventions) {
      lines.push(`- **${c.name}**: ${c.description} (confidence: ${c.confidence}, evidence: ${c.evidenceCount})`);
    }
  }

  if (input.dependencySummary) {
    lines.push("");
    lines.push("## Dependencies");
    lines.push(input.dependencySummary);
  }

  if (input.directoryTree.length > 0) {
    lines.push("");
    lines.push(`## Structure\n- ${input.directoryTree.slice(0, 20).join("\n- ")}`);
  }

  return lines.join("\n");
}
