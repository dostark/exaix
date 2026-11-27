#!/usr/bin/env -S deno run -A
/**
 * @module ScopedGates
 * @path scripts/scoped_gates.ts
 * @description Defines which changes touch only Go-port tooling and the static gates that such a change needs.
 * The pre-commit hook and `ci.ts check --changed` share the path rule. The gates run on the changed files only.
 * Usage: imported by scripts/setup_hooks.ts and scripts/ci.ts.
 */
import { readGit } from "./plan_git.ts";

export interface IScopedGate {
  readonly cmd: readonly string[];
  readonly desc: string;
}

/** Paths a Go-port step may change in the parent: its recorders, their tests and helpers, and the two gitlinks. */
export const GO_PORT_TOOLING_PATTERN =
  "^(scripts/go_port/|tests/scripts/go_|tests/scripts/helpers/go_|exaix-dev-docs$|exaix-go$)";

const TOOLING = new RegExp(GO_PORT_TOOLING_PATTERN);
const TS_FILE = /\.ts$/;
const MD_FILE = /\.md$/;
const RECORDER_PATH = /^(scripts\/go_port\/|tests\/scripts\/go_port_)/;
const LINT_RULES = "--rules-include=explicit-module-boundary-types";

/** True when the change is not empty and every path is Go-port tooling or a Go gitlink. */
export function isGoPortToolingOnly(paths: readonly string[]): boolean {
  return paths.length > 0 && paths.every((path) => TOOLING.test(path));
}

/** Lists the static gates for a tooling-only change. Only the two whole-graph analyses read beyond the changed files. */
export function scopedGates(paths: readonly string[], goPortTests: readonly string[]): IScopedGate[] {
  const typescript = paths.filter((path) => TS_FILE.test(path));
  const markdown = paths.filter((path) => MD_FILE.test(path));
  const gates: IScopedGate[] = [];
  if (typescript.length > 0) {
    gates.push(
      { cmd: ["deno", "fmt", "--check", ...typescript], desc: "Format Check (changed files)" },
      { cmd: ["deno", "lint", LINT_RULES, ...typescript], desc: "Lint (changed files)" },
      { cmd: ["deno", "check", ...typescript], desc: "Type Check (changed files)" },
      { cmd: ["deno", "task", "check:arch"], desc: "Architecture Validation" },
      { cmd: ["deno", "task", "check:unused-exports:parity:strict"], desc: "Unused Exports Parity Gate" },
    );
  }
  if (markdown.length > 0) {
    gates.push({
      cmd: ["deno", "run", "--allow-read", "scripts/markdown_lint.ts", ...markdown],
      desc: "Markdown Lint (changed files)",
    });
  }
  for (const task of ["check:optional-params:staged", "check:ste100-comments:staged"]) {
    gates.push({ cmd: ["deno", "task", task], desc: task });
  }
  for (const task of ["check:md-path:staged", "check:doc-section-refs:staged"]) {
    gates.push({ cmd: ["deno", "task", task], desc: task });
  }
  if (goPortTests.length > 0 && paths.some((path) => RECORDER_PATH.test(path))) {
    gates.push({ cmd: ["deno", "test", "--allow-all", ...goPortTests], desc: "Go-port script tests" });
  }
  return gates;
}

export type TCheckPlan =
  | { readonly kind: "empty" }
  | { readonly kind: "full" }
  | { readonly kind: "scoped"; readonly gates: readonly IScopedGate[] };

/** Chooses the file-scoped gates for a tooling-only change. Any other change keeps the whole-tree check. */
export function planChangedCheck(paths: readonly string[], goPortTests: readonly string[]): TCheckPlan {
  if (paths.length === 0) return { kind: "empty" };
  if (!isGoPortToolingOnly(paths)) return { kind: "full" };
  return { kind: "scoped", gates: scopedGates(paths, goPortTests) };
}

/** Lists the files that differ from HEAD, staged or not, and the untracked files that Git does not ignore. */
export async function changedPaths(): Promise<string[]> {
  const tracked = await readGit(["diff", "HEAD", "--name-only", "--diff-filter=ACMR", "--ignore-submodules=none"]);
  const untracked = await readGit(["ls-files", "--others", "--exclude-standard"]);
  return [...new Set(`${tracked}\n${untracked}`.split("\n").filter((line) => line.length > 0))];
}
