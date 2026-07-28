/**
 * @module ScenarioFrameworkSubsystemCadenceSelectionTest
 * @path tests/scenario_framework/tests/unit/subsystem_cadence_selection_test.ts
 * @description Phase 142 Step 7 — the three cadence tiers select what they claim to.
 *
 *   ci-core is the tier that runs on every change, so a subsystem with no `smoke`-tagged scenario
 *   is silently uncovered there — and `subsystem:tools`, the largest pack at 16 scenarios, had
 *   exactly zero. A profile that quietly omits a subsystem is worse than one that omits it loudly:
 *   the report still renders, just without the row nobody notices is missing.
 *
 *   ci-extended is the full mock tier, so it must carry every subsystem and no `provider-live` or
 *   `manual-only` scenario — those cannot pass without a real model and would turn the tier red for
 *   a reason unrelated to the change under test.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/modes.ts, tests/scenario_framework/runner/scenario_catalog.ts]
 */

import { assert, assertEquals } from "@std/assert";
import { join, resolve } from "@std/path";
import { walk } from "@std/fs";
import { withEnv } from "@exaix/testing";
import { CI_EXCLUDED_TAGS, loadScenarioCatalog } from "../../runner/scenario_catalog.ts";
import { selectScenariosForExecution } from "../../runner/modes.ts";
import { ScenarioCiProfile } from "../../runner/config.ts";
import { SUBSYSTEM_TAGS } from "../../runner/pack_mutations.ts";

const FRAMEWORK_HOME = resolve(import.meta.dirname!, "..", "..");

async function catalogScenarios() {
  const catalog = await loadScenarioCatalog({ frameworkHome: FRAMEWORK_HOME });
  return catalog.map((entry) => ({
    id: entry.id,
    pack: entry.pack,
    tags: entry.tags,
    mode_support: entry.mode_support,
    edition: entry.edition,
  }));
}

/**
 * The `subsystem:mcp-server` pack is `edition: team`, so it is correctly absent from every
 * selection on a Solo build. Coverage is therefore asserted under Team, where all six exist, and
 * the Solo exclusion gets its own test — that asymmetry IS the edition-correctness the step asks
 * for, and asserting six subsystems on Solo would demand a pack that must not run there.
 */
async function selectUnderEdition(
  edition: string,
  scenarios: Awaited<ReturnType<typeof catalogScenarios>>,
  profile: ScenarioCiProfile,
): Promise<{ tags: string[]; id: string }[]> {
  // `withEnv` restores the previous value but does not pass a return value through, so the
  // selection is captured by closure.
  let selected: { tags: string[]; id: string }[] = [];
  await withEnv({ EXAIX_EDITION: edition }, () => {
    selected = selectScenariosForExecution({ scenarios, profile });
  });
  return selected;
}

function subsystemsCovered(selected: { tags: string[] }[]): Set<string> {
  const covered = new Set<string>();
  for (const scenario of selected) {
    for (const tag of scenario.tags) {
      if ((SUBSYSTEM_TAGS as readonly string[]).includes(tag)) covered.add(tag);
    }
  }
  return covered;
}

Deno.test("[cadence] ci-core carries at least one smoke scenario for every subsystem", async () => {
  const scenarios = await catalogScenarios();
  const selected = await selectUnderEdition("team", scenarios, ScenarioCiProfile.CORE);
  const covered = subsystemsCovered(selected);
  const uncovered = SUBSYSTEM_TAGS.filter((tag) => !covered.has(tag));

  assertEquals(
    uncovered,
    [],
    `ci-core runs on every change; these subsystems are silently uncovered there:\n${uncovered.join("\n")}`,
  );
});

Deno.test("[cadence] a Solo build excludes the Team-gated subsystem, and only that one", async () => {
  const scenarios = await catalogScenarios();
  const solo = await selectUnderEdition("solo", scenarios, ScenarioCiProfile.EXTENDED);

  const covered = subsystemsCovered(solo);
  assertEquals(
    SUBSYSTEM_TAGS.filter((tag) => !covered.has(tag)),
    ["subsystem:mcp-server"],
    "mcp-server is edition: team; every other subsystem must run on Solo",
  );
});

Deno.test("[cadence] ci-extended carries every subsystem", async () => {
  const scenarios = await catalogScenarios();
  const selected = await selectUnderEdition("team", scenarios, ScenarioCiProfile.EXTENDED);
  const uncovered = SUBSYSTEM_TAGS.filter((tag) => !subsystemsCovered(selected).has(tag));
  assertEquals(uncovered, [], `ci-extended is the full mock tier; missing:\n${uncovered.join("\n")}`);
});

