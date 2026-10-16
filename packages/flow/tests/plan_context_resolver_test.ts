/**
 * @module PlanContextResolverTest
 * @path packages/flow/tests/plan_context_resolver_test.ts
 * @description Security and correctness tests for PlanContextResolver (Phase 174 Step 2 GAP-1):
 *   containment, traversal, absolute-path, and symlink-escape rejection.
 * @architectural-layer Flows
 * @related-files [packages/flow/src/plan_context_resolver.ts]
 */

import * as pathBuilders from "@exaix/shared";
import { DEFAULT_RUNTIME_PATH, DEFAULT_WORKSPACE_PATH } from "@exaix/shared";
import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { PlanContextResolver } from "../src/plan_context_resolver.ts";

async function makeWorktreeWithPlan(slug: string, body: string): Promise<string> {
  const root = await Deno.makeTempDir({ prefix: "plan-context-resolver-" });
  const dir = pathBuilders.runtimePath(root, "PlanContext");
  await Deno.mkdir(dir, { recursive: true });
  await Deno.writeTextFile(join(dir, `${slug}.md`), body);
  return root;
}

Deno.test("[integration] resolves a valid plan_context_ref beneath executionRoot", async () => {
  const root = await makeWorktreeWithPlan("phase-174", "# Phase 174\n");
  try {
    const resolver = new PlanContextResolver();
    const result = await resolver.resolve({
      executionRoot: root,
      planContextRef: `${DEFAULT_RUNTIME_PATH}/PlanContext/phase-174.md`,
    });
    assertEquals(result.content, "# Phase 174\n");
    assertEquals(result.absolutePath.endsWith(pathBuilders.runtimePath("", "PlanContext", "phase-174.md")), true);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("[security] rejects a planContextRef outside the .exa/PlanContext shape", async () => {
  const root = await makeWorktreeWithPlan("phase-174", "# Phase 174\n");
  try {
    const resolver = new PlanContextResolver();
    await assertRejects(() =>
      resolver.resolve({ executionRoot: root, planContextRef: `${DEFAULT_WORKSPACE_PATH}/secret.md` })
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("[security] rejects a traversal attempt embedded in the ref", async () => {
  const root = await makeWorktreeWithPlan("phase-174", "# Phase 174\n");
  try {
    const resolver = new PlanContextResolver();
    await assertRejects(() =>
      resolver.resolve({
        executionRoot: root,
        planContextRef: `${DEFAULT_RUNTIME_PATH}/PlanContext/../../etc/passwd.md`,
      })
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("[security] rejects an absolute-path ref", async () => {
  const root = await makeWorktreeWithPlan("phase-174", "# Phase 174\n");
  try {
    const resolver = new PlanContextResolver();
    await assertRejects(() => resolver.resolve({ executionRoot: root, planContextRef: "/etc/passwd" }));
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("[security] rejects when the PlanContext file is a symlink escaping executionRoot", async () => {
  const root = await Deno.makeTempDir({ prefix: "plan-context-resolver-symlink-" });
  const outside = await Deno.makeTempDir({ prefix: "plan-context-resolver-outside-" });
  try {
    const dir = pathBuilders.runtimePath(root, "PlanContext");
    await Deno.mkdir(dir, { recursive: true });
    const outsideTarget = join(outside, "secret.md");
    await Deno.writeTextFile(outsideTarget, "secret content");
    await Deno.symlink(outsideTarget, join(dir, "phase-174.md"));

    const resolver = new PlanContextResolver();
    await assertRejects(() =>
      resolver.resolve({ executionRoot: root, planContextRef: `${DEFAULT_RUNTIME_PATH}/PlanContext/phase-174.md` })
    );
  } finally {
    await Deno.remove(root, { recursive: true });
    await Deno.remove(outside, { recursive: true });
  }
});

Deno.test("[security] rejects when a symlinked ancestor directory escapes executionRoot", async () => {
  const root = await Deno.makeTempDir({ prefix: "plan-context-resolver-symlink-anc-" });
  const outside = await Deno.makeTempDir({ prefix: "plan-context-resolver-outside-anc-" });
  try {
    const outsideDir = join(outside, "PlanContext");
    await Deno.mkdir(outsideDir, { recursive: true });
    await Deno.writeTextFile(join(outsideDir, "phase-174.md"), "escaped content");
    await Deno.mkdir(pathBuilders.runtimePath(root), { recursive: true });
    await Deno.symlink(outsideDir, pathBuilders.runtimePath(root, "PlanContext"));

    const resolver = new PlanContextResolver();
    await assertRejects(() =>
      resolver.resolve({ executionRoot: root, planContextRef: `${DEFAULT_RUNTIME_PATH}/PlanContext/phase-174.md` })
    );
  } finally {
    await Deno.remove(root, { recursive: true });
    await Deno.remove(outside, { recursive: true });
  }
});

Deno.test("[security] rejects a missing portal execution root", async () => {
  const resolver = new PlanContextResolver();
  await assertRejects(() =>
    resolver.resolve({
      executionRoot: "/nonexistent/portal/root",
      planContextRef: `${DEFAULT_RUNTIME_PATH}/PlanContext/phase-174.md`,
    })
  );
});
