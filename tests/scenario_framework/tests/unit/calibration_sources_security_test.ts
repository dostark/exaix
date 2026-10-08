/**
 * @module ScenarioFrameworkCalibrationSourcesSecurityTest
 * @path tests/scenario_framework/tests/unit/calibration_sources_security_test.ts
 * @description Phase 146 Step 1 security slice — the text-redaction helper's
 *   replace/reject split: redacts secret-named env values, PEM private keys, and
 *   Authorization headers, rejects a credential URL userinfo and an unresolved password
 *   assignment, and leaves ordinary text untouched.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/calibration_sources.ts]
 */

import { assertEquals, assertThrows } from "@std/assert";
import { CalibrationRedactionError, redactCalibrationSnapshot } from "../../runner/calibration_sources.ts";

Deno.test("[CalibrationSources][security] redacts a value sourced from a secret-named env var", () => {
  const redacted = redactCalibrationSnapshot("the token is sk-abcdefgh12345678 in this log", {
    MY_API_TOKEN: "sk-abcdefgh12345678",
  });
  assertEquals(redacted.includes("sk-abcdefgh12345678"), false);
  assertEquals(redacted.includes("[REDACTED]"), true);
});

Deno.test("[CalibrationSources][security] redacts a PEM private key block", () => {
  const pem = "-----BEGIN RSA PRIVATE KEY-----\nMIIBOgIBAAJBAK...\n-----END RSA PRIVATE KEY-----";
  const redacted = redactCalibrationSnapshot(`context around it\n${pem}\nmore context`, {});
  assertEquals(redacted.includes("BEGIN RSA PRIVATE KEY"), false);
  assertEquals(redacted.includes("[REDACTED]"), true);
});

Deno.test("[CalibrationSources][security] redacts an Authorization header value", () => {
  const redacted = redactCalibrationSnapshot("Authorization: Bearer abc.def.ghi", {});
  assertEquals(redacted.includes("abc.def.ghi"), false);
});

Deno.test("[CalibrationSources][security] rejects a credential URL userinfo that survives redaction", () => {
  assertThrows(
    () => redactCalibrationSnapshot("fetch from https://user:hunter2@example.com/api", {}),
    CalibrationRedactionError,
  );
});

Deno.test("[CalibrationSources][security] rejects an unresolved password assignment", () => {
  assertThrows(
    () => redactCalibrationSnapshot('password: "hardcoded123"', {}),
    CalibrationRedactionError,
  );
});

Deno.test("[CalibrationSources][security] leaves ordinary text untouched", () => {
  const text = "This plan adds a caching layer to the request pipeline.";
  assertEquals(redactCalibrationSnapshot(text, {}), text);
});
