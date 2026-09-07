/**
 * @module CalibrationSandboxTest
 * @path tests/security/calibration_sandbox_test.ts
 * @description Phase 146 Step 1 — capability-preflight tests for the isolated
 *   cross-provider reference-evaluator profile: a sandboxed process must not be able to
 *   read the repository or another CLI's own history/session data, must fail closed
 *   before any paid call on an unsupported platform, and (real-subprocess/real-CLI
 *   tests, ignored under CI=true per this repo's convention for that class of test) a
 *   live claude/codex call inside the sandbox must still succeed and return real content.
 * @architectural-layer Tests
 * @related-files [tests/scenario_framework/runner/calibration_sandbox.ts]
 */

import { assert, assertEquals, assertExists, assertRejects, assertStringIncludes } from "@std/assert";
import { resolve } from "@std/path";
import type { ICalibrationRubric } from "@exaix/eval-history";
import {
  assertSandboxSupported,
  CalibrationSandboxCli,
  runSandboxed,
  runSandboxedCliCall,
  SandboxedCalibrationReferenceAdapter,
} from "../scenario_framework/runner/calibration_sandbox.ts";
import {
  CalibrationRunner,
  FileCalibrationStoreAdapter,
  type ICalibrationClock,
  type ICalibrationRunResult,
  type ICalibrationSourceReaderAdapter,
  LocalCalibrationJudgeAdapter,
} from "../scenario_framework/runner/calibration_runner.ts";
import type {
  ICalibrationSourceItem,
  ICalibrationSourceSelection,
} from "../scenario_framework/runner/calibration_sources.ts";

const REPO_ROOT = resolve(new URL(".", import.meta.url).pathname, "../..");
const SCRATCH_ROOT = "/tmp";

Deno.test({
  name: "[CalibrationSandbox] assertSandboxSupported succeeds on this Linux+bwrap environment",
  ignore: Deno.env.get("CI") === "true",
  fn: async () => {
    await assertSandboxSupported();
  },
});

Deno.test({
  name: "[CalibrationSandbox][security] the sandbox cannot read a file from the actual repository",
  ignore: Deno.env.get("CI") === "true",
  fn: async () => {
    const claudeMdPath = resolve(REPO_ROOT, "CLAUDE.md");
    const result = await runSandboxed("cat", [claudeMdPath], SCRATCH_ROOT);
    assertEquals(result.code, 1, "cat of a real repo file must fail inside the sandbox");
    assertStringIncludes(result.stderr, "No such file or directory");
  },
});

Deno.test({
  name: "[CalibrationSandbox][security] the sandbox cannot read another CLI's own history/session data",
  ignore: Deno.env.get("CI") === "true",
  fn: async () => {
    const home = Deno.env.get("HOME");
    assert(home, "HOME must be set for this test to be meaningful");
    const result = await runSandboxed("cat", [`${home}/.codex/history.jsonl`], SCRATCH_ROOT);
    assertEquals(result.code, 1, "cat of real codex history must fail inside the sandbox");
  },
});

Deno.test({
  name: "[CalibrationSandbox][security] $HOME inside the sandbox exposes nothing beyond the CLI runtime/auth files",
  ignore: Deno.env.get("CI") === "true",
  fn: async () => {
    const home = Deno.env.get("HOME");
    assert(home, "HOME must be set for this test to be meaningful");
    const result = await runSandboxed("ls", ["-a", home], SCRATCH_ROOT);
    assertEquals(result.code, 0);
    const entries = result.stdout.split("\n").map((line) => line.trim()).filter((line) =>
      line.length > 0 && line !== "." && line !== ".."
    );
    // Only the two CLI state directories may be visible — never the repo, shell
    // config, or any other real dotfile/directory under the real $HOME.
    for (const entry of entries) {
      assert(
        entry === ".codex" || entry === ".claude" || entry === ".local",
        `unexpected entry visible inside the sandboxed $HOME: "${entry}"`,
      );
    }
  },
});

