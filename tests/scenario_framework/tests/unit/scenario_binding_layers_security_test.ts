/**
 * @module ScenarioBindingLayersSecurityTest
 * @path tests/scenario_framework/tests/unit/scenario_binding_layers_security_test.ts
 * @description Security tests for `planScenarioBindings`: it refuses output directories and
 *   bindings children that physically land inside the sandbox (including via symlinks), refuses
 *   operator overlays that are symlinks, directories or oversized, and refuses step ids that
 *   carry path segments — all before any overlay reaches the disk.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/binding_layers.ts]
 */

import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { BINDING_OVERLAY_MAX_BYTES } from "@exaix/core";
import { ScenarioStepSchema, ScenarioStepType } from "../../schema/step_schema.ts";
import { planScenarioBindings } from "../../runner/binding_layers.ts";
import { scenarioWith } from "./helpers/scenario_binding_fixtures.ts";

Deno.test("[security] planScenarioBindings refuses an output directory inside the sandbox tree", async () => {
  const root = await Deno.makeTempDir({ prefix: "scenario-bindings-refuse-" });
  try {
    const sandboxRoot = join(root, "sandbox");
    await assertRejects(
      () =>
        planScenarioBindings({
          scenario: scenarioWith({ bindings: { "flow:research/step:compose": { service: "alpha" } } }),
          operatorOverlays: [],
          operatorBinds: [],
          // Inside the sandbox: an agent under test could rewrite these overlays.
          outputDir: join(sandboxRoot, "output"),
          sandboxRoot,
        }),
      Error,
      "overlay_invalid",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("[security] an output directory symlink into the sandbox is refused before any overlay write", async () => {
  const root = await Deno.makeTempDir({ prefix: "overlay-output-link-" });
  try {
    const sandboxRoot = join(root, "sandbox");
    await Deno.mkdir(sandboxRoot, { recursive: true });
    const outputLink = join(root, "output-link");
    await Deno.symlink(sandboxRoot, outputLink);

    const error = await assertRejects(() =>
      planScenarioBindings({
        scenario: scenarioWith({ bindings: { "flow:research/step:compose": { service: "alpha" } } }),
        operatorOverlays: [],
        operatorBinds: [],
        // Lexically outside the sandbox, physically the sandbox: the agent could rewrite these.
        outputDir: outputLink,
        sandboxRoot,
      })
    );
    assertStringIncludes(String(error), "overlay_invalid");
    // The refusal happens before any overlay directory reaches the sandbox.
    assertEquals(await Array.fromAsync(Deno.readDir(sandboxRoot)).catch(() => []), []);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("[security] a bindings child symlink into the sandbox is refused before any overlay write", async () => {
  const root = await Deno.makeTempDir({ prefix: "overlay-bindings-link-" });
  try {
    const sandboxRoot = join(root, "sandbox");
    await Deno.mkdir(sandboxRoot, { recursive: true });
    const outputDir = join(root, "output");
    await Deno.mkdir(outputDir, { recursive: true });
    await Deno.symlink(sandboxRoot, join(outputDir, "bindings"));

    const error = await assertRejects(() =>
      planScenarioBindings({
        scenario: scenarioWith({ bindings: { "flow:research/step:compose": { service: "alpha" } } }),
        operatorOverlays: [],
        operatorBinds: [],
        outputDir,
        sandboxRoot,
      })
    );
    assertStringIncludes(String(error), "overlay_invalid");
    assertEquals(await Array.fromAsync(Deno.readDir(sandboxRoot)).catch(() => []), []);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("[security] a new valid output directory outside the sandbox remains usable", async () => {
  const root = await Deno.makeTempDir({ prefix: "overlay-valid-output-" });
  try {
    const sandboxRoot = join(root, "sandbox");
    await Deno.mkdir(sandboxRoot, { recursive: true });
    const plan = await planScenarioBindings({
      scenario: scenarioWith({ bindings: { "flow:research/step:compose": { service: "alpha" } } }),
      operatorOverlays: [],
      operatorBinds: [],
      outputDir: join(root, "output"),
      sandboxRoot,
    });

    assertEquals(plan.overlays.length, 1);
    const sandboxReal = await Deno.realPath(sandboxRoot);
    for (const overlay of plan.overlays) {
      const physical = await Deno.realPath(overlay.path);
      assertEquals(physical === sandboxReal || physical.startsWith(`${sandboxReal}/`), false);
    }
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("[security] the runner refuses a symlinked, directory or oversized operator overlay", async () => {
  const root = await Deno.makeTempDir({ prefix: "overlay-bounds-" });
  try {
    const real = join(root, "real.json");
    await Deno.writeTextFile(real, JSON.stringify({ schema: 1, bindings: { default: { model: "mock/a" } } }));
    const link = join(root, "link.json");
    await Deno.symlink(real, link);
    const directory = join(root, "overlay-dir");
    await Deno.mkdir(directory);
    const oversized = join(root, "big.json");
    await Deno.writeTextFile(oversized, " ".repeat(BINDING_OVERLAY_MAX_BYTES + 1));

    for (
      const [path, reason] of [[link, "not a regular file"], [directory, "not a regular file"], [oversized, "ceiling"]]
    ) {
      const outputDir = join(root, `output-${reason.replaceAll(" ", "-")}-${path.length}`);
      const error = await assertRejects(() =>
        planScenarioBindings({
          scenario: scenarioWith(),
          operatorOverlays: [path],
          operatorBinds: [],
          outputDir,
          sandboxRoot: join(root, "sandbox"),
        })
      );
      assertStringIncludes(String(error), "overlay_invalid");
      assertStringIncludes(String(error), reason);
      // The refusal happens before any overlay reaches the disk.
      assertEquals(await Array.fromAsync(Deno.readDir(outputDir)).catch(() => []), []);
    }
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("[security] a step id with path segments cannot place an overlay outside the bindings directory", async () => {
  const root = await Deno.makeTempDir({ prefix: "overlay-step-id-" });
  try {
    for (const id of ["../../escape", "nested/step", ".."]) {
      const scenario = scenarioWith({
        steps: [
          ScenarioStepSchema.parse({
            id,
            type: ScenarioStepType.EXACTL,
            command: "request",
            bindings: { default: { model: "mock/a" } },
          }),
        ],
      });
      const error = await assertRejects(() =>
        planScenarioBindings({
          scenario,
          operatorOverlays: [],
          operatorBinds: [],
          outputDir: join(root, "output"),
          sandboxRoot: join(root, "sandbox"),
        })
      );
      assertStringIncludes(String(error), "overlay_invalid");
    }
    const escaped = await Array.fromAsync(Deno.readDir(root));
    assertEquals(escaped.map((entry) => entry.name).filter((name) => name.endsWith(".json")), []);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
