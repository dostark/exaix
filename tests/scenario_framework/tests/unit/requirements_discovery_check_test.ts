/**
 * @module RequirementsDiscoveryCheckTest
 * @path tests/scenario_framework/tests/unit/requirements_discovery_check_test.ts
 * @description Exercises the real requirements checker with request-bound artifacts and a separate answer turn.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/requirements_discovery_check.ts]
 */
import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { REPO_ROOT, TestEnvironment } from "@exaix/testing";
import samples from "../../fixtures/requirements_discovery/records.json" with { type: "json" };
import { applyRequirementsControl } from "../helpers/requirements_controls.ts";
import { writeSkillEvalPlan as writePlan } from "../helpers/skill_eval_plan.ts";
import { captureWorkspaceBaseline } from "../../runner/skill_evaluation_evidence.ts";

const FIRST = "request-0123abcd";
const SECOND = "request-89abcdef";
const CHECKER = join(REPO_ROOT, "tests/scenario_framework/runner/requirements_discovery_check.ts");

Deno.test("diagnosis diagnostic reads the named artifact and rejects a mismatched request", async () => {
  const env = await TestEnvironment.create({ initGit: false });
  try {
    await writePlan(env.tempDir, FIRST, "duplicate count");
    await writePlan(env.tempDir, SECOND, "unrelated plan");
    const oracle = join(REPO_ROOT, "tests/scenario_framework/fixtures/skill_eval/phase234/bug_diagnosis_oracle.ts");
    const run = (id: string) =>
      new Deno.Command(Deno.execPath(), {
        args: ["run", "-A", "--quiet", oracle, "p234-s1-c1", env.tempDir, id, "diagnostic"],
        cwd: REPO_ROOT,
        stdout: "piped",
        stderr: "piped",
      }).output();
    const result = await run(FIRST);
    assertEquals(result.code, 0);
    assertStringIncludes(new TextDecoder().decode(result.stdout), '"legacyDiagnostic":{"ok":true');
    assertEquals((await run("request-aaaaaaaa")).code, 2);
  } finally {
    await env.cleanup();
  }
});

Deno.test("diagnosis evidence gate reports missing independent evidence for the named artifact", async () => {
  const env = await TestEnvironment.create({ initGit: false });
  try {
    await Deno.mkdir(join(env.tempDir, "p234-s2"));
    await captureWorkspaceBaseline(env.tempDir, "p234-s2-c1");
    await writePlan(env.tempDir, FIRST, "duplicate count");
    const checker = join(REPO_ROOT, "tests/scenario_framework/runner/skill_evaluation_evidence.ts");
    const result = await new Deno.Command(Deno.execPath(), {
      args: ["run", "-A", "--quiet", checker, "evaluate", env.tempDir, "p234-s2-c1", FIRST],
      cwd: REPO_ROOT,
      stdout: "piped",
      stderr: "piped",
    }).output();
    assertEquals(result.code, 1);
    assertStringIncludes(new TextDecoder().decode(result.stdout), '"overall":"pending"');
  } finally {
    await env.cleanup();
  }
});

async function runCheck(caseId: string, root: string, turn: string, mode = ""): Promise<Deno.CommandOutput> {
  return await new Deno.Command(Deno.execPath(), {
    args: ["run", "-A", "--quiet", CHECKER, caseId, root, FIRST, turn, mode],
    cwd: REPO_ROOT,
    stdout: "piped",
    stderr: "piped",
  }).output();
}

Deno.test("requirements checker reads the named request instead of the newest unrelated plan", async () => {
  const environment = await TestEnvironment.create({ initGit: false });
  const root = environment.tempDir;
  try {
    await writePlan(root, FIRST, JSON.stringify(samples[0].good));
    const bad = applyRequirementsControl(JSON.stringify(samples[0].good), JSON.stringify(samples[0].bad[0]));
    await writePlan(root, SECOND, bad);
    const correct = await runCheck("p234-s5-c1", root, "initial");
    assertEquals(correct.code, 0, new TextDecoder().decode(correct.stderr));
    await writePlan(root, FIRST, bad);
    const wrong = await runCheck("p234-s5-c1", root, "initial");
    assertEquals(wrong.code, 1);
  } finally {
    await environment.cleanup();
  }
});

Deno.test("scenario diagnostic permits artifact collection but the evaluation stays pending", async () => {
  const environment = await TestEnvironment.create({ initGit: false });
  try {
    const bad = applyRequirementsControl(JSON.stringify(samples[0].good), JSON.stringify(samples[0].bad[0]));
    await writePlan(environment.tempDir, FIRST, bad);
    const diagnostic = await runCheck("p234-s5-c1", environment.tempDir, "initial", "diagnostic");
    assertEquals(diagnostic.code, 0);
    assertStringIncludes(new TextDecoder().decode(diagnostic.stdout), '"legacyDiagnostic":{"ok":false');
    const evaluation = await runCheck("p234-s5-c1", environment.tempDir, "initial", "evaluate");
    assertEquals(evaluation.code, 1);
    assertStringIncludes(new TextDecoder().decode(evaluation.stdout), '"overall":"pending"');
  } finally {
    await environment.cleanup();
  }
});

Deno.test("requirements checker verifies a separate retention answer and rejects a contradictory update", async () => {
  const environment = await TestEnvironment.create({ initGit: false });
  const root = environment.tempDir;
  try {
    const pending = samples.find((sample) => sample.case_id === "p234-s5-c2" && !sample.answer)!;
    const answer = samples.find((sample) => sample.answer)!;
    await writePlan(root, FIRST, JSON.stringify(pending.good));
    const absent = await runCheck("p234-s5-c2", root, "answered");
    assertEquals(absent.code, 2);
    await writePlan(root, SECOND, JSON.stringify(answer.good));
    const valid = await runCheck("p234-s5-c2", root, "answered");
    assertEquals(valid.code, 0, new TextDecoder().decode(valid.stderr));
    assertStringIncludes(new TextDecoder().decode(valid.stdout), `"priorRequestId":"${FIRST}"`);
    const wrong = applyRequirementsControl(JSON.stringify(answer.good), JSON.stringify(answer.bad[0]));
    await writePlan(root, SECOND, wrong);
    const invalid = await runCheck("p234-s5-c2", root, "answered");
    assertEquals(invalid.code, 1);
  } finally {
    await environment.cleanup();
  }
});
