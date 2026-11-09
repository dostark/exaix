/**
 * @module DocHelpers
 * @path apps/exactl/src/command_docs/doc_helpers.ts
 * @description Builds the see-also command lines of the exactl doc records.
 * @architectural-layer CLI
 * @related-files [apps/exactl/src/command_docs/plan_docs.ts, apps/exactl/src/command_docs/daemon_docs.ts]
 */

const PROGRAM = "exactl";

/** The invocation line for a command path, such as `exactl plan show`. */
export function exactlCommand(...words: readonly string[]): string {
  return [PROGRAM, ...words].join(" ");
}
