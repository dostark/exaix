/**
 * @module CodeParser
 * @path packages/core/src/func/code_parser.ts
 * @description Parses LLM responses to extract file changes for plan execution, validating path safety.
 * @architectural-layer Services
 * @related-files ["packages/core/src/func/agent_runner.ts", "packages/core/src/func/execution_loop.ts"]
 */

import { join, normalize } from "@std/path";
import { FileOperation } from "@exaix/core";

export interface IFileChange {
  path: string;
  operation: FileOperation;
  content?: string;
  oldContent?: string;
}

export interface ParseResult {
  changes: IFileChange[];
  invalidPaths: string[];
  errors: string[];
}

const FILE_HEADER_REGEX = /### ([^\s]+) \((create|modify|delete)\)/g;
const CODE_BLOCK_REGEX = /```(?:(\w+)\n)?([\s\S]*?)```/;

export function parseCodeGeneration(
  llmResponse: string,
  portalRoot: string,
): ParseResult {
  const changes: IFileChange[] = [];
  const invalidPaths: string[] = [];
  const errors: string[] = [];

  const headerMatches = [...llmResponse.matchAll(FILE_HEADER_REGEX)];

  if (headerMatches.length === 0) {
    return { changes: [], invalidPaths: [], errors: [] };
  }

  const seenPaths = new Set<string>();

  for (const match of headerMatches) {
    const [fullMatch, filePath, operation] = match;
    const startIndex = match.index!;

    const validation = validateFilePath(filePath, portalRoot);
    if (!validation.valid) {
      invalidPaths.push(filePath);
      errors.push(validation.error!);
      continue;
    }

    if (seenPaths.has(filePath)) {
      errors.push(`Duplicate file path detected: ${filePath}`);
      continue;
    }
    seenPaths.add(filePath);

    const textAfterHeader = llmResponse.substring(startIndex + fullMatch.length);
    const codeBlockMatch = textAfterHeader.match(CODE_BLOCK_REGEX);

    if (operation === "delete") {
      changes.push({
        path: filePath,
        operation: FileOperation.DELETE,
      });
      continue;
    }

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

interface PathValidation {
  valid: boolean;
  error?: string;
}

export function validateFilePath(
  filePath: string,
  portalRoot: string,
): PathValidation {
  if (filePath.startsWith("/")) {
    return {
      valid: false,
      error: `Absolute paths not allowed: ${filePath}`,
    };
  }

  if (filePath.includes("../")) {
    return {
      valid: false,
      error: `Directory traversal not allowed: ${filePath}`,
    };
  }

  const fullPath = normalize(join(portalRoot, filePath));
  const normalizedRoot = normalize(portalRoot);

  if (!fullPath.startsWith(normalizedRoot)) {
    return {
      valid: false,
      error: `Path escapes portal boundary: ${filePath}`,
    };
  }

  return { valid: true };
}

export function extractFilePaths(result: ParseResult): string[] {
  return result.changes.map((change) => change.path);
}

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
