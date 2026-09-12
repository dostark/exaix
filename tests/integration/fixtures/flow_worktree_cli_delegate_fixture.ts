#!/usr/bin/env -S deno run -A
/**
 * @module FlowWorktreeCliDelegateFixture
 * @path tests/integration/fixtures/flow_worktree_cli_delegate_fixture.ts
 * @description Deterministic stand-in for the real `claude` CLI binary, used by
 * flow_step_worktree_isolation_cutover_test.ts as a `cli_delegate.bin_overrides` entry.
 * Writes a known file into its own cwd (whatever CliDelegateStrategy resolved as the
 * portal path) and emits a minimal claude stream-json `result` event so
 * cli_delegate_stream_parser accepts the turn as successful, with no real API cost.
 * @architectural-layer Testing
 * @related-files [packages/execution/src/strategies/cli_delegate_strategy.ts, tests/integration/flow_step_worktree_isolation_cutover_test.ts]
 */

await Deno.mkdir("src", { recursive: true });
await Deno.writeTextFile("src/main.ts", "// written by flow_worktree_cli_delegate_fixture\n");

console.log(JSON.stringify({
  type: "result",
  result: "done",
  usage: { input_tokens: 10, output_tokens: 5 },
}));
