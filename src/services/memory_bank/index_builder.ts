/**
 * @module MemoryIndexBuilder
 * @path src/services/memory_bank/index_builder.ts
 * @description Utilities for building and writing indices for files, patterns, and tags in the memory bank.
 * @architectural-layer Services
 * @related-files ["src/services/memory/memory_bank.ts", "packages/schemas/src/memory_bank.ts"]
 */

import { join } from "@std/path";
import type { IExecutionMemory, ILearning } from "@exaix/schemas/memory_bank.ts";
import { MemoryStatus } from "@exaix/core";

function pushTagRef(tagsIndex: Record<string, string[]>, tag: string, ref: string) {
  (tagsIndex[tag] ??= []).push(ref);
}

/**
 * Build files index from execution history
 */
export function buildFilesIndex(executions: IExecutionMemory[]): Record<string, string[]> {
  const filesIndex: Record<string, string[]> = {};

  for (const exec of executions) {
    const allFiles = [
      ...(exec.changes?.files_created || []),
      ...(exec.changes?.files_modified || []),
      ...(exec.context_files || []),
    ];

    for (const file of allFiles) {
      if (!filesIndex[file]) {
        filesIndex[file] = [];
      }
      filesIndex[file].push(exec.trace_id);
    }
  }

  return filesIndex;
}

/**
 * Build patterns index from project memory
 */
export async function buildPatternsIndex(
  projectsDir: string,
  getProjectMemory: (portal: string) => Promise<{ patterns: Array<{ name: string; tags?: string[] }> } | null>,
): Promise<Record<string, string[]>> {
  const patternsIndex: Record<string, string[]> = {};

  for await (const entry of Deno.readDir(projectsDir)) {
    if (entry.isDirectory) {
      const projectMem = await getProjectMemory(entry.name);
      if (projectMem) {
        for (const pattern of projectMem.patterns) {
          if (!patternsIndex[pattern.name]) {
            patternsIndex[pattern.name] = [];
          }
          patternsIndex[pattern.name].push(entry.name);
        }
      }
    }
  }

  return patternsIndex;
}

/**
 * Build tags index from project memory and global learnings
 */
export async function buildTagsIndex(
  projectsDir: string,
  getProjectMemory: (portal: string) => Promise<
    {
      patterns: Array<{ name: string; tags?: string[] }>;
      decisions: Array<{ date: string; tags?: string[] }>;
    } | null
  >,
  learnings: ILearning[],
): Promise<Record<string, string[]>> {
  const tagsIndex: Record<string, string[]> = {};

  // Index project memory tags
  for await (const entry of Deno.readDir(projectsDir)) {
    if (entry.isDirectory) {
      const projectMem = await getProjectMemory(entry.name);
      if (projectMem) {
        // Index pattern tags
        for (const pattern of projectMem.patterns) {
          for (const tag of (pattern.tags ?? [])) {
            pushTagRef(tagsIndex, tag, `pattern:${entry.name}:${pattern.name}`);
          }
        }

        // Index decision tags
        for (const decision of projectMem.decisions) {
          for (const tag of (decision.tags ?? [])) {
            pushTagRef(tagsIndex, tag, `decision:${entry.name}:${decision.date}`);
          }
        }
      }
    }
  }

  // Index global learnings tags
  for (const learning of learnings) {
    if (learning.status !== MemoryStatus.APPROVED) continue;
    for (const tag of (learning.tags ?? [])) {
      pushTagRef(tagsIndex, tag, `learning:global:${learning.id}`);
    }
  }

  return tagsIndex;
}

/**
 * Write index files to disk
 */
export async function writeIndices(
  indexDir: string,
  filesIndex: Record<string, string[]>,
  patternsIndex: Record<string, string[]>,
  tagsIndex: Record<string, string[]>,
): Promise<void> {
  await Deno.writeTextFile(
    join(indexDir, "files.json"),
    JSON.stringify(filesIndex, null, 2),
  );

  await Deno.writeTextFile(
    join(indexDir, "patterns.json"),
    JSON.stringify(patternsIndex, null, 2),
  );

  await Deno.writeTextFile(
    join(indexDir, "tags.json"),
    JSON.stringify(tagsIndex, null, 2),
  );
}
