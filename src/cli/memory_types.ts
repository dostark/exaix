/**
 * @module CLIMemoryTypes
 * @path src/cli/memory_types.ts
 * @description Defines TypeScript types and interfaces used by CLI memory commands and formatters.
 * @architectural-layer CLI
 * @related-files [src/cli/memory_commands.ts, src/cli/formatters/memory_formatter.ts]
 */

import type { UIOutputFormat } from "@exaix/tui";

export type OutputFormat = UIOutputFormat;

export interface IMemoryBankSummary {
  projects: string[];
  executions: number;
  lastActivity: string | null;
}
