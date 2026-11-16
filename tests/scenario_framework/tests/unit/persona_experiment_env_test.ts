/**
 * @module PersonaExperimentEnvTest
 * @path tests/scenario_framework/tests/unit/persona_experiment_env_test.ts
 * @description Proves that a persona response scenario refuses to start without the experiment variables, and that the error names the operator entry point that sets them.
 * @architectural-layer Test
 * @dependencies [@std/assert]
 * @related-files ["tests/scenario_framework/runner/persona_response_trial.ts", "scripts/run_persona_isolation.ts"]
 */

import { assertStringIncludes, assertThrows } from "@std/assert";
import { assertPersonaExperimentEnv } from "../../runner/persona_response_trial.ts";

Deno.test("[persona env] a missing variant is refused and the error names run_persona_isolation.ts", () => {
  const error = assertThrows(() => assertPersonaExperimentEnv({ EXA_PERSONA_EXPERIMENT_ID: "exp-1" }), Error);
  assertStringIncludes(error.message, "EXA_PERSONA_VARIANT");
  assertStringIncludes(error.message, "scripts/run_persona_isolation.ts");
});

Deno.test("[persona env] an unknown variant is refused", () => {
  assertThrows(
    () => assertPersonaExperimentEnv({ EXA_PERSONA_EXPERIMENT_ID: "exp-1", EXA_PERSONA_VARIANT: "custom" }),
    Error,
    "EXA_PERSONA_VARIANT",
  );
});

Deno.test("[persona env] a missing experiment id is refused", () => {
  assertThrows(
    () => assertPersonaExperimentEnv({ EXA_PERSONA_VARIANT: "shipped" }),
    Error,
    "EXA_PERSONA_EXPERIMENT_ID",
  );
});

Deno.test("[persona env] a valid pair passes", () => {
  assertPersonaExperimentEnv({ EXA_PERSONA_EXPERIMENT_ID: "exp-1", EXA_PERSONA_VARIANT: "generic" });
});