Deno.test("[cadence] no CI profile selects a scenario that cannot run on the mock tier", async () => {
  const scenarios = await catalogScenarios();
  for (const profile of [ScenarioCiProfile.SMOKE, ScenarioCiProfile.CORE, ScenarioCiProfile.EXTENDED]) {
    const offenders = selectScenariosForExecution({ scenarios, profile })
      .filter((scenario) => scenario.tags.some((tag) => (CI_EXCLUDED_TAGS as readonly string[]).includes(tag)))
      .map((scenario) => `${profile}: ${scenario.id}`);
    assertEquals(offenders, [], `these would turn a CI tier red for want of a real model:\n${offenders.join("\n")}`);
  }
});

Deno.test("[cadence] the tiers nest — smoke ⊆ core ⊆ extended", async () => {
  // A scenario that runs in a cheaper tier but not a richer one means a regression could pass
  // ci-extended after failing ci-core, which is incoherent as a cadence.
  const scenarios = await catalogScenarios();
  const ids = (profile: ScenarioCiProfile) =>
    new Set(selectScenariosForExecution({ scenarios, profile }).map((scenario) => scenario.id));

  const smoke = ids(ScenarioCiProfile.SMOKE);
  const core = ids(ScenarioCiProfile.CORE);
  const extended = ids(ScenarioCiProfile.EXTENDED);

  const smokeNotInCore = [...smoke].filter((id) => !core.has(id));
  const coreNotInExtended = [...core].filter((id) => !extended.has(id));

  assertEquals(smokeNotInCore, [], "every smoke scenario must also run in ci-core");
  assertEquals(coreNotInExtended, [], "every ci-core scenario must also run in ci-extended");
});

Deno.test("[cadence] every subsystem tag in the catalog is one the phase defines", async () => {
  // Guards the reader above: a typo'd `subsystem:tool` would make a pack invisible to every check
  // in this file while still looking tagged.
  const unknown = new Set<string>();
  for (const scenario of await catalogScenarios()) {
    for (const tag of scenario.tags) {
      if (!tag.startsWith("subsystem:")) continue;
      if (!(SUBSYSTEM_TAGS as readonly string[]).includes(tag)) unknown.add(tag);
    }
  }
  assertEquals([...unknown].sort(), [], `subsystem tags outside the declared taxonomy`);
});

Deno.test("[cadence] ci-core is a proper subset of ci-extended, not equal to it", async () => {
  // If the two tiers select the same set, the cheaper tier buys nothing and the cadence is a
  // fiction — which is what "wire the three tiers" is meant to prevent.
  const scenarios = await catalogScenarios();
  const core = selectScenariosForExecution({ scenarios, profile: ScenarioCiProfile.CORE });
  const extended = selectScenariosForExecution({ scenarios, profile: ScenarioCiProfile.EXTENDED });
  // ci-core and ci-smoke select the same SCENARIOS by design — ci-core's extra content is the
  // parity gates, which are deno tests (`deno task test:parity`) rather than scenarios.
  assert(
    core.length < extended.length,
    `ci-core selects ${core.length} and ci-extended ${extended.length}; a cheap tier must be cheaper`,
  );
});

Deno.test("[cadence] a provider-live scenario never pins the provider to mock", async () => {
  // `step.env` is merged LAST by the runner, so `EXA_LLM_PROVIDER: "mock"` in a step overrides
  // whatever the operator sets. Four `selection-*` scenarios carried that pin after Step 15 moved
  // them to the provider-live tier, which meant the tier they were moved to could never execute
  // them — they would have run on the mock provider and reproduced exactly the zero-tool-call
  // result that got them moved.
  const offenders: string[] = [];
  for (const scenario of await catalogScenarios()) {
    if (!scenario.tags.includes("provider-live")) continue;
    const path = join(FRAMEWORK_HOME, "scenarios");
    for await (const entry of walk(path, { exts: [".yaml"], includeDirs: false })) {
      const text = await Deno.readTextFile(entry.path);
      if (!text.includes(`id: "${scenario.id}"`)) continue;
      if (/EXA_LLM_PROVIDER:\s*"mock"/.test(text)) offenders.push(scenario.id);
    }
  }
  assertEquals([...new Set(offenders)].sort(), [], `provider-live scenarios pinned to the mock provider`);
});
