/**
 * @module DogfoodSessionDelegateTest
 * @path tests/integration/dogfood_session_delegate_test.ts
 * @description Phase 122 Step 0 — verifies the dogfood loop delegates the code_changes
 *   gate to headless OpenCode: the dogfood config preset enables session delegation,
 *   the resolver picks the blueprint-scoped opencode/headless config, and the opencode
 *   adapter builds the `opencode run --format json <objective>` headless launch.
 * @architectural-layer Integration
 * @dependencies [@exaix/schemas, @exaix/session, @std/toml, @std/path]
 * @related-files [packages/session/src/config_resolver.ts, packages/session/src/session_adapter_registry.ts]
 */

import { assertEquals } from "@std/assert";
import { parse as parseToml } from "@std/toml";
import { fromFileUrl, join } from "@std/path";
import { ConfigSchema } from "@exaix/schemas/config.ts";
import { SessionBriefSchema, SessionDelegateConfigSchema } from "@exaix/schemas/session_delegate.ts";
import { resolveSessionDelegateConfig } from "@exaix/session/config_resolver.ts";
import { createDefaultSessionAdapterRegistry } from "@exaix/session/session_adapter_registry.ts";

const REPO_ROOT = fromFileUrl(new URL("../../", import.meta.url));
const DOGFOOD_CONFIG_PATH = join(REPO_ROOT, "configs", "dogfood.toml");

Deno.test("dogfood config preset enables headless opencode delegation for code_changes", async () => {
  const raw = await Deno.readTextFile(DOGFOOD_CONFIG_PATH);
  const parsed = ConfigSchema.parse(parseToml(raw));

  assertEquals(parsed.session_delegate?.enabled, true);
  assertEquals(parsed.session_delegate?.tool, "opencode");
  assertEquals(parsed.session_delegate?.launch_mode, "headless");
  assertEquals(parsed.session_delegate?.gates, ["code_changes"]);
  assertEquals(parsed.session_delegate?.model, "opencode:deepseek-v4-flash-free");
});

Deno.test("blueprint-scoped session_delegate resolves to opencode/headless", () => {
  const blueprint = SessionDelegateConfigSchema.parse({
    enabled: true,
    tool: "opencode",
    gates: ["code_changes"],
    launch_mode: "headless",
  });

  const effective = resolveSessionDelegateConfig({ blueprint });

  assertEquals(effective?.tool, "opencode");
  assertEquals(effective?.launch_mode, "headless");
});

Deno.test("opencode adapter builds an 'opencode run --format json <objective>' headless launch", () => {
  const registry = createDefaultSessionAdapterRegistry();
  const adapter = registry.resolve("opencode");

  const brief = SessionBriefSchema.parse({
    trace_id: "00000000-0000-4000-8000-000000000000",
    gate: "code_changes",
    tool: "opencode",
    objective: "Implement Step 0",
    artifact_ref: "Workspace/Plans/plan.md",
    permitted_paths: ["packages/**"],
    worktree_path: "/tmp/worktree",
    token_budget: { max_input_tokens: 1000, max_output_tokens: 1000, max_total_tokens: 2000 },
    resume_token: "rt-0",
    deadline: "2026-12-31T00:00:00.000Z",
  });

  const launch = adapter.buildLaunch(brief, "headless", "/tmp/brief.json");

  assertEquals(launch.command, "opencode");
  assertEquals(launch.args, ["run", "--format", "json", "--dir", "/tmp/worktree", "Implement Step 0"]);
  assertEquals(launch.cwd, "/tmp/worktree");
});
