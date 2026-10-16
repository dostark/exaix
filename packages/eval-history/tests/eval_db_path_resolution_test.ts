/**
 * @module EvalDbPathResolutionTest
 * @path packages/eval-history/tests/eval_db_path_resolution_test.ts
 * @description Tests for resolveEvalDbPath path resolution logic.
 */

import * as pathBuilders from "@exaix/shared";
import { assertEquals } from "@std/assert";
import { resolve } from "@std/path";
import { resolveEvalDbPath } from "@exaix/eval-history";

Deno.test({
  name: "[EvalDbPath] explicit workspace root produces correct path",
  fn: () => {
    const path = resolveEvalDbPath("/home/user/myproject");
    assertEquals(path, resolve(pathBuilders.runtimePath("/home/user/myproject", "eval.db")));
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
    assertEquals(path, resolve(pathBuilders.runtimePath(Deno.cwd(), "eval.db")));
  },
  sanitizeOps: false,
  sanitizeResources: false,
});
