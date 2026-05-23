/**
 * @module ConfigConvergenceSchemaTest
 * @path packages/schemas/tests/config_convergence_test.ts
 * @description Tests for the agents.convergence section of ConfigSchema,
 * covering defaults, valid values, and invalid value rejection.
 * @architectural-layer Config
 * @related-files ["packages/schemas/src/config.ts"]
 */

import { assertEquals } from "@std/assert";
import { ConfigSchema } from "@exaix/schemas";

import { ExaPathDefaults, LogLevel } from "@exaix/core";
import {
  DEFAULT_AGENT_MAX_ITERATIONS,
  DEFAULT_REFLEXIVE_CONVERGENCE_ABSOLUTE_MAX_ITERATIONS,
  DEFAULT_REFLEXIVE_CONVERGENCE_MIN_IMPROVEMENT_DELTA,
  DEFAULT_REFLEXIVE_CONVERGENCE_OSCILLATION_WINDOW,
  DEFAULT_REFLEXIVE_CONVERGENCE_QUALITY_EXIT_THRESHOLD,
  DEFAULT_REFLEXIVE_CONVERGENCE_SCORE_EVERY_N_ITERATIONS,
} from "@exaix/core";

interface IBaseConfig {
  system: { root: string; log_level: string };
  paths: typeof ExaPathDefaults;
}

function baseConfig(): IBaseConfig {
  return {
    system: { root: "/tmp/exa-test", log_level: LogLevel.INFO },
    paths: { ...ExaPathDefaults },
  };
}

Deno.test("[ConfigSchema] validates agents.convergence section", () => {
  const result = ConfigSchema.safeParse({
    ...baseConfig(),
    agents: {
      default_model: "default",
      timeout_sec: 60,
      max_iterations: 10,
      convergence: {
        quality_exit_threshold: 90,
        min_improvement_delta: 4,
        oscillation_window: 3,
        base_max_iterations: 10,
        complexity_scale_factor: 1.5,
        absolute_max_iterations: 12,
        score_every_n_iterations: 2,
      },
    },
  });

  assertEquals(result.success, true);
  if (result.success) {
    const convergence = result.data.agents.convergence!;
    assertEquals(convergence.quality_exit_threshold, 90);
    assertEquals(convergence.min_improvement_delta, 4);
    assertEquals(convergence.oscillation_window, 3);
    assertEquals(convergence.base_max_iterations, 10);
    assertEquals(convergence.complexity_scale_factor, 1.5);
    assertEquals(convergence.absolute_max_iterations, 12);
    assertEquals(convergence.score_every_n_iterations, 2);
  }
});

Deno.test("[ConfigSchema] uses defaults for agents.convergence when absent", () => {
  const result = ConfigSchema.safeParse({
    ...baseConfig(),
    agents: {
      default_model: "default",
      timeout_sec: 60,
      max_iterations: DEFAULT_AGENT_MAX_ITERATIONS,
    },
  });

  assertEquals(result.success, true);
  if (result.success) {
    const convergence = result.data.agents.convergence!;
    assertEquals(convergence.quality_exit_threshold, DEFAULT_REFLEXIVE_CONVERGENCE_QUALITY_EXIT_THRESHOLD);
    assertEquals(convergence.min_improvement_delta, DEFAULT_REFLEXIVE_CONVERGENCE_MIN_IMPROVEMENT_DELTA);
    assertEquals(convergence.oscillation_window, DEFAULT_REFLEXIVE_CONVERGENCE_OSCILLATION_WINDOW);
    assertEquals(convergence.base_max_iterations, DEFAULT_AGENT_MAX_ITERATIONS);
    assertEquals(convergence.complexity_scale_factor, 1.0);
    assertEquals(convergence.absolute_max_iterations, DEFAULT_REFLEXIVE_CONVERGENCE_ABSOLUTE_MAX_ITERATIONS);
    assertEquals(convergence.score_every_n_iterations, DEFAULT_REFLEXIVE_CONVERGENCE_SCORE_EVERY_N_ITERATIONS);
  }
});

Deno.test("[ConfigSchema] rejects invalid convergence quality threshold", () => {
  const result = ConfigSchema.safeParse({
    ...baseConfig(),
    agents: {
      default_model: "default",
      timeout_sec: 60,
      max_iterations: 10,
      convergence: {
        quality_exit_threshold: 150,
      },
    },
  });

  assertEquals(result.success, false);
});

Deno.test("[ConfigSchema] rejects non-integer score_every_n_iterations", () => {
  const result = ConfigSchema.safeParse({
    ...baseConfig(),
    agents: {
      default_model: "default",
      timeout_sec: 60,
      max_iterations: 10,
      convergence: {
        score_every_n_iterations: 1.5,
      },
    },
  });

  assertEquals(result.success, false);
});
