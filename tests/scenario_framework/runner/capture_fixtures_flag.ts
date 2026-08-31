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
 *
 *   The daemon's write scope is its workspace tree, so the requested dir (typically inside the
 *   repo) is denied with a NotCapable write error. buildStepBaseEnv therefore rewrites the var
 *   into the sandbox (`<workspace>/fixtures/mock_recordings/<basename>`), and after the run the
 *   runner mirrors the captured files back to the requested dir (copyCapturedFixtures).
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/main.ts, tests/scenario_framework/runner/synthetic_runner.ts, packages/ai/src/provider_factory.ts]
 */

import { basename, join, resolve } from "@std/path";
import type { Opt, Reason } from "@exaix/core/types";
import { reportFlakiness } from "@exaix/ai/providers";

/** Read by packages/ai/src/provider_factory.ts's resolveOptions(). */
export const CAPTURE_FIXTURES_ENV_VAR = "EXA_CAPTURE_FIXTURES_DIR";

/** Applies `--capture-fixtures <dir>`: resolves it to an absolute path and exports it into the runner's own process env. A no-op when no dir was given. */
export function applyCaptureFixturesFlag(dir: Opt<string, Reason.OptionalInput>): void {
  if (!dir) return;
  Deno.env.set(CAPTURE_FIXTURES_ENV_VAR, resolve(dir));
}

/** The dir the daemon may actually write to: its write scope is the sandbox workspace tree, so the requested (repo) dir would be denied with a NotCapable write error. */
export function sandboxCaptureFixturesDir(workspaceRoot: string, requestedDir: string): string {
  return join(workspaceRoot, "fixtures", "mock_recordings", basename(resolve(requestedDir)));
}

/** Mirrors every fixture file captured inside the sandbox back to the dir the operator asked for. A no-op when nothing was captured. */
export async function copyCapturedFixtures(requestedDir: string, workspaceRoot: string): Promise<void> {
  const sandboxDir = sandboxCaptureFixturesDir(workspaceRoot, requestedDir);
  const target = resolve(requestedDir);
  try {
    await Deno.stat(sandboxDir);
  } catch {
    return; // nothing was captured; nothing to mirror
  }
  await Deno.mkdir(target, { recursive: true });
  for await (const entry of Deno.readDir(sandboxDir)) {
    if (!entry.isFile) continue;
    await Deno.copyFile(join(sandboxDir, entry.name), join(target, entry.name));
  }
}

/** After a --capture-fixtures run, prints a warning naming any call site whose capture failure rate crosses DEFAULT_CAPTURE_FAILURE_PRODUCT_FINDING_THRESHOLD. Reuses packages/ai's reportFlakiness. */
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
