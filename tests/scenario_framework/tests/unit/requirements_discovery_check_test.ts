/**
 * @module RequirementsDiscoveryCheckTest
 * @path tests/scenario_framework/tests/unit/requirements_discovery_check_test.ts
 * @description Exercises the real requirements checker with request-bound artifacts and a separate answer turn.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/requirements_discovery_check.ts]
 */
import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { PathResolver } from "@exaix/portal";
import { createMockConfig, REPO_ROOT, TestEnvironment } from "@exaix/testing";
import samples from "../../fixtures/requirements_discovery/records.json" with { type: "json" };
import { applyRequirementsControl } from "../helpers/requirements_controls.ts";

const FIRST = "request-0123abcd";
const SECOND = "request-89abcdef";
const CHECKER = join(REPO_ROOT, "tests/scenario_framework/runner/requirements_discovery_check.ts");

async function writePlan(root: string, requestId: string, record: string): Promise<void> {
  const resolver = new PathResolver(createMockConfig(root));
  const plans = await resolver.resolve("@Workspace/Plans");
  await Deno.mkdir(plans, { recursive: true });
  const trace = `${requestId.slice(-8)}-0000-4000-8000-000000000000`;
  const content = ["---", `request_id: ${requestId}`, `trace_id: ${trace}`, "---", "```json", record, "```"].join("\n");
  await Deno.writeTextFile(await resolver.resolve(`@Workspace/Plans/${requestId}_plan.md`), content);
}

async function runCheck(caseId: string, root: string, turn: string): Promise<Deno.CommandOutput> {
  return await new Deno.Command(Deno.execPath(), {
    args: ["run", "-A", "--quiet", CHECKER, caseId, root, FIRST, turn],
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
