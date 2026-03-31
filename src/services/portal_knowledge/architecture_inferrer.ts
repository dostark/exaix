/**
 * @module ArchitectureInferrer
 * @path src/services/portal_knowledge/architecture_inferrer.ts
 * @description Strategy 5 of PortalKnowledgeService: uses an LLM to produce a
 * Markdown architecture overview from combined strategy outputs (directory tree,
 * key files, detected conventions, config summary, dependency summary).
 * Falls back to empty string on any LLM or validation failure.
 * Only runs in `standard` and `deep` analysis modes — never in `quick`.
 * @architectural-layer Services
 * @dependencies [src/shared/constants.ts, src/ai/types.ts, src/services/tool/output_validator.ts, src/shared/schemas/portal_knowledge.ts]
 * @related-files [src/services/portal_knowledge/pattern_detector.ts, src/services/portal_knowledge/key_file_identifier.ts]
 */

import { z, ZodType, ZodTypeDef } from "zod";
import type { IModelOptions, IModelProvider } from "../../ai/types.ts";
import type { IValidationResult } from "../tool/output_validator.ts";
import type { ICodeConvention, IFileSignificance } from "../../shared/schemas/portal_knowledge.ts";
import { ARCHITECTURE_INFERRER_MAX_FILE_TOKENS, ARCHITECTURE_INFERRER_TOKEN_BUDGET } from "../../shared/constants.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Minimal validator interface: only the method used by ArchitectureInferrer. */
export interface IArchitectureValidator {
  validate<T>(content: string, schema: ZodType<T, ZodTypeDef, unknown>): IValidationResult<T>;
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

// ---------------------------------------------------------------------------
// Internal constants
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// ArchitectureInferrer
// ---------------------------------------------------------------------------

export class ArchitectureInferrer {
  private readonly _provider: IModelProvider;
  private readonly _validator: IArchitectureValidator;

  constructor(provider: IModelProvider, validator: IArchitectureValidator) {
    this._provider = provider;
    this._validator = validator;
  }

  /**
   * Generate a Markdown architecture overview.
   * Returns empty string on LLM failure or validation failure.
   */
  async infer(input: IArchitectureInferrerInput): Promise<string> {
    const prompt = this._buildPrompt(input);
    const options: IModelOptions = { temperature: TEMPERATURE_ZERO };

    let raw: string;
    try {
      raw = await this._provider.generate(prompt, options);
    } catch {
      return "";
    }

    const result = this._validator.validate<string>(raw, OverviewSchema);
    if (!result.success || !result.value) return "";
    return result.value;
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

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

  /**
   * Sort file paths so that high-significance files (in keyFiles) come first
   * and low-significance files come last. This ensures the budget-cap drops
   * the least important files.
   */
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
