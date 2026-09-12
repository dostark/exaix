#!/usr/bin/env -S deno run -A
/**
 * @module SessionDelegateCycleWorktreeIsolationFixture
 * @path tests/integration/fixtures/session_delegate_cycle_worktree_isolation_fixture.ts
 * @description Deterministic stand-in for a headless session-delegate CLI (codex/opencode/
 * claude-code), used by session_delegate_cycle_worktree_isolation_cutover_test.ts as a
 * BuiltinSessionAdapter's `bin`. Writes a known file into its own cwd (whatever
 * HeadlessSessionLauncher resolved as the delegate's cwd) with no real API cost — its exit
 * code and (empty) stdout are intentionally unparseable by HeadlessSessionLauncher, which
 * falls back to synthesizing an abandoned return.json; harmless, since this test only
 * verifies where the write landed.
 * @architectural-layer Testing
 * @related-files [apps/daemon/src/headless_session_launcher.ts, tests/integration/session_delegate_cycle_worktree_isolation_cutover_test.ts]
 */

await Deno.mkdir("src", { recursive: true });
await Deno.writeTextFile("src/proof.txt", "written by session_delegate_cycle_worktree_isolation_fixture\n");
