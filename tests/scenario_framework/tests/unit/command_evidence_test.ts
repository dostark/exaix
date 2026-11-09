/**
 * @module CommandEvidenceTest
 * @path tests/scenario_framework/tests/unit/command_evidence_test.ts
 * @description Loads case-bound command observations without accepting model self-report.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/skill_evaluation_evidence.ts]
 */
import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { join } from "@std/path";
import {
  commandRequirementFor,
  evaluateObservedArtifacts,
  loadCommandEvidence,
} from "../../runner/skill_evaluation_evidence.ts";

const EXPECTED = {
  requestId: "request-2e9cc893",
  argv: ["./run-tests.sh"],
  cwd: "/portal/p234-s2",
  exitCode: 1,
  stdout: "FAIL: expected 1 row, got 2\n",
};

interface ICommandRecordFixture {
  requestId: string;
  argv: string[];
  cwd: string;
  exitCode: number;
  stdout: string;
}

interface ICommandBundleFixture {
  expected?: ICommandRecordFixture;
  observed?: ICommandRecordFixture[];
}

async function writeBundle(root: string, value: ICommandBundleFixture): Promise<void> {
  await Deno.mkdir(join(root, ".exa", "phase234-evidence"), { recursive: true });
  await Deno.writeTextFile(
    join(root, ".exa", "phase234-evidence", "p234-s2-c1-commands.json"),
    JSON.stringify(value),
    { mode: 0o600 },
  );
}

Deno.test("command evidence stays pending when no trace file exists", async () => {
  const root = await Deno.makeTempDir();
  try {
    const evidence = await loadCommandEvidence(root, "p234-s2-c1");
    assertEquals(evidence.result.status, "pending");
    assertEquals(evidence.observed, []);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("command evidence passes only when the expected execution was observed", async () => {
  const root = await Deno.makeTempDir();
  try {
    await writeBundle(root, { expected: EXPECTED, observed: [EXPECTED] });
    assertEquals((await loadCommandEvidence(root, "p234-s2-c1")).result.status, "passed");
    await writeBundle(root, { expected: EXPECTED, observed: [{ ...EXPECTED, exitCode: 0 }] });
    assertEquals((await loadCommandEvidence(root, "p234-s2-c1")).result.status, "failed");
    await writeBundle(root, { observed: [EXPECTED] });
    assertEquals((await loadCommandEvidence(root, "p234-s2-c1")).result.status, "pending");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("command evidence rejects malformed records and unknown cases", async () => {
  const root = await Deno.makeTempDir();
  try {
    await writeBundle(root, { expected: { ...EXPECTED, argv: [] }, observed: [] });
    assertEquals((await loadCommandEvidence(root, "p234-s2-c1")).result.status, "failed");
    await assertRejects(() => loadCommandEvidence(root, "../escape"), Error, "Invalid case");
    assertThrows(() => commandRequirementFor("p234-s7-c1"), Error, "Invalid case");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("command evidence rejects a trace reached through an escaping symlink", async () => {
  const root = await Deno.makeTempDir();
  const outside = await Deno.makeTempDir();
  try {
    await Deno.mkdir(join(root, ".exa"), { recursive: true });
    await Deno.symlink(outside, join(root, ".exa", "phase234-evidence"));
    await assertRejects(() => loadCommandEvidence(root, "p234-s2-c1"), Error);
  } finally {
    await Deno.remove(root, { recursive: true });
    await Deno.remove(outside, { recursive: true });
  }
});

Deno.test("observed evaluation consumes bound command evidence instead of hardcoding pending", async () => {
  const root = await Deno.makeTempDir();
  try {
    await writeBundle(root, { expected: EXPECTED, observed: [EXPECTED] });
    const evaluation = await evaluateObservedArtifacts(root, "p234-s2-c1", [], []);
    assertEquals(evaluation.effects.commands.status, "passed");
    assertEquals(evaluation.effects.commands.reasons, []);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("command requirement is authored for every case and gates only the execution cases", () => {
  const required: string[] = [];
  for (let group = 1; group <= 6; group++) {
    for (let index = 1; index <= 5; index++) {
      const caseId = `p234-s${group}-c${index}`;
      if (commandRequirementFor(caseId) === "required") required.push(caseId);
    }
  }
  assertEquals(required, [
    "p234-s1-c2",
    "p234-s1-c3",
    "p234-s2-c1",
    "p234-s2-c2",
    "p234-s2-c3",
    "p234-s2-c4",
  ]);
  assertThrows(() => commandRequirementFor("p234-s7-c1"), Error, "Invalid case");
});

Deno.test("a case without a command requirement does not block on a missing trace", async () => {
  const root = await Deno.makeTempDir();
  try {
    const evaluation = await evaluateObservedArtifacts(root, "p234-s5-c1", [], []);
    assertEquals(evaluation.effects.commands.status, "passed");
    assertEquals(evaluation.effects.commands.reasons, ["Command evidence does not apply to this case"]);
    const required = await evaluateObservedArtifacts(root, "p234-s2-c1", [], []);
    assertEquals(required.effects.commands.status, "pending");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
