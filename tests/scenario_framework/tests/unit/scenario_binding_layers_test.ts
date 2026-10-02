/**
 * @module ScenarioBindingLayersTest
 * @path tests/scenario_framework/tests/unit/scenario_binding_layers_test.ts
 * @description Phase 203 Step 1 — `planScenarioBindings` writes the scenario layer and the
 *   operator layers as real `BindingOverlaySchema` documents into a runner-owned directory
 *   outside the sandbox, normalizes each operator overlay to JSON (the only form
 *   `exactl request --overlay` parses), substitutes the fixture-port sentinel, and records a
 *   sha256 per file. Phase 203 Step 2 adds the cell layer, which sits between the scenario
 *   and operator layers so a preset's bindings win over the scenario's.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/binding_layers.ts, tests/scenario_framework/schema/scenario_schema.ts]
 */

import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { BindingOverlaySchema } from "@exaix/schemas";
import { BINDING_OVERLAY_MAX_BYTES } from "@exaix/core";
import { BindingIncompatibleError } from "@exaix/ai";
import { type IScenario, ScenarioSchema } from "../../schema/scenario_schema.ts";
import { type IScenarioStep, ScenarioStepSchema, ScenarioStepType } from "../../schema/step_schema.ts";
import { SCHEMA_VERSION } from "../../schema/version.ts";
import { planScenarioBindings } from "../../runner/binding_layers.ts";
import { overlayRequestBindings } from "../../runner/matrix_expander.ts";

/** A minimal valid scenario, so the schema (not a cast) proves the new fields exist. */
function scenarioWith(extra: Partial<IScenario> = {}): IScenario {
  return ScenarioSchema.parse({
    schema_version: SCHEMA_VERSION,
    id: "bindings-smoke",
    title: "Bindings smoke",
    pack: "agent_flows",
    tags: ["smoke"],
    request_fixture: "fixtures/requests/agent_flows/openai_compatible_native.md",
    mode_support: ["auto"],
    portals: [],
    steps: [{ id: "submit", type: "exactl", command: "request" }],
    ...extra,
  });
}

