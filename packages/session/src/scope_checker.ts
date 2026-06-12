/**
 * @module ScopeChecker
 * @path packages/session/src/scope_checker.ts
 * @description Two-stage path-scope enforcement for session-delegation
 *   reconciliation (GAP-3). Stage 1: traversal safety (null byte, `..`, absolute,
 *   worktree-root escape). Stage 2: glob match of worktree-relative paths against
 *   brief.permitted_paths via globToRegExp(globstar).
 * @architectural-layer Services
 * @dependencies [@exaix/tool-runtime]
 * @related-files [packages/session/src/reconcile.ts, packages/tool-runtime/src/path_security.ts]
 */

import { globToRegExp, isAbsolute, join, normalize, relative } from "@std/path";
import { PathSecurity } from "@exaix/tool-runtime";

export interface IScopeCheckResult {
  violations: string[];
  accepted: string[];
}

/**
 * Validate that every path in pathsTouched (1) stays inside worktreeRoot (no null
 * byte, `..`, or absolute escape) and (2) matches at least one glob in
 * permittedPaths. Any path failing either stage is a scope violation and must
 * block reconciliation.
 */
export function checkScope(
  pathsTouched: string[],
  permittedPaths: string[],
  worktreeRoot: string,
): IScopeCheckResult {
  const violations: string[] = [];
  const accepted: string[] = [];
  const patterns = permittedPaths.map((p) => globToRegExp(p, { extended: true, globstar: true }));

  for (const raw of pathsTouched) {
    // Stage 1: traversal safety. Reject null bytes explicitly — PathSecurity
    // strips them silently, which would let "src/\x00evil.ts" pass as "src/evil.ts".
    if (raw.includes("\x00")) {
      violations.push(raw);
      continue;
    }

    let normalized: string;
    try {
      normalized = PathSecurity.normalizePath(raw);
    } catch {
      violations.push(raw);
      continue;
    }

    // paths_touched must be worktree-relative — reject absolute paths outright.
    if (isAbsolute(normalized)) {
      violations.push(raw);
      continue;
    }

    // Confirm the resolved path stays inside worktreeRoot.
    const absolute = normalize(join(worktreeRoot, normalized));
    const rel = relative(worktreeRoot, absolute);
    if (rel.startsWith("..") || isAbsolute(rel)) {
      violations.push(raw);
      continue;
    }

    // Stage 2: glob scope match against permitted_paths.
    if (!patterns.some((re) => re.test(normalized))) {
      violations.push(raw);
      continue;
    }

    accepted.push(normalized);
  }

  return { violations, accepted };
}
