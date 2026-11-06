/**
 * @module OracleControls
 * @path tests/scenario_framework/tests/helpers/oracle_controls.ts
 * @description Registers positive outcomes and their independent incorrect controls for text oracles.
 * @architectural-layer Test
 * @dependencies [@std/assert]
 * @related-files [tests/scenario_framework/tests/unit/runtime_verification_oracle_test.ts]
 */
import { assertEquals } from "@std/assert";

interface IControlSample {
  id: string;
  good: string;
  bad: string;
}
type Evaluate = (caseId: string, text: string) => { ok: boolean; reasons: string[] };

export function registerOracleControls(samples: IControlSample[], evaluate: Evaluate, acceptedLabel: string): void {
  for (const sample of samples) {
    Deno.test(`${sample.id}: ${acceptedLabel}`, () => {
      const result = evaluate(sample.id, sample.good);
      assertEquals(result.ok, true, result.reasons.join("; "));
    });
    Deno.test(`${sample.id}: rejects the known-bad control`, () => {
      assertEquals(evaluate(sample.id, sample.bad).ok, false);
    });
  }
}
