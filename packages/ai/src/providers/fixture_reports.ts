/**
 * @module FixtureReports
 * @path packages/ai/src/providers/fixture_reports.ts
 * @description Post-hoc reporting over a committed fixture directory (Phase 157 Step 4).
 *   reportFlakiness scans every fixture's capture metadata (attempts/failures, written by
 *   CaptureRecordingProvider) and surfaces call sites whose failure rate crosses the
 *   product-finding threshold — a call site the real model rarely satisfies is a product
 *   finding, not noise to smooth away by re-rolling.
 * @architectural-layer AI
 * @related-files [packages/ai/src/providers/capture_recording_provider.ts, packages/ai/src/providers/mock_llm_provider.ts]
 */

import { DEFAULT_CAPTURE_FAILURE_PRODUCT_FINDING_THRESHOLD } from "../constants.ts";
import { describeCallSite, type IRecordedResponse } from "./mock_llm_provider.ts";

export interface IFlakinessEntry {
  /** Call-site description, or the fixture's promptHash when unkeyed. */
  callSite: string;
  attempts: number;
  failureRate: number;
}

export interface IFlakinessSummary {
  totalFixtures: number;
  flakyFixtures: IFlakinessEntry[];
}

/**
 * Scan a fixture directory and report call sites whose capture failure rate is at or above
 * `threshold` (default DEFAULT_CAPTURE_FAILURE_PRODUCT_FINDING_THRESHOLD). A fixture with no
 * `capture` metadata was captured on the first attempt and is never flaky.
 */
export async function reportFlakiness(
  dir: string,
  threshold: number = DEFAULT_CAPTURE_FAILURE_PRODUCT_FINDING_THRESHOLD,
): Promise<IFlakinessSummary> {
  let totalFixtures = 0;
  const flakyFixtures: IFlakinessEntry[] = [];

  try {
    for await (const entry of Deno.readDir(dir)) {
      if (!entry.isFile || !entry.name.endsWith(".json")) continue;
      totalFixtures++;

      const recording = JSON.parse(await Deno.readTextFile(`${dir}/${entry.name}`)) as IRecordedResponse;
      if (!recording.capture || recording.capture.attempts <= 0) continue;

      const failureRate = recording.capture.failures.length / recording.capture.attempts;
      if (failureRate >= threshold) {
        flakyFixtures.push({
          callSite: recording.callSite ? describeCallSite(recording.callSite) : recording.promptHash,
          attempts: recording.capture.attempts,
          failureRate,
        });
      }
    }
  } catch (error) {
    // Directory might not exist yet (e.g. capture was refused before writing anything) —
    // that's OK, matching loadRecordingsFromDir's own precedent.
    if (!(error instanceof Deno.errors.NotFound)) {
      throw error;
    }
  }

  return { totalFixtures, flakyFixtures };
}
