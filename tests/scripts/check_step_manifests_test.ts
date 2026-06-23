/**
 * @module CheckStepManifestsTest
 * @path tests/scripts/check_step_manifests_test.ts
 * @description Phase 125 Step 5 — verifies check_step_manifests.ts correctly
 *   validates step-manifest presence and validity in phase planning documents,
 *   enforces safe YAML parsing, respects file size bounds, and supports the
 *   --since flag for backward compatibility.
 * @architectural-layer Unit
 * @dependencies [@std/assert, @std/path, @std/fs]
 * @related-files [scripts/check_step_manifests.ts, packages/schemas/src/step_manifest.ts]
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { checkStepManifests, type ICheckResult } from "../../scripts/check_step_manifests.ts";

const MANIFEST_YAML = `
\`\`\`yaml
# step-manifest
step: 1
title: Test step
identity: senior-coder
skills: [testing]
portal: exaix-self
target_branch: feat/test
depends_on: []
acceptance:
  tests:
    - "test passes"
  outcomes:
    - "green"
\`\`\`
`;

function createPlanDoc(dir: string, name: string, content: string): string {
  const path = join(dir, name);
  Deno.writeTextFileSync(path, content);
  return path;
}

function stepMd(stepNum: number, steps: string): string {
  return `---
agent: senior-coder
scope: dev
title: "Test Plan"
description: Test
version: "1.0"
---

## Step ${stepNum}

**Actions:**
- Do something

**Architecture Notes:**
- test

**Planned Tests:**
- none

**Success Criteria:**
- passes

${steps}
`;
}

Deno.test("[check_step_manifests] a plan with a manifest per step passes", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "csm-pass-" });
  try {
    const content = stepMd(1, MANIFEST_YAML);
    const file = createPlanDoc(tempDir, "phase-99-test.md", content);

    const result: ICheckResult = await checkStepManifests(file);
    assertEquals(result.success, true);
    assertEquals(result.errors.length, 0);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("[check_step_manifests] a plan with a manifest-less step fails", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "csm-fail-" });
  try {
    const content = stepMd(1, ""); // no manifest
    const file = createPlanDoc(tempDir, "phase-99-test.md", content);

    const result: ICheckResult = await checkStepManifests(file);
    assertEquals(result.success, false);
    assert(result.errors.length > 0, "must report manifest-less step");
    assert(result.errors[0].includes("Step 1"), "error must name the step");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("[check_step_manifests] an invalid manifest fails", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "csm-invalid-" });
  try {
    const invalidYaml = `
\`\`\`yaml
# step-manifest
step: "not-a-number"
title: ""
acceptance:
  tests: "not-an-array"
\`\`\`
`;
    const content = stepMd(1, invalidYaml);
    const file = createPlanDoc(tempDir, "phase-99-test.md", content);

    const result: ICheckResult = await checkStepManifests(file);
    assertEquals(result.success, false);
    assert(result.errors.length > 0, "must report invalid manifest");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("[check_step_manifests] a malformed YAML block is rejected", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "csm-malformed-" });
  try {
    const badYaml = `
\`\`\`yaml
# step-manifest
step: 1
title: ${"a".repeat(300)} ${"b".repeat(200)}  # over max 200
\`\`\`
`;
    const content = stepMd(1, badYaml);
    const file = createPlanDoc(tempDir, "phase-99-test.md", content);

    const result: ICheckResult = await checkStepManifests(file);
    assertEquals(result.success, false);
    assert(result.errors.length > 0, "must reject invalid title length");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("[check_step_manifests] a file exceeding MAX_PLAN_FILE_BYTES is rejected", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "csm-oversize-" });
  try {
    const oversized = "x".repeat(2_000_000); // 2 MB — > 1 MB limit
    const file = createPlanDoc(tempDir, "phase-99-test.md", oversized);

    const result: ICheckResult = await checkStepManifests(file);
    assertEquals(result.success, false);
    assert(result.errors.length > 0, "must reject oversized file");
    assert(result.errors[0].includes("exceeds"), "error must mention exceeds");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("[check_step_manifests] --since skips phase-NN files where NN < threshold", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "csm-since-" });
  try {
    const content = stepMd(1, MANIFEST_YAML);
    // phase-99 is below threshold 130 => should be skipped
    const file = createPlanDoc(tempDir, "phase-99-test.md", content);

    const result: ICheckResult = await checkStepManifests(file, { since: 130 });
    assertEquals(result.success, true);
    assertEquals(result.skipped, 1, "must skip phases below threshold");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("[check_step_manifests] multiple steps all need manifests", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "csm-multi-" });
  try {
    const step2WithManifest = MANIFEST_YAML.replace("step: 1", "step: 2")
      .replace("Test step", "Step 2");
    const content = stepMd(1, MANIFEST_YAML) + "\n" + stepMd(2, step2WithManifest) + "\n" + stepMd(3, "");
    const file = createPlanDoc(tempDir, "phase-99-test.md", content);

    const result: ICheckResult = await checkStepManifests(file);
    assertEquals(result.success, false);
    // Must report step 3 as manifest-less
    assert(result.errors.some((e: string) => e.includes("Step 3")), "must flag step 3");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});
