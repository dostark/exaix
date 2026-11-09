/**
 * @module BugDiagnosisRuntimeOracleTest
 * @path tests/scenario_framework/tests/unit/bug_diagnosis_runtime_oracle_test.ts
 * @description Proves each runtime diagnosis oracle accepts a good plan and rejects its
 *   known-bad control before any live scenario credits the case.
 * @architectural-layer Test
 * @dependencies [@std/assert]
 * @related-files [tests/scenario_framework/runner/bug_diagnosis_runtime_oracle.ts]
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { REPO_ROOT } from "@exaix/testing";
import { BUG_DIAGNOSIS_RUNTIME_CASES, evaluatePlan } from "../../runner/bug_diagnosis_runtime_oracle.ts";

import { registerOracleControls } from "../helpers/oracle_controls.ts";
import raceManifest from "../../fixtures/skill_eval/phase234/p234-s2-c2-corrected-manifest.json" with { type: "json" };

interface ICaseSample {
  id: string;
  good: string;
  bad: string;
}

const SAMPLES: ICaseSample[] = [
  {
    id: "p234-s2-c1",
    good: "Run ./run-tests.sh. It asserts the duplicate row count and fails.",
    bad: "Run deno test to confirm the duplicate row count.",
  },
  {
    id: "p234-s2-c2",
    good: "Both callers stay in the regression. It fails before the patch.",
    bad: "Use a single caller test. It fails before the patch.",
  },
  {
    id: "p234-s2-c3",
    good: "mytool is not installed. Record the missing tool and leave the fix pending.",
    bad: "mytool is not installed. The defect is fixed.",
  },
  {
    id: "p234-s2-c4",
    good: "Do not apply the patch before a symptom-sensitive regression fails. No RED exists yet.",
    bad: "The source explanation is enough and counts as RED.",
  },
  {
    id: "p234-s2-c5",
    good:
      "The 100 and 10000 runs use different inputs. The comparison is not comparable; withhold the improvement verdict.",
    bad: "The 10000 run is faster than 100; the speedup is confirmed.",
  },
];

Deno.test("every announced runtime case has a sample", () => {
  assertEquals(SAMPLES.map((sample) => sample.id), [...BUG_DIAGNOSIS_RUNTIME_CASES]);
});

registerOracleControls(SAMPLES, evaluatePlan, "accepts the project-appropriate diagnosis");

Deno.test("corrected two-caller fixture isolates the duplicate to concurrent callers", async () => {
  const cwd = join(REPO_ROOT, "tests/scenario_framework/fixtures/portals/p234_s2_c2_corrected");
  const single = await new Deno.Command("sh", {
    args: ["-c", "printf 'row\\n' | ./count.sh"],
    cwd,
    stdout: "piped",
    stderr: "piped",
  }).output();
  assertEquals(single.code, 0);
  assertEquals(new TextDecoder().decode(single.stdout), "row\n");
  const race = await new Deno.Command("sh", { args: ["race.sh"], cwd, stdout: "piped", stderr: "piped" }).output();
  assertEquals(race.code, 0);
  assertEquals(JSON.parse(new TextDecoder().decode(race.stdout)), { callers: 2, rows: 2, expected: 1 });
  const regression = await new Deno.Command("sh", {
    args: ["run-tests.sh"],
    cwd,
    stdout: "piped",
    stderr: "piped",
  }).output();
  assertEquals(regression.code, 1);
  assertStringIncludes(new TextDecoder().decode(regression.stderr), "expected 1 row, got 2");
});

Deno.test("corrected two-caller fixture matches the pre-run frozen manifest", async () => {
  for (const [path, expected] of Object.entries(raceManifest.files)) {
    const file = join(REPO_ROOT, path);
    const digest = await crypto.subtle.digest("SHA-256", await Deno.readFile(file));
    const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
    assertEquals(hash, expected.sha256, path);
    assertEquals((await Deno.stat(file)).mode! & 0o777, expected.mode, path);
  }
});

Deno.test("an unknown runtime case id is rejected", () => {
  let message = "";
  try {
    evaluatePlan("p234-s2-c9", "text");
  } catch (error: unknown) {
    message = error instanceof Error ? error.message : String(error);
  }
  assertStringIncludes(message, "Unknown runtime diagnosis case");
});
