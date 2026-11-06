/**
 * @module RequirementsArtifactSecurityTest
 * @path tests/scenario_framework/tests/unit/requirements_artifact_security_test.ts
 * @description Verifies request identity and filesystem containment for requirements evidence.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/requirements_artifact.ts]
 */
import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { readRequirementsArtifact } from "../../runner/requirements_artifact.ts";

const REQUEST = "request-0123abcd";
const TRACE = "0123abcd-0000-4000-8000-000000000000";
const OTHER = "request-89abcdef";

Deno.test("[security] requirements evidence accepts only the requested plan identity", async () => {
  const root = await Deno.makeTempDir();
  try {
    const plans = join(root, "Workspace", "Plans");
    await Deno.mkdir(plans, { recursive: true });
    const plan = [`---`, `request_id: ${REQUEST}`, `trace_id: ${TRACE}`, `---`, `requirements evidence`].join("\n");
    await Deno.writeTextFile(join(plans, `${REQUEST}_plan.md`), plan);
    assertEquals(await readRequirementsArtifact(root, REQUEST), plan);
    await Deno.writeTextFile(join(plans, `${REQUEST}_plan.md`), plan.replace(REQUEST, OTHER));
    await assertRejects(() => readRequirementsArtifact(root, REQUEST), Error, "Request identity mismatch");
    await Deno.writeTextFile(
      join(plans, `${REQUEST}_plan.md`),
      plan.replace(TRACE, "89abcdef-0000-4000-8000-000000000000"),
    );
    await assertRejects(() => readRequirementsArtifact(root, REQUEST), Error, "Request identity mismatch");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("[security] requirements evidence rejects traversal and a plan symlink escaping the workspace", async () => {
  const root = await Deno.makeTempDir();
  const outside = await Deno.makeTempFile();
  try {
    await Deno.mkdir(join(root, "Workspace", "Plans"), { recursive: true });
    await Deno.writeTextFile(outside, "outside data exists");
    await Deno.symlink(outside, join(root, "Workspace", "Plans", `${REQUEST}_plan.md`));
    await assertRejects(() => readRequirementsArtifact(root, "../../outside"), Error, "Invalid request identity");
    await assertRejects(() => readRequirementsArtifact(root, REQUEST), Error, "outside the allowed portal roots");
  } finally {
    await Deno.remove(root, { recursive: true });
    await Deno.remove(outside);
  }
});
