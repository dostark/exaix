/**
 * @module ScenarioPinInventoryTest
 * @path tests/scenario_framework/tests/unit/scenario_pin_inventory_test.ts
 * @description Phase 203 Step 7 — the pin inventory. Every scenario pin must state a reason from
 *   the shipped enum and a non-empty note, and the value it freezes must resolve through the real
 *   resolver against the catalog the daemon reads. A pin that names a value the catalog cannot
 *   resolve freezes nothing, so the inventory proves both at once and prints the count.
 * @architectural-layer Test
 * @dependencies [@std/yaml, @std/toml, @exaix/schemas, @exaix/model-registry, @exaix/ai]
 * @related-files [
 *   "tests/scenario_framework/schema/scenario_schema.ts",
 *   "packages/ai/src/bindings/binding_layers.ts"
 * ]
 */

import { assert, assertEquals } from "@std/assert";
import { parse as parseYaml } from "@std/yaml";
import { parse as parseToml } from "@std/toml";
import { fromFileUrl, join, resolve } from "@std/path";
import { buildBuiltInCatalog, mergeCatalogs } from "@exaix/model-registry";
import { type IBindingCatalog, type IBindingLayers, type IBindingStepRef, PinReasonSchema } from "@exaix/schemas";
import { resolveBinding } from "@exaix/ai";
import { type IScenario, ScenarioSchema } from "../../schema/scenario_schema.ts";
import { SENTINEL_COMPAT_FIXTURE_PORT } from "../../runner/sentinels.ts";

const FRAMEWORK_HOME = fromFileUrl(new URL("../../", import.meta.url));
const REPO_ROOT = fromFileUrl(new URL("../../../../", import.meta.url));
const SCENARIOS_DIR = resolve(FRAMEWORK_HOME, "scenarios");

/** The port a fixture scenario would resolve its sentinel to. Any valid port proves resolution. */
const FIXTURE_PORT = 8123;

async function scenarioFiles(dir: string): Promise<string[]> {
  const found: string[] = [];
  for await (const entry of Deno.readDir(dir)) {
    const path = join(dir, entry.name);
    if (entry.isDirectory) found.push(...await scenarioFiles(path));
    else if (entry.name.endsWith(".yaml")) found.push(path);
  }
  return found.sort();
}

/** The catalog the daemon reads: the built-ins merged with the scenario's cell config catalogs. */
async function catalogFor(scenario: IScenario): Promise<IBindingCatalog> {
  let catalog = buildBuiltInCatalog();
  for (const cell of scenario.matrix?.cells ?? []) {
    const raw = await Deno.readTextFile(resolve(REPO_ROOT, cell.config)).catch(() => undefined);
    if (raw === undefined) continue;
    const parsed = parseToml(raw.replaceAll(SENTINEL_COMPAT_FIXTURE_PORT, String(FIXTURE_PORT))) as {
      catalog?: IBindingCatalog;
    };
    if (parsed.catalog) catalog = mergeCatalogs(catalog, parsed.catalog);
  }
  return catalog;
}

const PROBE = { hasKey: (): boolean => true, hasOptIn: (): boolean => true };
const REF: IBindingStepRef = {
  flowId: "pin-inventory",
  stepId: "step",
  agentRole: "senior-coder",
  kind: "agent",
  nativeTools: true,
};

Deno.test("[phase203.pins] every pin states a reason and a note, and its binding resolves", async () => {
  const pinned: string[] = [];

  for (const path of await scenarioFiles(SCENARIOS_DIR)) {
    const parsed = ScenarioSchema.safeParse(parseYaml(await Deno.readTextFile(path)));
    assert(parsed.success, `${path} does not parse as a scenario`);
    const scenario = parsed.data;
    const pin = scenario.pin;
    if (!pin) continue;

    const relative = path.slice(SCENARIOS_DIR.length + 1);
    pinned.push(relative);

    assert(PinReasonSchema.options.includes(pin.reason), `${relative} has reason '${pin.reason}'`);
    assertEquals(pin.note.trim().length > 0, true, `${relative} needs a non-empty note`);
    assert(pin.fields.length > 0, `${relative} must pin at least one field`);

    const spec = scenario.bindings?.[pin.selector];
    assert(spec !== undefined, `${relative} pins selector '${pin.selector}' with no scenario binding`);

    const layers: IBindingLayers = {
      entries: [{ layer: "config", selector: pin.selector, spec }],
      catalog: await catalogFor(scenario),
      overlaySha256: [],
      operatorLayersPresent: false,
    };
    const outcome = resolveBinding(REF, {}, layers, PROBE);
    assertEquals(
      outcome.kind,
      "bound",
      `${relative} pin binding must resolve, got ${JSON.stringify(outcome).slice(0, 200)}`,
    );
  }

  console.log(`[phase203.pins] ${pinned.length} pinned scenario(s): ${pinned.join(", ")}`);
  assert(pinned.length >= 9, `expected the 9 compatible scenarios to be pinned, found ${pinned.length}`);
});