/** The digest the runner should have recorded for the bytes now on disk. */
async function fileSha256(path: string): Promise<string> {
  const bytes = await Deno.readTextFile(path);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(bytes));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.test("[bindings] planScenarioBindings writes the scenario overlay with its bindings and catalog", async () => {
  const root = await Deno.makeTempDir({ prefix: "scenario-bindings-" });
  try {
    const outputDir = join(root, "output");
    const sandboxRoot = join(root, "sandbox");
    const plan = await planScenarioBindings({
      scenario: scenarioWith({
        bindings: { "flow:research/step:compose": { service: "alpha", model: "alpha/one" } },
        catalog: {
          models: { "alpha/one": { model_provider: "alpha" } },
          services: {
            alpha: { adapter: "mock", transport: "local", interface: "api", serves: { "alpha/one": "one" } },
          },
        },
      }),
      operatorOverlays: [],
      operatorBinds: [],
      outputDir,
      sandboxRoot,
    });

    assertEquals(plan.overlays.length, 1);
    const scenarioOverlay = plan.overlays[0]!;
    assertEquals(scenarioOverlay.role, "scenario");
    assertEquals(scenarioOverlay.path.endsWith("10-scenario.json"), true);
    assertEquals(scenarioOverlay.sha256, await fileSha256(scenarioOverlay.path));

    const written = BindingOverlaySchema.parse(JSON.parse(await Deno.readTextFile(scenarioOverlay.path)));
    assertEquals(written.bindings?.["flow:research/step:compose"]?.service, "alpha");
    assertEquals(written.catalog?.services?.alpha?.serves["alpha/one"], "one");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("[bindings] planScenarioBindings normalizes operator overlays in order and records sha256", async () => {
  const root = await Deno.makeTempDir({ prefix: "scenario-bindings-op-" });
  try {
    const outputDir = join(root, "output");
    const sandboxRoot = join(root, "sandbox");
    // A TOML-shaped source file must still arrive as JSON: exactl parses --overlay with JSON.parse.
    const firstPath = join(root, "first.json");
    await Deno.writeTextFile(
      firstPath,
      JSON.stringify({ schema: 1, bindings: { "flow:research/step:compose": { model: "alpha/one" } } }),
    );
    const secondPath = join(root, "second.json");
    await Deno.writeTextFile(
      secondPath,
      JSON.stringify({ schema: 1, bindings: { "role:web-explorer": { service: "beta" } } }),
    );

    const plan = await planScenarioBindings({
      scenario: scenarioWith({ bindings: { "flow:research/step:compose": { service: "alpha" } } }),
      operatorOverlays: [firstPath, secondPath],
      operatorBinds: [],
      outputDir,
      sandboxRoot,
    });

    assertEquals(plan.overlays.map((o) => o.role), ["scenario", "operator", "operator"]);
    const operators = plan.overlays.filter((o) => o.role === "operator");
    assertEquals(operators[0]!.path.endsWith("30-operator-0.json"), true);
    assertEquals(operators[1]!.path.endsWith("30-operator-1.json"), true);
    assertEquals(operators[0]!.sha256, await fileSha256(operators[0]!.path));
    assertEquals(operators[1]!.sha256, await fileSha256(operators[1]!.path));

    // Order is preserved: the first operator file holds the first overlay's selector.
    const first = BindingOverlaySchema.parse(JSON.parse(await Deno.readTextFile(operators[0]!.path)));
    assertEquals(first.bindings?.["flow:research/step:compose"]?.model, "alpha/one");
    const second = BindingOverlaySchema.parse(JSON.parse(await Deno.readTextFile(operators[1]!.path)));
    assertEquals(second.bindings?.["role:web-explorer"]?.service, "beta");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("[bindings] planScenarioBindings writes operator --bind entries as the last overlay", async () => {
  const root = await Deno.makeTempDir({ prefix: "scenario-bindings-binds-" });
  try {
    const plan = await planScenarioBindings({
      scenario: scenarioWith({ bindings: { "flow:research/step:compose": { service: "alpha" } } }),
      operatorOverlays: [],
      operatorBinds: ["flow:research/step:compose=service=beta,model=beta/two"],
      outputDir: join(root, "output"),
      sandboxRoot: join(root, "sandbox"),
    });

    assertEquals(plan.overlays.map((o) => o.role), ["scenario", "operator"]);
    const bindOverlay = plan.overlays[1]!;
    assertEquals(bindOverlay.path.endsWith("40-operator-bind.json"), true);
    const written = BindingOverlaySchema.parse(JSON.parse(await Deno.readTextFile(bindOverlay.path)));
    assertEquals(written.bindings?.["flow:research/step:compose"]?.service, "beta");
    assertEquals(written.bindings?.["flow:research/step:compose"]?.model, "beta/two");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("[bindings] planScenarioBindings substitutes the fixture-port sentinel before validation", async () => {
  const root = await Deno.makeTempDir({ prefix: "scenario-bindings-sentinel-" });
  try {
    // The endpoint schema is `z.string().url()`, so a sentinel can only arrive in a RAW overlay
    // file. It must be substituted before BindingOverlaySchema sees it, and never reach the daemon.
    const overlayPath = join(root, "fixture-overlay.json");
    await Deno.writeTextFile(
      overlayPath,
      JSON.stringify({
        schema: 1,
        catalog: {
          services: {
            fixture: {
              adapter: "openai-chat",
              profile: "self-hosted",
              endpoint: "http://127.0.0.1:__COMPAT_FIXTURE_PORT__/v1/chat/completions",
              transport: "local",
              interface: "api",
              serves: { "*": "{name}" },
            },
          },
        },
      }),
    );

    const plan = await planScenarioBindings({
      scenario: scenarioWith(),
      operatorOverlays: [overlayPath],
      operatorBinds: [],
      outputDir: join(root, "output"),
      sandboxRoot: join(root, "sandbox"),
      compatFixturePort: 43117,
    });

    const raw = await Deno.readTextFile(plan.overlays[0]!.path);
    assertEquals(raw.includes("__COMPAT_FIXTURE_PORT__"), false);
    const written = BindingOverlaySchema.parse(JSON.parse(raw));
    assertEquals(
      written.catalog?.services?.fixture?.endpoint,
      "http://127.0.0.1:43117/v1/chat/completions",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("[bindings] planScenarioBindings writes no scenario overlay when the scenario declares none", async () => {
  const root = await Deno.makeTempDir({ prefix: "scenario-bindings-empty-" });
  try {
    const plan = await planScenarioBindings({
      scenario: scenarioWith(),
      operatorOverlays: [],
      operatorBinds: [],
      outputDir: join(root, "output"),
      sandboxRoot: join(root, "sandbox"),
    });
    assertEquals(plan.overlays, []);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("[bindings] planScenarioBindings writes the cell layer between the scenario and operator layers", async () => {
  const root = await Deno.makeTempDir({ prefix: "scenario-bindings-cell-" });
  try {
    const plan = await planScenarioBindings({
      scenario: scenarioWith({ bindings: { default: { model: "alpha/one" } } }),
      cell: {
        bindings: { default: { model: "beta/two" } },
        catalog: {
          services: {
            fixture: { adapter: "mock", transport: "local", interface: "api", serves: { "*": "{name}" } },
          },
        },
      },
      operatorOverlays: [],
      operatorBinds: [],
      outputDir: join(root, "output"),
      sandboxRoot: join(root, "sandbox"),
    });

    assertEquals(plan.overlays.map((overlay) => overlay.role), ["scenario", "cell"]);
    const cellOverlay = plan.overlays[1]!;
    assertEquals(cellOverlay.path.endsWith("20-cell.json"), true);
    assertEquals(cellOverlay.sha256, await fileSha256(cellOverlay.path));

    const written = BindingOverlaySchema.parse(JSON.parse(await Deno.readTextFile(cellOverlay.path)));
    assertEquals(written.bindings?.default?.model, "beta/two");
    assertEquals(written.catalog?.services?.fixture?.adapter, "mock");

    // Argument order lets the cell win. The daemon collapses same-selector entries in load
    // order, so the cell must arrive after the scenario.
    const step = {
      id: "submit",
      type: ScenarioStepType.EXACTL,
      command: "request",
      args: ["--file", "x"],
    } as IScenarioStep;
    const args = overlayRequestBindings([step], plan)[0]!.args ?? [];
    const overlays = args.flatMap((arg, index) => (arg === "--overlay" ? [args[index + 1]!] : []));
    assertEquals(overlays, [plan.overlays[0]!.path, cellOverlay.path]);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("[bindings] a cell that binds without a scenario layer still produces its own overlay", async () => {
  const root = await Deno.makeTempDir({ prefix: "scenario-bindings-cell-only-" });
  try {
    const plan = await planScenarioBindings({
      scenario: scenarioWith(),
      cell: { bindings: { default: { model: "beta/two" } } },
      operatorOverlays: [],
      operatorBinds: [],
      outputDir: join(root, "output"),
      sandboxRoot: join(root, "sandbox"),
    });

    assertEquals(plan.overlays.map((overlay) => overlay.role), ["cell"]);
    const written = BindingOverlaySchema.parse(JSON.parse(await Deno.readTextFile(plan.overlays[0]!.path)));
    assertEquals(written.bindings?.default?.model, "beta/two");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("[bindings] the cell layer substitutes the fixture-port sentinel a preset catalog carries", async () => {
  const root = await Deno.makeTempDir({ prefix: "scenario-bindings-cell-sentinel-" });
  try {
    // A preset is loaded before the fixture port exists, so its endpoint keeps the sentinel
    // until this point. The strict endpoint schema would reject it, so substitute first.
    const plan = await planScenarioBindings({
      scenario: scenarioWith(),
      cell: {
        catalog: {
          services: {
            fixture: {
              adapter: "openai-chat",
              profile: "self-hosted",
              endpoint: "http://127.0.0.1:__COMPAT_FIXTURE_PORT__/v1/chat/completions",
              transport: "local",
              interface: "api",
              serves: { "*": "{name}" },
            },
          },
        },
      },
      operatorOverlays: [],
      operatorBinds: [],
      outputDir: join(root, "output"),
      sandboxRoot: join(root, "sandbox"),
      compatFixturePort: 43117,
    });

    const raw = await Deno.readTextFile(plan.overlays[0]!.path);
    assertEquals(raw.includes("__COMPAT_FIXTURE_PORT__"), false);
    const written = BindingOverlaySchema.parse(JSON.parse(raw));
    assertEquals(
      written.catalog?.services?.fixture?.endpoint,
      "http://127.0.0.1:43117/v1/chat/completions",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

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

// --- Phase 203 Step 4: scenario pins ---

/** A scenario that pins two fields of one flow step to the alpha service. */
function pinnedScenario(): IScenario {
  return scenarioWith({
    bindings: { "flow:research/step:compose": { service: "alpha", model: "alpha/one" } },
    pin: [{
      selector: "flow:research/step:compose",
      fields: ["service", "model"],
      reason: "provider-qualification",
      note: "qualifies the alpha provider against its signed contract",
    }],
  });
}

/** One operator overlay file, as an operator would hand it to the runner. */
async function writeOperatorOverlay(root: string, bindings: Record<string, object>): Promise<string> {
  const path = join(root, "operator.json");
  await Deno.writeTextFile(path, JSON.stringify({ schema: 1, bindings }));
  return path;
}

function operatorOverlayOf(plan: Awaited<ReturnType<typeof planScenarioBindings>>) {
  return plan.overlays.find((overlay) => overlay.role === "operator")!;
}

Deno.test("[pins] an operator entry at least as specific as the pin that changes a pinned field fails with code pinned and the pin reason", async () => {
  const root = await Deno.makeTempDir({ prefix: "pins-exact-" });
  try {
    const base = {
      scenario: pinnedScenario(),
      operatorOverlays: [],
      outputDir: join(root, "output"),
      sandboxRoot: join(root, "sandbox"),
    };

    // An equal value passes, and an unpinned field at the same selector stays overridable.
    const equal = await planScenarioBindings({
      ...base,
      operatorBinds: ["flow:research/step:compose=service=alpha,service_model_id=alpha-one"],
    });
    assertEquals(equal.pins, []);
    const kept = BindingOverlaySchema.parse(
      JSON.parse(await Deno.readTextFile(operatorOverlayOf(equal).path)),
    );
    assertEquals(kept.bindings?.["flow:research/step:compose"]?.service_model_id, "alpha-one");

    // A different value at the pin's own selector is an exact override, so the run stops.
    const error = await assertRejects(
      () => planScenarioBindings({ ...base, operatorBinds: ["flow:research/step:compose=model=alpha/two"] }),
      BindingIncompatibleError,
    );
    assertEquals(error.issues[0]?.code, "pinned");
    assertEquals(error.issues[0]?.selector, "flow:research/step:compose");
    assertStringIncludes(error.issues[0]?.detail ?? "", "qualifies the alpha provider");
    assertStringIncludes(error.issues[0]?.detail ?? "", "model");
    assertStringIncludes(error.issues[0]?.detail ?? "", "--bind");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("[pins] a broader operator overlay has each pinned field stripped and recorded as pin_kept", async () => {
  const root = await Deno.makeTempDir({ prefix: "pins-broad-overlay-" });
  try {
    const overlayPath = await writeOperatorOverlay(root, {
      default: { service: "beta", model: "beta/two", transport: "cloud" },
    });

    const plan = await planScenarioBindings({
      scenario: pinnedScenario(),
      operatorOverlays: [overlayPath],
      operatorBinds: [],
      outputDir: join(root, "output"),
      sandboxRoot: join(root, "sandbox"),
    });

    // The pinned fields never reach the written overlay, so no layer order can defeat the pin.
    const written = BindingOverlaySchema.parse(JSON.parse(await Deno.readTextFile(operatorOverlayOf(plan).path)));
    assertEquals(written.bindings?.default?.service, undefined);
    assertEquals(written.bindings?.default?.model, undefined);
    // The entry keeps the fields the pin does not name.
    assertEquals(written.bindings?.default?.transport, "cloud");

    assertEquals(plan.pins.map((pin) => [pin.field, pin.value, pin.skipped_selector, pin.reason]), [
      ["service", "alpha", "default", "provider-qualification"],
      ["model", "alpha/one", "default", "provider-qualification"],
    ]);
    assertStringIncludes(plan.pins[0]?.source ?? "", overlayPath);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("[pins] a broad operator --bind that changes a pinned field is stripped too", async () => {
  const root = await Deno.makeTempDir({ prefix: "pins-broad-bind-" });
  try {
    const plan = await planScenarioBindings({
      scenario: pinnedScenario(),
      operatorOverlays: [],
      operatorBinds: ["default=service=beta,model=beta/two,transport=cloud"],
      outputDir: join(root, "output"),
      sandboxRoot: join(root, "sandbox"),
    });

    const written = BindingOverlaySchema.parse(JSON.parse(await Deno.readTextFile(operatorOverlayOf(plan).path)));
    assertEquals(written.bindings?.default?.service, undefined);
    assertEquals(written.bindings?.default?.model, undefined);
    assertEquals(written.bindings?.default?.transport, "cloud");
    // The daemon would therefore resolve the pinned values from the scenario layer.
    assertEquals(plan.pins.map((pin) => pin.value), ["alpha", "alpha/one"]);
    assertStringIncludes(plan.pins[0]?.source ?? "", "--bind");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("[pins] no pins overlay is written for any scenario", async () => {
  const root = await Deno.makeTempDir({ prefix: "pins-no-overlay-" });
  try {
    const plan = await planScenarioBindings({
      scenario: pinnedScenario(),
      operatorOverlays: [],
      operatorBinds: ["default=service=beta"],
      outputDir: join(root, "output"),
      sandboxRoot: join(root, "sandbox"),
    });
    for (const overlay of plan.overlays) {
      assertEquals(overlay.path.includes("90-scenario-pins"), false, overlay.path);
    }
    // The broader entry is stripped rather than refused, so the pin still holds its value.
    assertEquals(plan.pins.map((pin) => [pin.field, pin.value]), [["service", "alpha"]]);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("[pins] a cell preset may change a scenario-pinned field at the pin's selector", async () => {
  const root = await Deno.makeTempDir({ prefix: "pins-cell-" });
  try {
    const plan = await planScenarioBindings({
      scenario: pinnedScenario(),
      cell: { bindings: { "flow:research/step:compose": { model: "beta/two" } } },
      operatorOverlays: [],
      // The cell set the pinned model, so an operator must now match beta/two.
      operatorBinds: ["flow:research/step:compose=model=beta/two"],
      outputDir: join(root, "output"),
      sandboxRoot: join(root, "sandbox"),
    });
    assertEquals(plan.pins, []);

    const error = await assertRejects(
      () =>
        planScenarioBindings({
          scenario: pinnedScenario(),
          cell: { bindings: { "flow:research/step:compose": { model: "beta/two" } } },
          operatorOverlays: [],
          operatorBinds: ["flow:research/step:compose=model=alpha/one"],
          outputDir: join(root, "output2"),
          sandboxRoot: join(root, "sandbox"),
        }),
      BindingIncompatibleError,
    );
    assertStringIncludes(error.issues[0]?.detail ?? "", "beta/two");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("[pins] a scenario binding more specific than the pin that contradicts it is rejected at load", async () => {
  const root = await Deno.makeTempDir({ prefix: "pins-load-" });
  try {
    // The pin speaks for the whole flow. A step-exact binding contradicts it.
    const scenario = scenarioWith({
      bindings: {
        "flow:research": { model: "alpha/one" },
        "flow:research/step:compose": { model: "beta/two" },
      },
      pin: [{
        selector: "flow:research",
        fields: ["model"],
        reason: "wire-compat-regression",
        note: "the research flow speaks one wire format only",
      }],
    });

    const error = await assertRejects(
      () =>
        planScenarioBindings({
          scenario,
          operatorOverlays: [],
          operatorBinds: [],
          outputDir: join(root, "output"),
          sandboxRoot: join(root, "sandbox"),
        }),
      BindingIncompatibleError,
    );
    assertEquals(error.issues[0]?.code, "pinned");
    assertEquals(error.issues[0]?.selector, "flow:research/step:compose");
    assertStringIncludes(error.issues[0]?.detail ?? "", "wire-compat-regression");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("[pins] a judge selector never contradicts a flow-step pin", async () => {
  const root = await Deno.makeTempDir({ prefix: "pins-judge-family-" });
  try {
    // A judge binding cannot change the value a flow-step pin protects.
    // A judge ref matches judge selectors only, so the two never meet.
    const cellLayer = await planScenarioBindings({
      scenario: pinnedScenario(),
      cell: { bindings: { judge: { service: "claude-cli", model: "anthropic/claude-sonnet-5" } } },
      operatorOverlays: [],
      operatorBinds: [],
      outputDir: join(root, "output"),
      sandboxRoot: join(root, "sandbox"),
    });
    assertEquals(cellLayer.pins, []);
    assertEquals(cellLayer.overlays.map((overlay) => overlay.role).sort(), ["cell", "scenario"]);

    // An operator judge entry survives untouched, because the pin does not speak for judges.
    const operatorEntry = await planScenarioBindings({
      scenario: pinnedScenario(),
      operatorBinds: ["judge=service=claude-cli"],
      operatorOverlays: [],
      outputDir: join(root, "output-2"),
      sandboxRoot: join(root, "sandbox"),
    });
    assertEquals(operatorEntry.pins, []);
    const document = BindingOverlaySchema.parse(
      JSON.parse(await Deno.readTextFile(operatorOverlayOf(operatorEntry).path)),
    );
    assertEquals(document.bindings?.judge?.service, "claude-cli");

    // A judge selector at least as specific as an agent pin is still refused to judges.
    const judgePin = scenarioWith({
      bindings: { judge: { service: "alpha", model: "alpha/one" } },
      pin: [{
        selector: "judge",
        fields: ["service"],
        reason: "capability-gate",
        note: "the graded judge stays on the reviewed service",
      }],
    });
    const judgeRefusal = await assertRejects(
      () =>
        planScenarioBindings({
          scenario: judgePin,
          operatorBinds: ["judge=service=beta"],
          operatorOverlays: [],
          outputDir: join(root, "output-3"),
          sandboxRoot: join(root, "sandbox"),
        }),
      BindingIncompatibleError,
    );
    assertEquals(judgeRefusal.issues[0]?.code, "pinned");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

/** A pin protecting `service` at one selector, with the reason and note the schema requires. */
function servicePin(selector: string) {
  return { selector, fields: ["service" as const], reason: "capability-gate" as const, note: "frozen for the gate" };
}

Deno.test("[pins] a scenario with two pins enforces each one", async () => {
  const root = await Deno.makeTempDir({ prefix: "pins-two-" });
  try {
    const scenario = scenarioWith({
      bindings: {
        "flow:research/step:compose": { service: "alpha", model: "alpha/one" },
        judge: { service: "alpha", model: "alpha/one" },
      },
      pin: [servicePin("flow:research/step:compose"), servicePin("judge")],
    });
    const base = {
      scenario,
      operatorOverlays: [],
      outputDir: join(root, "output"),
      sandboxRoot: join(root, "sandbox"),
    };

    const composeError = await assertRejects(
      () => planScenarioBindings({ ...base, operatorBinds: ["flow:research/step:compose=service=beta"] }),
      BindingIncompatibleError,
    );
    assertEquals(composeError.issues[0].code, "pinned");
    const judgeError = await assertRejects(
      () => planScenarioBindings({ ...base, operatorBinds: ["judge=service=beta"] }),
      BindingIncompatibleError,
    );
    assertEquals(judgeError.issues[0].code, "pinned");
    assertStringIncludes(judgeError.issues[0].detail, 'selector "judge"');
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("[pins] an operator entry for a sibling step of a pinned step is not refused", async () => {
  const root = await Deno.makeTempDir({ prefix: "pins-sibling-" });
  try {
    const plan = await planScenarioBindings({
      scenario: pinnedScenario(),
      operatorOverlays: [],
      operatorBinds: ["flow:research/step:explore-1=service=beta"],
      outputDir: join(root, "output"),
      sandboxRoot: join(root, "sandbox"),
    });

    assertEquals(plan.pins, []);
    const written = BindingOverlaySchema.parse(JSON.parse(await Deno.readTextFile(operatorOverlayOf(plan).path)));
    assertEquals(written.bindings?.["flow:research/step:explore-1"], { service: "beta" });
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("[pins] a step binding that contradicts a pin is refused at load", async () => {
  const root = await Deno.makeTempDir({ prefix: "pins-step-" });
  try {
    const scenario = scenarioWith({
      bindings: { default: { service: "alpha", model: "alpha/one" } },
      pin: [servicePin("default")],
      steps: [ScenarioStepSchema.parse({
        id: "submit",
        type: ScenarioStepType.EXACTL,
        command: "request",
        bindings: { "flow:research/step:compose": { service: "beta" } },
      })],
    });

    const error = await assertRejects(
      () =>
        planScenarioBindings({
          scenario,
          operatorOverlays: [],
          operatorBinds: [],
          outputDir: join(root, "output"),
          sandboxRoot: join(root, "sandbox"),
        }),
      BindingIncompatibleError,
    );
    assertEquals(error.issues[0].code, "pinned");
    assertStringIncludes(error.issues[0].detail, "step submit");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

/** The bindings the runner wrote for the operator's --bind entries. */
async function writtenBindEntries(binds: string[]) {
  const root = await Deno.makeTempDir({ prefix: "bind-merge-" });
  try {
    const plan = await planScenarioBindings({
      scenario: scenarioWith(),
      operatorOverlays: [],
      operatorBinds: binds,
      outputDir: join(root, "output"),
      sandboxRoot: join(root, "sandbox"),
    });
    return BindingOverlaySchema.parse(JSON.parse(await Deno.readTextFile(operatorOverlayOf(plan).path))).bindings;
  } finally {
    await Deno.remove(root, { recursive: true });
  }
}

Deno.test("[bind] two --bind flags on one selector keep both fields", async () => {
  const bindings = await writtenBindEntries(["default=model=mock/a", "default=service=mock"]);
  assertEquals(bindings?.default, { model: "mock/a", service: "mock" });
});

Deno.test("[bind] a later --bind overrides an earlier one per field", async () => {
  const bindings = await writtenBindEntries(["default=model=mock/a,service=alpha", "default=model=mock/b"]);
  assertEquals(bindings?.default, { model: "mock/b", service: "alpha" });
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
