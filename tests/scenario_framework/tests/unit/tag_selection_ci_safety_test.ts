/**
 * @module ScenarioFrameworkTagSelectionCiSafetyTest
 * @path tests/scenario_framework/tests/unit/tag_selection_ci_safety_test.ts
 * @description Phase 142 Step 7 — a set-shaped selection must not silently include scenarios that
 *   cannot pass on the tier being measured.
 *
 *   `CI_EXCLUDED_TAGS` was applied only on the profile-driven path (`modes.ts:229`), so
 *   `--tag subsystem:flows` — and even `--profile ci-extended --tag subsystem:flows` — selected
 *   `provider-live` and `manual-checkpoint` scenarios alongside the mock ones. Every tag-scoped
 *   baseline taken in this phase is therefore depressed by scenarios that were never going to pass
 *   on a mock provider: the flows baseline of "3 of 28" included at least four of them, and the
 *   mcp-client pack reported a mean over eleven scenarios when only four belong to that tier.
 *
 *   Three rules, each of which exists because the naive version is wrong:
 *
 *   - **A tag or pack selection is CI-safe by default.** It names a SET, and the caller means the
 *     runnable members of it.
 *   - **Asking for an excluded tag turns the filter off.** The nightly recipe selects
 *     `--tag provider-live`; a filter that stripped exactly what was asked for would return
 *     nothing, which is worse than the bug being fixed.
 *   - **An explicitly named scenario always runs.** `--scenario <id>` is an operator pointing at
 *     one thing; refusing it because of a tag would break every debugging session, and there is no
 *     baseline to protect when the selection is a singleton.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/modes.ts, tests/scenario_framework/runner/scenario_catalog.ts]
 */

import { assertEquals } from "@std/assert";
import { selectScenariosForExecution } from "../../runner/modes.ts";
import { ScenarioCiProfile } from "../../runner/config.ts";
import { ScenarioExecutionMode } from "../../schema/step_schema.ts";

const AUTO = [ScenarioExecutionMode.AUTO];
const MANUAL = [ScenarioExecutionMode.MANUAL_CHECKPOINT];

const SCENARIOS = [
  { id: "mock-a", pack: "flows", tags: ["subsystem:flows", "smoke"], mode_support: AUTO },
  { id: "mock-b", pack: "flows", tags: ["subsystem:flows"], mode_support: AUTO },
  { id: "live-a", pack: "flows", tags: ["subsystem:flows", "provider-live"], mode_support: AUTO },
  { id: "manual-a", pack: "flows", tags: ["subsystem:flows", "manual-only"], mode_support: MANUAL },
  { id: "checkpoint-a", pack: "flows", tags: ["subsystem:flows"], mode_support: MANUAL },
  { id: "other", pack: "tools", tags: ["subsystem:tools"], mode_support: AUTO },
];

function idsFor(options: Parameters<typeof selectScenariosForExecution>[0]): string[] {
  return selectScenariosForExecution(options).map((scenario) => scenario.id).sort();
}

Deno.test("[tag-safety] a tag selection excludes provider-live and non-auto scenarios", () => {
  assertEquals(
    idsFor({ scenarios: SCENARIOS, explicitTags: ["subsystem:flows"] }),
    ["mock-a", "mock-b"],
    "a subsystem tag must select only what the mock tier can run",
  );
});

Deno.test("[tag-safety] a pack selection is filtered the same way", () => {
  // `--pack` is as much a set selection as `--tag`; the Step 13 flows baseline was taken this way.
  assertEquals(idsFor({ scenarios: SCENARIOS, explicitPacks: ["flows"] }), ["mock-a", "mock-b"]);
});

Deno.test("[tag-safety] an excluded tag alongside a pack is the CI opt-in for that pack", () => {
  // `--pack swe_tasks --tag provider-live` is how an operator runs a provider-live pack. The
  // tag must opt the pack selection out of CI-safety filtering — it was silently dropped before,
  // filtering the whole pack to zero scenarios.
  assertEquals(
    idsFor({ scenarios: SCENARIOS, explicitPacks: ["flows"], explicitTags: ["provider-live"] }),
    ["checkpoint-a", "live-a", "manual-a", "mock-a", "mock-b"],
    "the excluded tag is a MODIFIER on the pack selection, not a second selector",
  );
});

