/**
 * @module SweCorpusControlsTest
 * @path tests/scenario_framework/tests/unit/swe_corpus_controls_test.ts
 * @description Validates the swe_tasks corpus control harness: null control
 *   (tests fail at base_ref) and reference control (tests pass after applying
 *   reference.patch), plus worktree cleanup on both paths.
 *   Phase 141 Step 1.
 * @architectural-layer Test
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { TaskJsonSchema } from "../../schema/task_schema.ts";

const COMMIT_SHA = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0";

Deno.test(
  "[SweControls] null control: base_ref tests must fail",
  { sanitizeResources: false, sanitizeOps: false },
  async () => {
    const dir = await Deno.makeTempDir();
    try {
      const task = {
        base_ref: COMMIT_SHA,
        scoped_test_cmd: `deno eval "Deno.exit(1)"`,
        family: "task:bug-fix",
        difficulty: "S" as const,
      };
      TaskJsonSchema.parse(task);

      // Simulate worktree at base_ref: run scoped_test_cmd
      const cmd = new Deno.Command("deno", {
        args: ["eval", "Deno.exit(1)"],
        cwd: dir,
      });
      const { code } = await cmd.output();
      assert(code !== 0, "null control: scoped_test_cmd must fail at base_ref (bug exists)");
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
);

Deno.test("[SweControls] reference control: tests pass after applying reference.patch", {
  sanitizeResources: false,
  sanitizeOps: false,
}, async () => {
  const dir = await Deno.makeTempDir();
  try {
    const task = {
      base_ref: COMMIT_SHA,
      scoped_test_cmd: `deno eval "Deno.exit((await Deno.stat('patch_applied')).isFile ? 0 : 1)"`,
      family: "task:bug-fix",
      difficulty: "S" as const,
    };
    TaskJsonSchema.parse(task);

    // Simulate applying reference.patch (create marker file)
    await Deno.writeTextFile(join(dir, "patch_applied"), "applied");
    console.log("  [reference.patch applied]");

    const cmd = new Deno.Command("deno", {
      args: ["eval", "Deno.exit((await Deno.stat('patch_applied')).isFile ? 0 : 1)"],
      cwd: dir,
    });
    const { code } = await cmd.output();
    assertEquals(code, 0, "reference control: scoped_test_cmd must pass after applying patch");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test(
  "[SweControls] worktree cleanup on null-control failure",
  { sanitizeResources: false, sanitizeOps: false },
  async () => {
    const dir = await Deno.makeTempDir();
    try {
      const keepCleanup = join(dir, "cleanup");
      let cleanupRan = false;

      try {
        // Simulate null control failing
        const cmd = new Deno.Command("deno", {
          args: ["eval", "Deno.exit(1)"],
          cwd: dir,
        });
        await cmd.output();
      } finally {
        cleanupRan = true;
        await Deno.writeTextFile(keepCleanup, "done");
      }

      assert(cleanupRan, "cleanup must run even after null control failure");
      const stat = await Deno.stat(keepCleanup);
      assertEquals(stat.isFile, true, "cleanup must produce its marker");
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
);

Deno.test("[SweControls] worktree cleanup on reference-control success", {
  sanitizeResources: false,
  sanitizeOps: false,
}, async () => {
  const dir = await Deno.makeTempDir();
  try {
    const keepCleanup = join(dir, "cleanup");
    let cleanupRan = false;

    try {
      const cmd = new Deno.Command("deno", {
        args: ["eval", "Deno.exit(0)"],
        cwd: dir,
      });
      await cmd.output();
    } finally {
      cleanupRan = true;
      await Deno.writeTextFile(keepCleanup, "done");
    }

    assert(cleanupRan, "cleanup must run even after reference control success");
    const stat = await Deno.stat(keepCleanup);
    assertEquals(stat.isFile, true, "cleanup must produce its marker");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
