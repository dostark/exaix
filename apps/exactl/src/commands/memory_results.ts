/**
 * @module MemoryCommandResults
 * @path apps/exactl/src/commands/memory_results.ts
 * @description The data the memory commands return. The memory builder renders it.
 * @architectural-layer CLI
 * @related-files [apps/exactl/src/commands/memory_commands.ts, apps/exactl/src/command_builders/memory_command.ts]
 */

/** One project memory with its pattern and decision counts. */
export interface IProjectListRow {
  name: string;
  patterns: number;
  decisions: number;
}

/** The proposal a command approved and the scope it merged into. */
export interface IProposalApproval {
  id: string;
  title: string;
  mergedTo: string;
}

/** The result of a search index rebuild. `embeddings` is the number of embedded learnings, or null without embeddings. */
export interface IIndexRebuildResult {
  embeddings: number | null;
}
