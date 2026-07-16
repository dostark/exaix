/**
 * @module EvalDbPathResolutionTest
 * @path packages/eval-history/tests/eval_db_path_resolution_test.ts
 * @description Tests for resolveEvalDbPath path resolution logic.
 */

import { assertEquals } from "@std/assert";
import { resolve } from "@std/path";
import { resolveEvalDbPath } from "@exaix/eval-history";

Deno.test({
  name: "[EvalDbPath] explicit workspace root produces correct path",
  fn: () => {
    const path = resolveEvalDbPath("/home/user/myproject");
    assertEquals(path, resolve("/home/user/myproject", ".exa", "eval.db"));
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

Deno.test({
  name: "[EvalDbPath] EXA_EVAL_DB_PATH env var overrides workspace root",
  fn: () => {
    const prev = Deno.env.get("EXA_EVAL_DB_PATH");
    Deno.env.set("EXA_EVAL_DB_PATH", "/custom/path/eval.db");
    try {
      const path = resolveEvalDbPath("/home/user/project");
      assertEquals(path, "/custom/path/eval.db");
    } finally {
      if (prev !== undefined) Deno.env.set("EXA_EVAL_DB_PATH", prev);
      else Deno.env.delete("EXA_EVAL_DB_PATH");
    }
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

Deno.test({
  name: "[EvalDbPath] no workspace root falls back to Deno.cwd()",
  fn: () => {
    const path = resolveEvalDbPath();
    assertEquals(path, resolve(Deno.cwd(), ".exa", "eval.db"));
  },
  sanitizeOps: false,
  sanitizeResources: false,
});