Deno.test({
  name:
    "[CalibrationSandbox] runSandboxedCliCall rejects rather than silently falling back unsandboxed when the scratch root cannot be used",
  ignore: Deno.env.get("CI") === "true",
  fn: async () => {
    await assertRejects(() =>
      runSandboxedCliCall({
        cli: CalibrationSandboxCli.Claude,
        model: "claude-sonnet-5",
        prompt: "unused",
        scratchRoot: "/nonexistent-scratch-root-for-calibration-sandbox-test",
      })
    );
  },
});

Deno.test({
  name: "[CalibrationSandbox][live] a real sandboxed claude call succeeds and returns real content",
  ignore: Deno.env.get("CI") === "true",
  fn: async () => {
    const result = await runSandboxedCliCall({
      cli: CalibrationSandboxCli.Claude,
      model: "claude-sonnet-5",
      prompt: "Reply with exactly the word: PONG",
      scratchRoot: SCRATCH_ROOT,
      timeoutMs: 60_000,
    });
    assertStringIncludes(result.stdout, "PONG");
  },
});

Deno.test({
  name: "[CalibrationSandbox][live] a real sandboxed codex call succeeds and returns real content",
  ignore: Deno.env.get("CI") === "true",
  fn: async () => {
    const result = await runSandboxedCliCall({
      cli: CalibrationSandboxCli.Codex,
      model: "gpt-5.6-sol",
      prompt: "Reply with exactly the word: PONG",
      scratchRoot: SCRATCH_ROOT,
      timeoutMs: 60_000,
    });
    assertStringIncludes(result.stdout, "PONG");
  },
});

class SingleItemSourceReader implements ICalibrationSourceReaderAdapter {
  constructor(private readonly item: ICalibrationSourceItem) {}
  read(): Promise<ICalibrationSourceSelection> {
    return Promise.resolve({
      selected: [this.item],
      excluded: [],
      seed: "sandbox-integration-test",
      sourceIndexHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    });
  }
}

class FixedClock implements ICalibrationClock {
  now(): Date {
    return new Date();
  }
}

Deno.test({
  name:
    "[CalibrationSandbox][live] CalibrationRunner completes a real end-to-end run with the sandboxed reference adapter",
  ignore: Deno.env.get("CI") === "true",
  fn: async () => {
    const item: ICalibrationSourceItem = {
      id: "sandbox-integration-item",
      runId: "run-sandbox-integration",
      stepId: "step-sandbox-integration",
      snapshot: {
        request_context: "Add input validation to the login form's submit handler.",
        artifact: "## Plan\n1. Validate email format\n2. Validate password length\n3. Add tests",
        rubric_methodology: "score 0-1",
        real_run_marker: true,
        execution_status: "completed",
        source_revision: "abc123",
      },
    };
    const rubric: ICalibrationRubric = {
      schema_version: 1,
      id: "plan-quality",
      version: "1.0.0",
      preset: "GOAL_ALIGNED_REVIEW",
      criteria: [{ name: "goal_alignment", description: "aligns with the stated goal", weight: 2 }],
      label_threshold: 0.7,
      methodology_text: "score each criterion 0-1",
      methodology_hash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    };

    const storeDir = await Deno.makeTempDir();
    try {
      const runner = new CalibrationRunner({
        judge: new LocalCalibrationJudgeAdapter(REPO_ROOT),
        reference: new SandboxedCalibrationReferenceAdapter(SCRATCH_ROOT),
        sourceReader: new SingleItemSourceReader(item),
        store: new FileCalibrationStoreAdapter(storeDir),
        clock: new FixedClock(),
      });

      const result: ICalibrationRunResult = await runner.run({
        sourceIndexPath: "unused",
        snapshotRoot: "unused",
        seed: "sandbox-integration-test",
        sampleCount: 1,
        rubric,
        target: { provider: "claude-cli", model: "claude-cli:claude-sonnet-5" },
        reference: { provider: "codex-cli", model: "codex-cli:gpt-5.6-sol" },
      });

      assertEquals(result.sampleCount, 1);
      assertEquals(result.realExecutionMarker, true);
      assertEquals(result.items.length, 1);
      assertExists(result.items[0].targetScore);
      assertExists(result.items[0].referenceScore);
      assertEquals(result.referenceProvenance.provider, "codex-cli");
    } finally {
      await Deno.remove(storeDir, { recursive: true });
    }
  },
});
