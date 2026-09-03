/**
 * @module StepManifestTest
 * @path packages/schemas/tests/step_manifest_test.ts
 * @description Phase 122 Step 3 — verifies StepManifestSchema accepts valid manifests
 *   (full and minimal) and rejects invalid ones (negative step, empty title,
 *   non-array skills).
 * @architectural-layer Unit
 * @dependencies [@exaix/schemas]
 * @related-files [packages/schemas/src/step_manifest.ts]
 */

import { assertEquals } from "@std/assert";
import { StepManifestSchema } from "@exaix/schemas/step_manifest.ts";

Deno.test("[step-manifest] parses a valid full manifest", () => {
  const input = {
    step: 1,
    title: "Implement feature",
    agent_role: "senior-coder",
    skills: ["tdd-methodology", "exaix-conventions"],
    portal: "exaix-self",
    target_branch: "feat/phase-122-step-1",
    depends_on: [],
    acceptance: {
      tests: ["test 1", "test 2"],
      outcomes: ["all tests pass"],
    },
  };

  const result = StepManifestSchema.safeParse(input);
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.data.step, 1);
    assertEquals(result.data.title, "Implement feature");
    assertEquals(result.data.agent_role, "senior-coder");
    assertEquals(result.data.skills?.length, 2);
  }
});

Deno.test("[step-manifest] parses a valid minimal manifest (step + title only)", () => {
  const result = StepManifestSchema.safeParse({ step: 1, title: "foo" });
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.data.agent_role, "senior-coder"); // default
    assertEquals(result.data.skills, undefined);
    assertEquals(result.data.depends_on, undefined);
  }
});

Deno.test("[step-manifest] rejects negative step number", () => {
  const result = StepManifestSchema.safeParse({ step: -1, title: "foo" });
  assertEquals(result.success, false);
});

Deno.test("[step-manifest] rejects empty title", () => {
  const result = StepManifestSchema.safeParse({ step: 1, title: "" });
  assertEquals(result.success, false);
});

Deno.test("[step-manifest] rejects non-array skills", () => {
  const result = StepManifestSchema.safeParse({ step: 1, title: "foo", skills: "tdd" });
  assertEquals(result.success, false);
});
