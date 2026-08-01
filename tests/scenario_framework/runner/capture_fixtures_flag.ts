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
import { reportFlakiness } from "@exaix/ai/providers";

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

/**
 * After a --capture-fixtures run, print a warning naming any call site whose capture
 * failure rate crosses DEFAULT_CAPTURE_FAILURE_PRODUCT_FINDING_THRESHOLD (Phase 157 Step 4).
 * Reuses packages/ai's reportFlakiness — the runner does not re-scan fixture files itself.
 */
export async function reportCaptureFlakiness(dir: string): Promise<void> {
  const summary = await reportFlakiness(dir);
  for (const entry of summary.flakyFixtures) {
    console.warn(
      `[capture-flakiness] ${entry.callSite}: ${(entry.failureRate * 100).toFixed(0)}% of ${entry.attempts} ` +
        `capture attempts failed — the real model rarely satisfies this prompt on the first try. ` +
        `This is a product finding, not noise to re-roll away.`,
    );
  }
}
