/** @module RoutingPolicyLoaderTest
 * @path packages/routing/tests/routing_policy_loader_test.ts
 * @related-files []
 * @architectural-layer Services
 * @description TODO: Add description */
import { assertEquals, assertExists, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { createMockConfig } from "@exaix/testing";
import { RoutingPolicyLoader } from "@exaix/routing";
import { delay } from "@exaix/core/func";

Deno.test("RoutingPolicyLoader: missing file returns default policy", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "routing-policy-loader-missing-" });
  try {
    const config = createMockConfig(tempDir);
    const loader = new RoutingPolicyLoader({ config, root: tempDir });
    const result = await loader.loadPolicy();

    assertEquals(result.success, true);
    assertEquals(result.policy.rules.length, 0);
    assertEquals(result.path.endsWith(".exaix/routing.policy.yaml"), true);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("RoutingPolicyLoader: valid YAML loads successfully", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "routing-policy-loader-valid-" });
  try {
    const policyDir = join(tempDir, ".exaix");
    await Deno.mkdir(policyDir, { recursive: true });
    const policyPath = join(policyDir, "routing.policy.yaml");
    await Deno.writeTextFile(
      policyPath,
      `version: "1.0"\nallowExperiments: true\nrules:\n  - ruleId: test\n    priority: 5\n    match:\n      capability: code_generation\n    prefer:\n      identityId: senior-coder\n`,
    );

    const config = createMockConfig(tempDir);
    const loader = new RoutingPolicyLoader({ config, root: tempDir });
    const result = await loader.loadPolicy();

    assertEquals(result.success, true);
    assertEquals(result.policy.rules.length, 1);
    assertEquals(result.policy.rules[0].ruleId, "test");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("RoutingPolicyLoader: invalid YAML returns validation errors", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "routing-policy-loader-invalid-" });
  try {
    const policyDir = join(tempDir, ".exaix");
    await Deno.mkdir(policyDir, { recursive: true });
    const policyPath = join(policyDir, "routing.policy.yaml");
    await Deno.writeTextFile(
      policyPath,
      `version: 1.0\nallowExperiments: yes\nrules:\n  - ruleId: \n    priority: -1\n    match:\n      capability: \n    prefer:\n      identityId: \n`,
    );

    const config = createMockConfig(tempDir);
    const loader = new RoutingPolicyLoader({ config, root: tempDir });
    const result = await loader.loadPolicy();

    assertEquals(result.success, false);
    assertExists(result.errors);
    assertEquals(result.errors.length > 0, true);
    assertStringIncludes(result.errors.join(" "), "ruleId");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("RoutingPolicyLoader: startWatching and close lifecycle", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "routing-policy-loader-lifecycle-" });
  try {
    const policyDir = join(tempDir, ".exaix");
    await Deno.mkdir(policyDir, { recursive: true });
    await Deno.writeTextFile(
      join(policyDir, "routing.policy.yaml"),
      `version: "1.0"\nallowExperiments: true\nrules: []\n`,
    );

    const config = createMockConfig(tempDir);
    const loader = new RoutingPolicyLoader({ config, root: tempDir });

    loader.startWatching();
    await delay(50);
    loader.close();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("RoutingPolicyLoader: malformed file preserves previous valid policy", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "routing-policy-loader-malformed-" });
  try {
    const policyDir = join(tempDir, ".exaix");
    await Deno.mkdir(policyDir, { recursive: true });
    const policyPath = join(policyDir, "routing.policy.yaml");

    await Deno.writeTextFile(
      policyPath,
      `version: "1.0"\nallowExperiments: true\nrules:\n  - ruleId: test\n    priority: 5\n    match:\n      capability: code_generation\n    prefer:\n      identityId: senior-coder\n`,
    );

    const config = createMockConfig(tempDir);
    const loader = new RoutingPolicyLoader({ config, root: tempDir });

    const first = await loader.loadPolicy();
    assertEquals(first.success, true);
    assertEquals(first.policy.rules[0].ruleId, "test");

    await delay(100);

    await Deno.writeTextFile(
      policyPath,
      `version: 1\nallowExperiments: yes\nrules:\n  - ruleId: \n    priority: -1\n`,
    );

    const second = await loader.loadPolicy();
    assertEquals(second.success, false);
    assertEquals(second.policy.rules[0].ruleId, "test");
    assertExists(second.errors);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("RoutingPolicyLoader: modified file triggers cache invalidation", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "routing-policy-loader-modified-" });
  try {
    const policyDir = join(tempDir, ".exaix");
    await Deno.mkdir(policyDir, { recursive: true });
    const policyPath = join(policyDir, "routing.policy.yaml");

    await Deno.writeTextFile(
      policyPath,
      `version: "1.0"\nallowExperiments: false\nrules: []\n`,
    );

    const config = createMockConfig(tempDir);
    const loader = new RoutingPolicyLoader({ config, root: tempDir });

    const first = await loader.loadPolicy();
    assertEquals(first.success, true);
    assertEquals(first.policy.allowExperiments, false);

    await delay(100);

    await Deno.writeTextFile(
      policyPath,
      `version: "1.0"\nallowExperiments: true\nrules: []\n`,
    );

    const second = await loader.loadPolicy();
    assertEquals(second.success, true);
    assertEquals(second.policy.allowExperiments, true);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});
