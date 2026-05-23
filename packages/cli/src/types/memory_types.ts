/**
 * @module CLIMemoryTypes
 * @path packages/cli/src/types/memory_types.ts
 * @related-files []
 * @description Defines TypeScript types and interfaces used by CLI memory commands and formatters.
 * @architectural-layer CLI
 * @ungrounded
 */

import type { UIOutputFormat } from "@exaix/tui";

export type OutputFormat = UIOutputFormat;

export interface IMemoryBankSummary {
  projects: string[];
  executions: number;
  lastActivity: string | null;
}
