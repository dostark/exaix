/**
 * @module CheckInteractiveResultTest
 * @path tests/scenario_framework/tests/unit/check_interactive_result_test.ts
 * @description Argv-dispatch behavior of the `check_interactive_result.ts` CLI entrypoint used
 *   as the interactive-pack live scenario's recording step: reads a real `exactl request
 *   clarify --json` result and any real wait states it resolved, computes rounds/converged/
 *   adherent, and seeds them into eval-history. Phase 145 Step 5 (live run).
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/check_interactive_result.ts, tests/scenario_framework/runner/policy_adherence.ts]
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { EvalSqliteStore } from "@exaix/eval-history";
import { main } from "../../runner/check_interactive_result.ts";

const EXPECTED_RESOLVED_BY = "user-simulator:cooperative";

Deno.test("[CheckInteractiveResult] exits 0 and seeds a converged, adherent run", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const clarifyResultPath = join(dir, "clarify-result.json");
    await Deno.writeTextFile(clarifyResultPath, JSON.stringify({ status: "complete", round: 1 }));

    const waitStateDir = join(dir, "wait-states");
    await Deno.mkdir(waitStateDir, { recursive: true });
    await Deno.writeTextFile(
      join(waitStateDir, "ws-1.json"),
      JSON.stringify({ status: "fulfilled", metadata: { resolvedBy: EXPECTED_RESOLVED_BY } }),
    );

    const dbPath = join(dir, "eval.db");
    const code = await main([clarifyResultPath, waitStateDir, EXPECTED_RESOLVED_BY, "cooperative", dbPath]);
    assertEquals(code, 0);

    const store = new EvalSqliteStore(dbPath);
    try {
      const runs = store.queryRuns({ pack: "interactive" });
      assertEquals(runs.length, 1);
      assertEquals(runs[0].tags?.includes("persona:cooperative"), true);
      assertEquals(runs[0].tags?.includes("rounds:1"), true);
      assertEquals(runs[0].tags?.includes("converged:true"), true);
      assertEquals(runs[0].tags?.includes("adherent:true"), true);
    } finally {
      store.close();
    }
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("[CheckInteractiveResult] records non-convergence and a bypass when the wait state has no matching resolvedBy", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const clarifyResultPath = join(dir, "clarify-result.json");
    await Deno.writeTextFile(clarifyResultPath, JSON.stringify({ status: "questions", round: 2 }));

    const waitStateDir = join(dir, "wait-states");
    await Deno.mkdir(waitStateDir, { recursive: true });
    await Deno.writeTextFile(
      join(waitStateDir, "ws-1.json"),
      JSON.stringify({ status: "fulfilled", metadata: {} }),
    );

    const dbPath = join(dir, "eval.db");
    const code = await main([clarifyResultPath, waitStateDir, EXPECTED_RESOLVED_BY, "cooperative", dbPath]);
    assertEquals(code, 0);

    const store = new EvalSqliteStore(dbPath);
    try {
      const runs = store.queryRuns({ pack: "interactive" });
      assertEquals(runs[0].tags?.includes("rounds:2"), true);
      assertEquals(runs[0].tags?.includes("converged:false"), true);
      assertEquals(runs[0].tags?.includes("adherent:false"), true);
    } finally {
      store.close();
    }
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("[CheckInteractiveResult] treats a missing wait-state directory as an empty (trivially adherent) run", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const clarifyResultPath = join(dir, "clarify-result.json");
    await Deno.writeTextFile(clarifyResultPath, JSON.stringify({ status: "questions", round: 1 }));

    const dbPath = join(dir, "eval.db");
    const code = await main([
      clarifyResultPath,
      join(dir, "does-not-exist"),
      EXPECTED_RESOLVED_BY,
      "cooperative",
      dbPath,
    ]);
    assertEquals(code, 0);

    const store = new EvalSqliteStore(dbPath);
    try {
      const runs = store.queryRuns({ pack: "interactive" });
      assertEquals(runs[0].tags?.includes("adherent:true"), true);
    } finally {
      store.close();
    }
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("[CheckInteractiveResult] exits 2 on missing arguments", async () => {
  const code = await main(["only-one-arg"]);
  assertEquals(code, 2);
});
