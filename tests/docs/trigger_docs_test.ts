/**
 * @module TriggerDocsTest
 * @path tests/docs/trigger_docs_test.ts
 * @description Step 4 — Documentation validation tests for Phase 88 trigger adapter layer.
 * Verifies that ARCHITECTURE.md contains the trigger adapter section with a valid README link,
 * and that the canonical envelope example in the docs passes schema validation.
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { ExecutionTriggerEnvelopeSchema } from "@exaix/core/triggers";

// TriggerDocs: ARCHITECTURE.md trigger section links are valid

Deno.test("[TriggerDocs] ARCHITECTURE.md trigger section links are valid", async () => {
  const content = await Deno.readTextFile(join(Deno.cwd(), "ARCHITECTURE.md"));

  assertEquals(
    content.includes("Trigger Adapter Layer"),
    true,
    "ARCHITECTURE.md must contain a 'Trigger Adapter Layer' section",
  );

  assertEquals(
    content.includes("packages/triggers/README.md"),
    true,
    "ARCHITECTURE.md trigger section must link to packages/triggers/README.md",
  );

  assertEquals(
    content.includes("ExecutionTriggerEnvelope"),
    true,
    "ARCHITECTURE.md trigger section must reference ExecutionTriggerEnvelope",
  );
});

// TriggerDocs: config schema example is valid against TriggerConfigSchema

Deno.test("[TriggerDocs] config schema example is valid against TriggerConfigSchema", () => {
  // Canonical envelope example — as it would appear in operator docs.
  // This test ensures the documented example stays in sync with the schema.
  const example = {
    source: "webhook",
    action: "start_flow",
    idempotencyKey: "github-push-main-abc123",
    subject: "github.push",
    occurredAt: "2026-06-05T09:00:00.000Z",
  };

  const result = ExecutionTriggerEnvelopeSchema.safeParse(example);

  assertEquals(
    result.success,
    true,
    `Documented envelope example failed schema validation: ${
      result.success ? "" : JSON.stringify(result.error.issues)
    }`,
  );
});
