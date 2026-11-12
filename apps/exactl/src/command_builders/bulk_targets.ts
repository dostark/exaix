/**
 * @module ExaCtlBulkTargets
 * @path apps/exactl/src/command_builders/bulk_targets.ts
 * @description Checks the ids-or-all argument rule of the exactl bulk commands.
 * @architectural-layer CLI
 * @dependencies [apps/exactl/src/exactl_errors.ts]
 * @related-files [apps/exactl/src/command_builders/plan_command.ts, apps/exactl/src/command_builders/memory_command.ts]
 */

import { ExaCtlError, ExaCtlExitCode } from "../exactl_errors.ts";

// unslop-ignore-next-line unused-type
/** Either every item of the kind, or the listed ids. */
export type BulkTargets = { readonly all: true } | { readonly all: false; readonly ids: readonly string[] };

/** Accepts ids or `--all`. Both together, or neither, is a usage error. */
export function selectBulkTargets(ids: readonly string[], all: boolean, noun: string): BulkTargets {
  if (all && ids.length > 0) {
    throw new ExaCtlError(ExaCtlExitCode.USAGE, `Pass ${noun} ids or --all, not both.`);
  }
  if (!all && ids.length === 0) {
    throw new ExaCtlError(ExaCtlExitCode.USAGE, `Pass at least one ${noun} id or --all.`);
  }
  return all ? { all: true } : { all: false, ids };
}
