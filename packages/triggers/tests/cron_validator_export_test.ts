/**
 * @module CronValidatorExportTest
 * @path packages/triggers/tests/cron_validator_export_test.ts
 * @description Phase 135 Step 5 (GAP-5) — validateCronExpression is exported from the
 *   schedule adapter (and the package barrel) so the registry refresh scheduler reuses
 *   the same 5-field validator rather than duplicating the regex. Behaviour is
 *   unchanged: the same inputs the adapter rejected still reject.
 * @architectural-layer Triggers
 * @related-files [packages/triggers/adapters/schedule_adapter.ts]
 */
import { assertThrows } from "@std/assert";
import { validateCronExpression } from "@exaix/triggers";

Deno.test("[gap5] validateCronExpression exported from the package barrel", () => {
  // Valid 5-field expressions do not throw.
  validateCronExpression("0 */6 * * *");
  validateCronExpression("0 3 * * *");
  validateCronExpression("0 5 * * 0");
});

Deno.test("[gap5] exported validator rejects the same inputs the adapter rejects", () => {
  assertThrows(() => validateCronExpression(""), Error, "empty");
  assertThrows(() => validateCronExpression("@daily"), Error, "@-style");
  assertThrows(() => validateCronExpression("0 3 * *"), Error, "5 fields");
  assertThrows(() => validateCronExpression("0 3 * * * *"), Error, "5 fields");
  assertThrows(() => validateCronExpression("0 3 * * mon"), Error, "not a valid cron token");
  assertThrows(() => validateCronExpression("0 3 * * *; rm -rf /"), Error, "forbidden characters");
});
