/**
 * @module Phase234RequirementsDeliverySecurityTest
 * @path tests/scenario_framework/tests/unit/requirements_delivery_security_test.ts
 * @description Executes the replay CLI capture against real usage rows and rejects missing bodies and corrupt snapshots.
 * @architectural-layer Test
 * @related-files [tests/integration/feature_flow_requirements_skill_delivery_test.ts, tests/scenario_framework/runner/synthetic_runner.ts]
 */
import { assertEquals, assertExists, assertNotEquals } from "@std/assert";
import { parse } from "@std/yaml";
import { ScenarioSchema } from "../../schema/scenario_schema.ts";
import { expandVariablesInStep } from "../../runner/synthetic_runner.ts";
import { join } from "@std/path";
import { REPO_ROOT } from "@exaix/testing";
import { PathResolver } from "@exaix/portal";
import { flowSkillDeliveryFixture } from "../../../integration/helpers/flow_skill_delivery_fixture.ts";

for (const variant of ["valid", "missing-body", "corrupt-hash"]) {
  Deno.test(`[security] requirements replay capture ${variant === "valid" ? "accepts durable matching evidence" : `rejects ${variant}`}`, async () => {
    const fx = await flowSkillDeliveryFixture();
    try {
      await fx.execute("product-manager", {
        ...fx.request(["typescript-patterns"]),
        flowStepId: "analyze-requirements",
      });
      if (variant === "corrupt-hash") {
        await fx.env.db.preparedRun("UPDATE skill_revisions SET content_sha256 = ? WHERE skill_name = ?", [
          "0".repeat(64),
          "requirements-analysis",
        ]);
      }
      const home = join(REPO_ROOT, "tests/scenario_framework");
      const scenario = ScenarioSchema.parse(
        parse(
          await Deno.readTextFile(join(home, "scenarios/flow_blueprints/phase234-requirements-skill-delivery.yaml")),
        ),
      );
      const prepare = expandVariablesInStep(scenario.steps[0], {
        REPO_ROOT,
        FRAMEWORK_HOME: home,
        WORKSPACE_ROOT: fx.env.tempDir,
      });
      assertExists(prepare.args);
      const setup = await new Deno.Command(Deno.execPath(), {
        args: prepare.args,
        cwd: fx.env.tempDir,
        stdout: "piped",
        stderr: "piped",
      }).output();
      assertEquals(setup.code, 0, new TextDecoder().decode(setup.stderr));
      const output = await new Deno.Command(join(fx.env.tempDir, ".mock-cli/claude"), {
        args: [
          "-p",
          variant === "missing-body" ? "A prompt without skill instructions" : fx.launches[0].objective,
          "--model",
          "feature_development__submit-flow-request__analyze-requirements__0",
        ],
        cwd: fx.env.tempDir,
        env: { EXA_SYSTEM_ROOT: "", NO_COLOR: "1" },
        stdout: "piped",
        stderr: "piped",
      }).output();
      if (variant === "valid") {
        assertEquals(output.code, 0, new TextDecoder().decode(output.stderr));
        const path = await new PathResolver(fx.config).resolve("@Runtime/phase234-requirements-evidence.json");
        const evidence = JSON.parse(await Deno.readTextFile(path));
        assertEquals(evidence.verified, true);
        assertEquals(evidence.usage.length, 3);
      } else assertNotEquals(output.code, 0, "Invalid capture evidence must fail closed");
    } finally {
      await fx.cleanup();
    }
  });
}
