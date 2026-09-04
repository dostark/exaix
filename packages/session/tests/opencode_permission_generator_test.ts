/**
 * @module OpencodePermissionGeneratorTest
 * @path packages/session/tests/opencode_permission_generator_test.ts
 * @description Phase 128 Step 2 — tests for the OpenCode opencode.jsonc
 *   permission-config generator. Exercises both the pure builder and the
 *   full async generator (with temp-dir + PathResolver).
 */

import { assertEquals, assertThrows } from "@std/assert";
import { join } from "@std/path";
import { OpencodeConfigSchema } from "@exaix/schemas/opencode_config.ts";
import {
  assertPathsWithinWorktree,
  buildOpencodePermissionConfig,
  generateOpencodePermissionConfig,
} from "@exaix/session/opencode_permission_generator.ts";
import type { IOpencodePermissionConfig } from "@exaix/session/opencode_permission_generator.ts";
import { PathResolver } from "@exaix/portal";
import { createMockConfig } from "@exaix/testing";

const TEST_AGENT_ROLE = "dogfood-coder";

Deno.test(
  "[opencode_perm] generator allows each permitted_paths glob under edit, denies '*'",
  () => {
    const config = buildOpencodePermissionConfig(["src/**", "tests/**"], TEST_AGENT_ROLE);
    const agent = config.agent[TEST_AGENT_ROLE];
    assertEquals(agent.edit["*"], "deny");
    assertEquals(agent.edit["src/**"], "allow");
    assertEquals(agent.edit["tests/**"], "allow");
  },
);

Deno.test(
  "[opencode_perm] generator denies external_directory by default",
  () => {
    const config = buildOpencodePermissionConfig(["src/**"], TEST_AGENT_ROLE);
    assertEquals(
      config.agent[TEST_AGENT_ROLE].external_directory["**"],
      "deny",
    );
  },
);

Deno.test(
  "[opencode_perm] generator sets bash to deny by default",
  () => {
    const config = buildOpencodePermissionConfig(["src/**"], TEST_AGENT_ROLE);
    assertEquals(config.agent[TEST_AGENT_ROLE].bash["*"], "deny");
  },
);

Deno.test(
  "[opencode_perm] generated config validates against the permission Zod schema",
  () => {
    const config = buildOpencodePermissionConfig(["src/**", "tests/**", "*.md"], TEST_AGENT_ROLE);
    const result = OpencodeConfigSchema.safeParse(config);
    assertEquals(result.success, true);
  },
);

Deno.test(
  "[opencode_perm] the agent key is the caller's agent role, not a fixed value",
  () => {
    const first = buildOpencodePermissionConfig(["src/**"], "role-one");
    const second = buildOpencodePermissionConfig(["src/**"], "role-two");
    assertEquals(Object.keys(first.agent), ["role-one"]);
    assertEquals(Object.keys(second.agent), ["role-two"]);
  },
);

Deno.test(
  "[opencode_perm][security] a permitted_paths entry escaping the worktree is rejected",
  () => {
    assertThrows(
      () => assertPathsWithinWorktree(["../etc/passwd"], "/workspace"),
      Error,
      "escapes worktree root",
    );
  },
);

Deno.test(
  "[opencode_perm][security] absolute permitted_paths entry is rejected",
  () => {
    assertThrows(
      () => assertPathsWithinWorktree(["/etc/passwd"], "/workspace"),
      Error,
      "escapes worktree root",
    );
  },
);

Deno.test(
  "[opencode_perm][security] null-byte path is rejected",
  () => {
    assertThrows(
      () => assertPathsWithinWorktree(["src/\x00evil.ts"], "/workspace"),
      Error,
    );
  },
);

Deno.test(
  "[opencode_perm] async generator writes config and returns path",
  async () => {
    const tmpDir = await Deno.makeTempDir();
    try {
      await Deno.mkdir(join(tmpDir, ".exa"));
      const resolver = new PathResolver(createMockConfig(tmpDir));
      const result: IOpencodePermissionConfig = await generateOpencodePermissionConfig(
        ["src/**"],
        tmpDir,
        resolver,
        "test-trace-01",
        TEST_AGENT_ROLE,
      );

      assertEquals(result.agentKey, TEST_AGENT_ROLE);
      assertEquals(result.config.agent[TEST_AGENT_ROLE].edit["*"], "deny");
      assertEquals(result.config.agent[TEST_AGENT_ROLE].edit["src/**"], "allow");
      assertEquals(result.configPath.length > 0, true);

      const stat = await Deno.stat(result.configPath);
      assertEquals(stat.isFile, true);

      const written = JSON.parse(
        await Deno.readTextFile(result.configPath),
      );
      const parsed = OpencodeConfigSchema.safeParse(written);
      assertEquals(parsed.success, true);
    } finally {
      await Deno.remove(tmpDir, { recursive: true });
    }
  },
);
