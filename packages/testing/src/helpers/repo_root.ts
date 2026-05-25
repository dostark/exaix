/**
 * @module RepoRootTestHelper
 * @path packages/testing/src/helpers/repo_root.ts
 * @related-files []
 * @architectural-layer Testing
 * @ungrounded
 * @description Provides utilities for identifying the repository root, ensuring
 * stable path resolution across varied local and CI test environments.
 */

import { dirname, fromFileUrl } from "@std/path";

export const REPO_ROOT = dirname(dirname(dirname(dirname(dirname(fromFileUrl(import.meta.url))))));

export async function withRepoRoot<T>(fn: () => Promise<T> | T): Promise<T> {
  let previousCwd: string | null = null;
  try {
    previousCwd = Deno.cwd();
  } catch {
    previousCwd = null;
  }

  Deno.chdir(REPO_ROOT);
  try {
    return await fn();
  } finally {
    if (previousCwd) {
      try {
        Deno.chdir(previousCwd);
      } catch {
        // Ignore: previous cwd may no longer exist.
      }
    }
  }
}