Deno.test("[tag-safety] asking for an excluded tag turns the filter off", () => {
  // The nightly recipe's selection. Stripping exactly what was requested would return nothing.
  assertEquals(idsFor({ scenarios: SCENARIOS, explicitTags: ["provider-live"] }), ["live-a"]);
});

Deno.test("[tag-safety] an excluded tag alongside a subsystem tag widens the selection", () => {
  // `--tag subsystem:flows --tag provider-live` is the nightly per-subsystem form.
  assertEquals(
    idsFor({ scenarios: SCENARIOS, explicitTags: ["subsystem:flows", "provider-live"] }),
    ["checkpoint-a", "live-a", "manual-a", "mock-a", "mock-b"],
    "an explicit excluded tag opts the whole selection out of filtering — including the " +
      "manual-checkpoint scenario, which the nightly recipe drives interactively",
  );
});

Deno.test("[tag-safety] an explicitly named scenario always runs, whatever its tags", () => {
  assertEquals(idsFor({ scenarios: SCENARIOS, explicitScenarioIds: ["live-a"] }), ["live-a"]);
  assertEquals(idsFor({ scenarios: SCENARIOS, explicitScenarioIds: ["manual-a"] }), ["manual-a"]);
});

Deno.test("[tag-safety] naming several scenarios keeps all of them", () => {
  assertEquals(
    idsFor({ scenarios: SCENARIOS, explicitScenarioIds: ["mock-a", "live-a", "checkpoint-a"] }),
    ["checkpoint-a", "live-a", "mock-a"],
  );
});

Deno.test("[tag-safety] a profile combined with a tag still filters", () => {
  // Measured before the fix: `--profile ci-extended --tag subsystem:flows` selected provider-live
  // scenarios, because an explicit tag took the unfiltered branch and the profile was ignored.
  assertEquals(
    idsFor({ scenarios: SCENARIOS, explicitTags: ["subsystem:flows"], profile: ScenarioCiProfile.EXTENDED }),
    ["mock-a", "mock-b"],
  );
});

Deno.test("[tag-safety] the profile path is unchanged", () => {
  assertEquals(idsFor({ scenarios: SCENARIOS, profile: ScenarioCiProfile.SMOKE }), ["mock-a"]);
  assertEquals(
    idsFor({ scenarios: SCENARIOS, profile: ScenarioCiProfile.EXTENDED }),
    ["mock-a", "mock-b", "other"],
  );
});

// ---------------------------------------------------------------------------
// An excluded tag in the request is a MODIFIER, not a selector.
//
// `--tag` is OR across tags, so `--tag subsystem:mcp-client --tag provider-live` — the documented
// per-subsystem nightly form — unioned in every `provider-live` scenario from every pack, including
// the whole of swe_tasks. On a live tier that is real money spent on the wrong scenarios. The
// escape tag's job is to turn the CI-safety filter off for the subsystem being asked about; it is
// not itself a thing to select.
// ---------------------------------------------------------------------------

Deno.test("[tag-safety] an excluded tag does not widen the selection to other subsystems", () => {
  const scenarios = [
    ...SCENARIOS,
    { id: "other-live", pack: "tools", tags: ["subsystem:tools", "provider-live"], mode_support: AUTO },
  ];
  const selected = idsFor({ scenarios, explicitTags: ["subsystem:flows", "provider-live"] });

  assertEquals(
    selected.includes("other-live"),
    false,
    "a provider-live scenario from another subsystem must not be pulled in",
  );
  assertEquals(selected, ["checkpoint-a", "live-a", "manual-a", "mock-a", "mock-b"]);
});

Deno.test("[tag-safety] an excluded tag on its own still selects, so the whole live tier is reachable", () => {
  // With no other tag there is nothing else it could mean, and `--tag provider-live` is how an
  // operator asks for every live scenario at once.
  const scenarios = [
    ...SCENARIOS,
    { id: "other-live", pack: "tools", tags: ["subsystem:tools", "provider-live"], mode_support: AUTO },
  ];
  assertEquals(idsFor({ scenarios, explicitTags: ["provider-live"] }), ["live-a", "other-live"]);
});
