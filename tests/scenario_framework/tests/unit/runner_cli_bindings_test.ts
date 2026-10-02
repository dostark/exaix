/**
 * @module RunnerCliBindingsTest
 * @path tests/scenario_framework/tests/unit/runner_cli_bindings_test.ts
 * @description Phase 203 Step 1 — the scenario runner's `--overlay` and `--bind` flags. `--bind`
 *   accepts the same grammar as `exactl request --bind` and rejects a malformed spec before any
 *   run starts. Both flags are repeatable, which the runner CLI expresses with cliffy's
 *   `collect: true`; the source assertion below pins that, since the CLI action cannot be invoked
 *   in-process.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/main.ts, tests/scenario_framework/runner/binding_layers.ts]
 */

import { assert, assertEquals, assertThrows } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { parseScenarioBindSpecs } from "../../runner/binding_layers.ts";

const REPO_ROOT = fromFileUrl(new URL("../../../../", import.meta.url));

Deno.test("[cli] parseScenarioBindSpecs accepts the exactl --bind grammar", () => {
  assertEquals(
    parseScenarioBindSpecs(["flow:research/step:compose=service=openai,model=openai/gpt-6-luna"]),
    [{ selector: "flow:research/step:compose", spec: { service: "openai", model: "openai/gpt-6-luna" } }],
  );
  // A repeated spec becomes one entry per occurrence, in order.
  assertEquals(
    parseScenarioBindSpecs(["judge=service=claude-cli", "default=service=openai"]).map((entry) => entry.selector),
    ["judge", "default"],
  );
});

Deno.test("[cli] parseScenarioBindSpecs rejects a malformed spec with overlay_invalid", () => {
  assertThrows(() => parseScenarioBindSpecs(["no-equals-here"]), Error, "overlay_invalid");
  assertThrows(() => parseScenarioBindSpecs(["default=service"]), Error, "overlay_invalid");
  assertThrows(() => parseScenarioBindSpecs(["=service=openai"]), Error, "overlay_invalid");
});

Deno.test("[cli] the runner declares --overlay and --bind as repeatable options", async () => {
  const source = await Deno.readTextFile(join(REPO_ROOT, "tests", "scenario_framework", "runner", "main.ts"));
  for (const flag of ["--overlay <file:string>", "--bind <spec:string>"]) {
    assert(source.includes(flag), `main.ts must declare ${flag}`);
  }
  // Each declaration must carry collect: true, or a second occurrence would overwrite the first.
  const overlayOptions = source.slice(source.indexOf("--overlay <file:string>"));
  assert(
    overlayOptions.slice(0, overlayOptions.indexOf(".option")).includes("collect: true"),
    "--overlay must be a repeatable (collect) option",
  );
  const bindOptions = source.slice(source.indexOf("--bind <spec:string>"));
  assert(
    bindOptions.slice(0, bindOptions.indexOf(".option")).includes("collect: true"),
    "--bind must be a repeatable (collect) option",
  );
});
