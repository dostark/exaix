/**
 * @module CaptureFixturesFlag
 * @path tests/scenario_framework/runner/capture_fixtures_flag.ts
 * @description Phase 157 Step 2 — resolves the runner's `--capture-fixtures <dir>` CLI flag
 *   into EXA_CAPTURE_FIXTURES_DIR in the runner's own process env. The daemon is a separate
 *   OS process the runner spawns (start-daemon step), so the runner cannot literally wrap the
 *   daemon's in-process provider — it propagates the intent as an env var instead, which every
 *   spawned step subprocess already inherits (synthetic_runner.ts's buildStepBaseEnv spreads
 *   `Deno.env.toObject()`), including the daemon-start step where ProviderFactory reads
 *   EXA_CAPTURE_FIXTURES_DIR and wraps its (real) provider in CaptureRecordingProvider.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/main.ts, tests/scenario_framework/runner/synthetic_runner.ts, packages/ai/src/provider_factory.ts]
 */

import { resolve } from "@std/path";
import type { Opt, Reason } from "@exaix/core/types";

/** Read by packages/ai/src/provider_factory.ts's resolveOptions(). */
export const CAPTURE_FIXTURES_ENV_VAR = "EXA_CAPTURE_FIXTURES_DIR";

/**
 * Apply `--capture-fixtures <dir>`: resolve it to an absolute path and export it into the
 * runner's own process env. A no-op when no dir was given.
 */
export function applyCaptureFixturesFlag(dir: Opt<string, Reason.OptionalInput>): void {
  if (!dir) return;
  Deno.env.set(CAPTURE_FIXTURES_ENV_VAR, resolve(dir));
}
