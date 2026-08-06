#!/usr/bin/env -S deno run -A
/**
 * @module BuildMockSessionTool
 * @path scripts/build_mock_session_tool.ts
 * @description Native-Deno replacement for build_mock_session_tool.sh — compiles
 *   scripts/mock_session_tool.ts into a standalone binary for E2E session-delegate scenarios.
 *   Preserves the shell script's Deno-2.x workaround (deno compile ignores the directory
 *   component of --output, so compile from the repo root and move the result) using only
 *   native Deno APIs. Emits the resulting binary path on stdout and exits non-zero on failure.
 *   Usage: deno run -A scripts/build_mock_session_tool.ts [<output-path>]
 * @related-files [scripts/mock_session_tool.ts, tests/scenario_framework/scenarios/agent_flows/session_delegate_refinement.yaml]
 */

import { join } from "@std/path";

const repoRoot = new URL("..", import.meta.url).pathname;
const output = Deno.args[0] ?? join(repoRoot, ".cache", "mock_session_tool_bin");
const outputDir = new URL("..", new URL(`file://${output}/`)).pathname;

await Deno.mkdir(outputDir, { recursive: true });

const compiled = await new Deno.Command("deno", {
  args: ["compile", "-A", join(repoRoot, "scripts", "mock_session_tool.ts")],
  cwd: repoRoot,
  stdout: "piped",
  stderr: "piped",
}).output();

if (!compiled.success) {
  const stderr = new TextDecoder().decode(compiled.stderr);
  console.error(stderr);
  Deno.exit(1);
}

await Deno.rename(join(repoRoot, "mock_session_tool"), output);
console.log(`✅ Mock session tool compiled to: ${output}`);
