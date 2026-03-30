/**
 * @module CodeParser
 * @path src/services/code_parser.ts
 * @description Parses LLM responses to extract file changes for plan execution, validating path safety.
 * @architectural-layer Services
 * @dependencies [Path]
 * @related-files [src/services/agent_runner.ts, src/services/execution_loop.ts]
 */

import { join, normalize } from "@std/path";
import { FileOperation } from "../../shared/enums.ts";

/**
 * Represents a file change to be applied
 */
export interface IFileChange {
  /** Relative path to file within portal */
  path: string;
  /** Operation to perform on file */
  operation: FileOperation;
  /** File content (required for create/modify) */
  content?: string;
  /** Original content (for modify operations) */
  oldContent?: string;
}

/**
 * Parse result containing extracted file changes
 */
export interface ParseResult {
  /** Successfully parsed file changes */
  changes: IFileChange[];
  /** File paths that failed validation */
  invalidPaths: string[];
  /** Parsing errors encountered */
  errors: string[];
}

/**
 * Regular expression to match file change headers
 * Format: ### path/to/file.ts (operation)
 */
const FILE_HEADER_REGEX = /### ([^\s]+) \((create|modify|delete)\)/g;

/**
 * Regular expression to match code blocks
 * Format: ```language\n...code...\n```
 */
const CODE_BLOCK_REGEX = /```(?:(\w+)\n)?([\s\S]*?)```/;

/**
 * Parse LLM response to extract file changes
 *
 * Expected format:
 * ```
 * ### src/example.ts (create)
 * ```typescript
 * export const example = "test";
 * ```
 * ```
 *
 * @param llmResponse - Raw response from LLM
 * @param portalRoot - Absolute path to portal root directory
 * @returns Parse result with changes and validation errors
 */
export function parseCodeGeneration(
  llmResponse: string,
  portalRoot: string,
): ParseResult {
  const changes: IFileChange[] = [];
  const invalidPaths: string[] = [];
  const errors: string[] = [];

  // Find all file change headers
  const headerMatches = [...llmResponse.matchAll(FILE_HEADER_REGEX)];

  if (headerMatches.length === 0) {
    return { changes: [], invalidPaths: [], errors: [] };
  }

  // Track seen paths to detect duplicates
  const seenPaths = new Set<string>();

  for (const match of headerMatches) {
    const [fullMatch, filePath, operation] = match;
    const startIndex = match.index!;

    // Validate file path
    const validation = validateFilePath(filePath, portalRoot);
    if (!validation.valid) {
      invalidPaths.push(filePath);
      errors.push(validation.error!);
      continue;
    }

    // Check for duplicate paths
    if (seenPaths.has(filePath)) {
      errors.push(`Duplicate file path detected: ${filePath}`);
      continue;
    }
    seenPaths.add(filePath);

    // Extract code block following the header
    const textAfterHeader = llmResponse.substring(startIndex + fullMatch.length);
    const codeBlockMatch = textAfterHeader.match(CODE_BLOCK_REGEX);

    // For delete operations, code block is optional
    if (operation === "delete") {
      changes.push({
        path: filePath,
        operation: FileOperation.DELETE,
      });
      continue;
    }

    // For create/modify, code block is required
    if (!codeBlockMatch) {
      errors.push(`No code block found for ${operation} operation on ${filePath}`);
      continue;
    }

    const [, , code] = codeBlockMatch;

    let opType: FileOperation;
    if (operation === "create") {
      opType = FileOperation.CREATE;
    } else if (operation === "modify") {
      opType = FileOperation.MODIFY;
    } else {
      opType = FileOperation.DELETE;
    }

    changes.push({
      path: filePath,
      operation: opType,
      content: code,
    });
  }

  return { changes, invalidPaths, errors };
}

/**
 * Validation result for file paths
 */
interface PathValidation {
  valid: boolean;
  error?: string;
}

/**
 * Validate file path is safe and within portal boundaries
 *
 * Security checks:
 * - No absolute paths
 * - No directory traversal (../)
 * - Path must be within portal root after normalization
 *
 * @param filePath - Relative file path to validate
 * @param portalRoot - Absolute path to portal root
 * @returns Validation result
 */
export function validateFilePath(
  filePath: string,
  portalRoot: string,
): PathValidation {
  // Check for absolute paths
  if (filePath.startsWith("/")) {
    return {
      valid: false,
      error: `Absolute paths not allowed: ${filePath}`,
    };
  }

  // Check for directory traversal attempts
  if (filePath.includes("../")) {
    return {
      valid: false,
      error: `Directory traversal not allowed: ${filePath}`,
    };
  }

  // Construct full path and normalize
  const fullPath = normalize(join(portalRoot, filePath));
  const normalizedRoot = normalize(portalRoot);

  // Check if path escapes portal root
  if (!fullPath.startsWith(normalizedRoot)) {
    return {
      valid: false,
      error: `Path escapes portal boundary: ${filePath}`,
    };
  }

  return { valid: true };
}

/**
 * Extract file paths from parse result
 *
 * @param result - Parse result
 * @returns Array of file paths
 */
export function extractFilePaths(result: ParseResult): string[] {
  return result.changes.map((change) => change.path);
}

/**
 * Count file changes by operation type
 *
 * @param changes - Array of file changes
 * @returns Record of operation counts
 */
export function countOperations(changes: IFileChange[]): Record<FileOperation, number> {
  const counts: Record<FileOperation, number> = {
    create: 0,
    modify: 0,
    delete: 0,
  };

  for (const change of changes) {
    counts[change.operation]++;
  }

  return counts;
}
