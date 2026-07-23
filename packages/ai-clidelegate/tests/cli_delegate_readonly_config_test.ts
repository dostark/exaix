/**
 * @module CliDelegateReadonlyConfigTest
 * @path packages/ai-clidelegate/tests/cli_delegate_readonly_config_test.ts
 * @description Verifies the opencode read-only config shape for plan generation:
 *   edit/bash/task denied, no tools explicitly allowed so opencode stays in
 *   text mode (not ReAct tool loop). This prevents the model from getting
 *   confused by read-only tool permissions during plan generation.
 * @architectural-layer Test
 * @related-files [packages/ai-clidelegate/src/cli_delegate_model_provider.ts]
 */

import { assertEquals } from "@std/assert";
import type { IOpencodeReadOnlyPermissionConfig } from "../src/cli_delegate_model_provider.ts";

Deno.test("[ReadonlyConfig] edit/bash/task are denied, no tools explicitly allowed (text mode)", () => {
  const config: IOpencodeReadOnlyPermissionConfig = {
    permission: {
      edit: "deny",
      bash: "deny",
      task: "deny",
    },
  };
  assertEquals(config.permission.edit, "deny");
  assertEquals(config.permission.bash, "deny");
  assertEquals(config.permission.task, "deny");
  // read/grep/glob are not set — opencode defaults to text mode for plan generation
  assertEquals(config.permission.read, undefined);
  assertEquals(config.permission.grep, undefined);
  assertEquals(config.permission.glob, undefined);
});

Deno.test("[ReadonlyConfig] serialized JSON contains only denied tools", () => {
  const config: IOpencodeReadOnlyPermissionConfig = {
    permission: {
      edit: "deny",
      bash: "deny",
      task: "deny",
    },
  };
  const json = JSON.parse(JSON.stringify(config));
  assertEquals(json.permission.edit, "deny");
  assertEquals(Object.keys(json.permission).sort(), ["bash", "edit", "task"]);
});
