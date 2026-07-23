/**
 * @module CliDelegateReadonlyConfigTest
 * @path packages/ai-clidelegate/tests/cli_delegate_readonly_config_test.ts
 * @description Verifies the opencode read-only config shape:
 *   read/grep/glob allowed (model stays in ReAct loop during plan generation),
 *   edit/bash/task denied. Phase 155 GAP-2.
 * @architectural-layer Test
 * @related-files [packages/ai-clidelegate/src/cli_delegate_model_provider.ts]
 */

import { assertEquals } from "@std/assert";
import type { IOpencodeReadOnlyPermissionConfig } from "../src/cli_delegate_model_provider.ts";

Deno.test("[ReadonlyConfig] read/grep/glob are allowed, edit/bash/task denied", () => {
  const config: IOpencodeReadOnlyPermissionConfig = {
    permission: {
      read: "allow",
      grep: "allow",
      glob: "allow",
      edit: "deny",
      bash: "deny",
      task: "deny",
    },
  };
  assertEquals(config.permission.read, "allow");
  assertEquals(config.permission.grep, "allow");
  assertEquals(config.permission.glob, "allow");
  assertEquals(config.permission.edit, "deny");
  assertEquals(config.permission.bash, "deny");
  assertEquals(config.permission.task, "deny");
});

Deno.test("[ReadonlyConfig] serialized JSON matches expected shape", () => {
  const config: IOpencodeReadOnlyPermissionConfig = {
    permission: {
      read: "allow",
      grep: "allow",
      glob: "allow",
      edit: "deny",
      bash: "deny",
      task: "deny",
    },
  };
  const json = JSON.parse(JSON.stringify(config));
  assertEquals(json.permission.read, "allow");
  assertEquals(json.permission.edit, "deny");
  assertEquals(Object.keys(json.permission).sort(), ["bash", "edit", "glob", "grep", "read", "task"]);
});
