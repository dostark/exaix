/**
 * @module ScenarioFrameworkOverlayPathValidationTest
 * @path tests/scenario_framework/tests/unit/overlay_path_validation_test.ts
 * @description Tests for catalog overlay directory path validation (Phase 158 Step 2,
 * closes GAP-7). A run-scoped catalog overlay directory must be validated through
 * `PathResolver` — the same boundary every other workspace-path-accepting code path in
 * the repository uses — before it is prepended to any search path, so an operator-typo'd
 * or malicious overlay path can never read or shadow content outside the workspace.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/arm_overlay.ts, packages/portal/src/path_resolver.ts]
 */

import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { PathResolver } from "@exaix/portal";
import { createMockConfig } from "@exaix/testing";
import { validateCatalogOverlayDir } from "../../runner/arm_overlay.ts";

Deno.test("[OverlayPathValidation] an overlay directory inside the workspace boundary resolves to an absolute path", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "overlay-path-valid-" });
  try {
    const overlayDir = join(tempDir, "Memory", "Skills", "eval-overlay");
    await Deno.mkdir(overlayDir, { recursive: true });

    const config = createMockConfig(tempDir);
    const resolver = new PathResolver(config);

    const resolved = await validateCatalogOverlayDir(resolver, "@Memory/Skills/eval-overlay");
    assertEquals(resolved, overlayDir);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("[OverlayPathValidation] a path traversal attempt outside the workspace boundary is rejected", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "overlay-path-traversal-" });
  try {
    const config = createMockConfig(tempDir);
    const resolver = new PathResolver(config);

    await assertRejects(
      () => validateCatalogOverlayDir(resolver, "@Memory/../../../etc"),
    );
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("[OverlayPathValidation] a bare path with no portal alias is rejected before ever touching the filesystem", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "overlay-path-no-alias-" });
  try {
    const config = createMockConfig(tempDir);
    const resolver = new PathResolver(config);

    await assertRejects(
      () => validateCatalogOverlayDir(resolver, "/etc/passwd"),
      Error,
    );
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("[OverlayPathValidation] a symlink inside the alias root that escapes it is rejected", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "overlay-path-symlink-" });
  try {
    const memoryDir = join(tempDir, "Memory");
    const skillsDir = join(memoryDir, "Skills");
    const outsideDir = join(tempDir, "outside-secret");
    await Deno.mkdir(skillsDir, { recursive: true });
    await Deno.mkdir(outsideDir, { recursive: true });
    await Deno.symlink(outsideDir, join(skillsDir, "escape"));

    const config = createMockConfig(tempDir);
    const resolver = new PathResolver(config);

    const error = await assertRejects(
      () => validateCatalogOverlayDir(resolver, "@Memory/Skills/escape"),
    );
    assertStringIncludes(String(error), "denied");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});
