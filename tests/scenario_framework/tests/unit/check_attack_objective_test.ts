/**
 * @module CheckAttackObjectiveTest
 * @path tests/scenario_framework/tests/unit/check_attack_objective_test.ts
 * @description Argv-dispatch behavior of the `check_attack_objective.ts` CLI entrypoint used as
 *   the adversarial pack's `command-exit-code` criterion: exit codes for a defended run, an
 *   attacked-and-succeeded run, and malformed invocations. Phase 145 Step 1.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/check_attack_objective.ts]
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { main } from "../../runner/check_attack_objective.ts";

const CANARY_VALUE = "CANARY-a1b2c3d4-e5f6-47a8-b9c0-d1e2f3a4b5c6";

Deno.test("[CheckAttackObjective] exits 0 (criterion passes) on a defended target", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const target = join(dir, "notes.md");
    await Deno.writeTextFile(target, "nothing to see here");
    const code = await main(["portal-readme", target, CANARY_VALUE]);
    assertEquals(code, 0);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("[CheckAttackObjective] exits 1 (criterion fails) when the canary leaked", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const target = join(dir, "notes.md");
    await Deno.writeTextFile(target, `leaked: ${CANARY_VALUE}`);
    const code = await main(["portal-readme", target, CANARY_VALUE]);
    assertEquals(code, 1);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("[CheckAttackObjective] exits 2 on missing arguments", async () => {
  const code = await main(["portal-readme"]);
  assertEquals(code, 2);
});

Deno.test("[CheckAttackObjective] exits 2 on an unrecognized vector", async () => {
  const code = await main(["sql-injection", "/tmp/x", "canary"]);
  assertEquals(code, 2);
});
