/**
 * @module SkillEvaluationEvidenceTest
 * @path tests/scenario_framework/tests/unit/skill_evaluation_evidence_test.ts
 * @description Checks separate evidence results and workspace change observations.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/skill_evaluation_evidence.ts]
 */
import { assertArrayIncludes, assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { createSkillLoaderFor, initTestDbService, REPO_ROOT, TestEnvironment, testSkillContext } from "@exaix/testing";
import { SkillRootKind } from "@exaix/core";
import { computeRevisionId, computeSkillContentSha256 } from "@exaix/core/skills";
import {
  captureWorkspaceBaseline,
  checkDeterministicBehavior,
  checkPlanFormat,
  compareWorkspaceSnapshots,
  evaluateObservedArtifacts,
  evaluatePhase234,
  evaluateVerifiedEvidence,
  observeWorkspaceChanges,
  snapshotWorkspace,
  verifyCommandObservation,
  verifySemanticReview,
} from "../../runner/skill_evaluation_evidence.ts";
import { observeRecordedSkill, verifySkillSubmission } from "../../runner/skill_delivery_observation.ts";
import approvedSkills from "../../fixtures/skill_eval/phase234/approved_skill_revisions.json" with { type: "json" };

Deno.test("approved skill revision manifest matches each canonical source", async () => {
  for (const approved of approvedSkills) {
    const rootKind = approved.root === "dogfood" ? SkillRootKind.DOGFOOD : SkillRootKind.BLUEPRINT;
    const path = join(REPO_ROOT, approved.root === "dogfood" ? ".copilot/skills" : "Blueprints/Skills");
    const loaded = await createSkillLoaderFor([{ path, kind: rootKind, writable: false, project: null }]).get(
      approved.name,
      testSkillContext(),
    );
    assertEquals(loaded?.revisionId, approved.revision, approved.name);
    assertEquals(loaded?.contentSha256, approved.sha256, approved.name);
  }
});

Deno.test("request-bound skill usage validates its stored snapshot without claiming provider capture", async () => {
  const env = await initTestDbService();
  try {
    const loaded = await createSkillLoaderFor([{
      path: join(REPO_ROOT, "Blueprints/Skills"),
      kind: SkillRootKind.BLUEPRINT,
      writable: false,
      project: null,
    }]).get("requirements-analysis", testSkillContext());
    if (!loaded) throw new Error("Approved requirements skill is missing");
    const snapshot = loaded.snapshot;
    const hash = await computeSkillContentSha256(snapshot);
    const revision = await computeRevisionId(hash);
    const request = "request-0123abcd";
    assertEquals((await observeRecordedSkill(env.tempDir, "p234-s5-c1", request)).status, "pending");
    await env.db.preparedRun(
      'INSERT INTO skill_revisions (revision_id, content_sha256, skill_name, skill_md, exaix_yaml, "references", first_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [
        revision,
        hash,
        "requirements-analysis",
        snapshot.skill_md,
        snapshot.exaix_yaml,
        JSON.stringify(snapshot.references),
        "2026-01-01",
      ],
    );
    await env.db.preparedRun(
      "INSERT INTO skill_usage (call_id, revision_id, skill_name, trace_id, request_id, agent_role, match_source, render_mode, submission_kind, round, attempt, root_kind, source_path, config_generation, used_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        "call-1",
        revision,
        "requirements-analysis",
        "0123abcd-0000-4000-8000-000000000000",
        request,
        "product-manager",
        "pinned",
        "full",
        "provider",
        1,
        1,
        "blueprint",
        "requirements-analysis",
        "test",
        "2026-01-01",
      ],
    );
    const valid = await observeRecordedSkill(env.tempDir, "p234-s5-c1", request);
    assertEquals(valid.status, "pending");
    assertArrayIncludes(valid.reasons, ["Recorded skill snapshot is valid; provider submission capture unavailable"]);
    const stale = { ...snapshot, skill_md: `${snapshot.skill_md}\nUnapproved addition.` };
    const staleHash = await computeSkillContentSha256(stale);
    const staleRevision = await computeRevisionId(staleHash);
    await env.db.preparedRun(
      'INSERT INTO skill_revisions (revision_id, content_sha256, skill_name, skill_md, exaix_yaml, "references", first_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [
        staleRevision,
        staleHash,
        "requirements-analysis",
        stale.skill_md,
        stale.exaix_yaml,
        JSON.stringify(stale.references),
        "2026-01-01",
      ],
    );
    await env.db.preparedRun("UPDATE skill_usage SET revision_id = ? WHERE call_id = ?", [staleRevision, "call-1"]);
    assertEquals((await observeRecordedSkill(env.tempDir, "p234-s5-c1", request)).status, "failed");
    await env.db.preparedRun("UPDATE skill_usage SET revision_id = ? WHERE call_id = ?", [revision, "call-1"]);
    assertEquals((await observeRecordedSkill(env.tempDir, "p234-s5-c1", "request-89abcdef")).status, "pending");
    await env.db.preparedRun("UPDATE skill_usage SET root_kind = ? WHERE call_id = ?", ["dogfood", "call-1"]);
    assertEquals((await observeRecordedSkill(env.tempDir, "p234-s5-c1", request)).status, "failed");
    await env.db.preparedRun("UPDATE skill_usage SET root_kind = ? WHERE call_id = ?", ["blueprint", "call-1"]);
    await env.db.preparedRun("UPDATE skill_revisions SET skill_md = ? WHERE revision_id = ?", ["tampered", revision]);
    assertEquals((await observeRecordedSkill(env.tempDir, "p234-s5-c1", request)).status, "failed");
  } finally {
    await env.cleanup();
  }
});

Deno.test("skill usage observation rejects a journal symlink outside the workspace", async () => {
  const root = await Deno.makeTempDir();
  const outside = await Deno.makeTempDir();
  try {
    await Deno.mkdir(join(root, ".exa"));
    await Deno.writeTextFile(join(outside, "journal.db"), "not a journal");
    await Deno.symlink(join(outside, "journal.db"), join(root, ".exa", "journal.db"));
    await assertRejects(() => observeRecordedSkill(root, "p234-s5-c1", "request-0123abcd"), Error);
  } finally {
    await Deno.remove(root, { recursive: true });
    await Deno.remove(outside, { recursive: true });
  }
});

Deno.test("evaluation keeps missing delivery and semantic review pending", () => {
  const result = evaluatePhase234({
    delivery: { status: "pending", reasons: ["Submission capture unavailable"] },
    behavior: { status: "pending", reasons: ["Independent review unavailable"] },
    artifact: { status: "passed", reasons: [] },
    workspace: { status: "pending", reasons: ["No baseline"] },
    commands: { status: "pending", reasons: ["No command evidence"] },
  });
  assertEquals(result.delivery.status, "pending");
  assertEquals(result.behavior.status, "pending");
  assertEquals(result.effects.status, "pending");
  assertEquals(result.effects.artifact.status, "passed");
  assertEquals(result.effects.workspace.status, "pending");
  assertEquals(result.effects.commands.status, "pending");
  assertEquals(result.overall, "pending");
});

Deno.test("artifact format follows the product plan parser rather than a heading alone", () => {
  const header = "---\nrequest_id: request-0123abcd\ntrace_id: 0123abcd-0000-4000-8000-000000000000\n---\n";
  assertEquals(checkPlanFormat(`${header}# Title\nOnly a heading.`).status, "failed");
  assertEquals(
    checkPlanFormat(`${header}# Title\n## Execution Steps\n## Step 1: Check\nDo the check.`).status,
    "passed",
  );
  assertEquals(checkPlanFormat("# Title\n## Execution Steps\n## Step 1: Check\nMissing identity.").status, "failed");
});

Deno.test("observed artifacts must identify their corresponding requests", async () => {
  const env = await TestEnvironment.create({ initGit: false });
  try {
    const plan = (id: string) =>
      `---\nrequest_id: request-${id}\ntrace_id: ${id}-0000-4000-8000-000000000000\n---\n# Plan\n## Execution Steps\n## Step 1: Check\nDo the check.`;
    const first = plan("0123abcd");
    const second = plan("89abcdef");
    const evaluate = (artifacts: string[], ids: string[]) =>
      evaluateObservedArtifacts(env.tempDir, "p234-s5-c2", artifacts, ids);
    assertEquals(
      (await evaluate([first, second], ["request-0123abcd", "request-89abcdef"])).effects.artifact.status,
      "passed",
    );
    assertEquals(
      (await evaluate([second, first], ["request-0123abcd", "request-89abcdef"])).effects.artifact.status,
      "failed",
    );
    assertEquals((await evaluate([first], [])).effects.artifact.status, "pending");
  } finally {
    await env.cleanup();
  }
});

Deno.test("complete evaluation binds reviewed behavior and provider evidence to the actual artifact and request", async () => {
  const artifact =
    '---\nrequest_id: request-0123abcd\ntrace_id: 0123abcd-0000-4000-8000-000000000000\n---\n# Plan\n```json\n{"case_id":"p234-s5-c1","acceptance":[{"input":0,"expected":"0 items"},{"input":1,"expected":"1 item"},{"input":2,"expected":"2 items"}]}\n```\n## Execution Steps\n## Step 1: Check\nDo the check.';
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(artifact));
  const artifactSha256 = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  const submission = {
    requestId: "request-0123abcd",
    skill: "plan",
    root: "dogfood",
    revision: "revision-a",
    sha256: "a".repeat(64),
    instructions: "Approved instructions.",
  };
  const usage = { ...submission, callId: "call-1", submissionKind: "provider", matchSource: "pinned" };
  const capture = { requestId: submission.requestId, callId: usage.callId, prompt: submission.instructions };
  const expectation = {
    caseId: "p234-s5-c1",
    artifactSha256,
    rubricSha256: "b".repeat(64),
    producer: "model-under-test",
    positiveControls: ["valid-a"],
    negativeControls: ["invalid-a"],
    calibrationPolicy: { approvedBy: "independent-reviewer", minimumPositive: 1, minimumNegative: 1 },
  };
  const review = {
    caseId: expectation.caseId,
    artifactSha256,
    rubricSha256: expectation.rubricSha256,
    reviewer: "independent-reviewer",
    evaluator: "calibrated-evaluator",
    verdict: "passed" as const,
    rationale: "The reviewed plan satisfies the case.",
  };
  const calibration = {
    rubricSha256: expectation.rubricSha256,
    evaluator: review.evaluator,
    controls: [
      { id: "valid-a", expected: "passed" as const, observed: "passed" as const },
      { id: "invalid-a", expected: "failed" as const, observed: "failed" as const },
    ],
  };
  const command = { requestId: submission.requestId, argv: ["test"], cwd: "/portal", exitCode: 0, stdout: "ok" };
  const input = {
    caseId: expectation.caseId,
    requestId: submission.requestId,
    artifact,
    expectedSubmission: submission,
    usage,
    capture,
    expectation,
    review,
    calibration,
    expectedCommand: command,
    observedCommands: [command],
    workspace: { status: "passed" as const, reasons: [] },
  };
  assertEquals((await evaluateVerifiedEvidence(input)).overall, "passed");
  assertEquals(
    (await evaluateVerifiedEvidence({ ...input, artifact: `${artifact} changed` })).behavior.status,
    "failed",
  );
  assertEquals((await evaluateVerifiedEvidence({ ...input, requestId: "request-89abcdef" })).delivery.status, "failed");
  const wrongIdentity = artifact.replace("request-0123abcd", "request-89abcdef");
  assertEquals(
    (await evaluateVerifiedEvidence({ ...input, artifact: wrongIdentity })).effects.artifact.status,
    "failed",
  );
});

Deno.test("semantic review requires matching artifact, independent review, and all calibration controls", () => {
  const expected = {
    caseId: "p234-s5-c1",
    artifactSha256: "a".repeat(64),
    rubricSha256: "b".repeat(64),
    producer: "model-under-test",
    positiveControls: ["valid-a"],
    negativeControls: ["invalid-a"],
    calibrationPolicy: { approvedBy: "independent-reviewer", minimumPositive: 1, minimumNegative: 1 },
  };
  const review = {
    caseId: expected.caseId,
    artifactSha256: expected.artifactSha256,
    rubricSha256: expected.rubricSha256,
    reviewer: "independent-reviewer",
    evaluator: "calibrated-evaluator",
    verdict: "passed" as const,
    rationale: "The case outcomes and exclusions are satisfied.",
  };
  const calibration = {
    rubricSha256: expected.rubricSha256,
    evaluator: review.evaluator,
    controls: [
      { id: "valid-a", expected: "passed" as const, observed: "passed" as const },
      { id: "invalid-a", expected: "failed" as const, observed: "failed" as const },
    ],
  };
  assertEquals(verifySemanticReview(expected, undefined, undefined).status, "pending");
  assertEquals(
    verifySemanticReview({ ...expected, calibrationPolicy: undefined }, review, calibration).status,
    "pending",
  );
  assertEquals(verifySemanticReview(expected, review, calibration).status, "passed");
  assertEquals(
    verifySemanticReview(expected, {
      ...review,
      verdict: "pending",
      rationale: "The available evidence is incomplete.",
    }, calibration).status,
    "pending",
  );
  assertEquals(
    verifySemanticReview(
      { ...expected, calibrationPolicy: { ...expected.calibrationPolicy, minimumPositive: 2 } },
      review,
      calibration,
    ).status,
    "pending",
  );
  assertEquals(
    verifySemanticReview(
      { ...expected, calibrationPolicy: { ...expected.calibrationPolicy, approvedBy: review.evaluator } },
      review,
      calibration,
    ).status,
    "failed",
  );
  assertEquals(
    verifySemanticReview(expected, { ...review, reviewer: expected.producer }, calibration).status,
    "failed",
  );
  assertEquals(
    verifySemanticReview(expected, { ...review, artifactSha256: "c".repeat(64) }, calibration).status,
    "failed",
  );
  assertEquals(
    verifySemanticReview(expected, review, { ...calibration, controls: calibration.controls.slice(0, 1) }).status,
    "pending",
  );
  const wrong = {
    ...calibration,
    controls: [calibration.controls[0], { ...calibration.controls[1], observed: "passed" as const }],
  };
  assertEquals(verifySemanticReview(expected, review, wrong).status, "failed");
});

Deno.test("count behavior accepts extra decisions and fails an incorrect observed example", () => {
  const record = {
    case_id: "p234-s5-c1",
    decisions: [{ id: "scope", choice: "Preserve other counts" }],
    acceptance: [
      { id: "zero", input: 0, expected: "0 items" },
      { id: "one", input: 1, expected: "1 item" },
      { id: "two", input: 2, expected: "2 items" },
      { id: "scope", input: 9, expected: "unchanged" },
    ],
  };
  const render = (value: typeof record) => `# Plan\n\n\`\`\`json\n${JSON.stringify(value)}\n\`\`\``;
  assertEquals(checkDeterministicBehavior("p234-s5-c1", render(record)).status, "passed");
  const extra = {
    ...record,
    acceptance: [...record.acceptance, { id: "scope-only", criterion: "Preserve other outputs" }],
  };
  assertEquals(
    checkDeterministicBehavior("p234-s5-c1", `\`\`\`json\n${JSON.stringify(extra)}\n\`\`\``).status,
    "passed",
  );
  const wrong = structuredClone(record);
  wrong.acceptance[1].expected = "1 items";
  assertEquals(checkDeterministicBehavior("p234-s5-c1", render(wrong)).status, "failed");
  assertEquals(checkDeterministicBehavior("p234-s5-c1", "# Plan\nA narrative result.").status, "not_applicable");
});

Deno.test("command evidence requires the requested execution and its observed result", () => {
  const expected = {
    requestId: "request-0123abcd",
    argv: ["count", "--status", "pending"],
    cwd: "/portal",
    exitCode: 0,
    stdout: "2\n",
  };
  assertEquals(verifyCommandObservation(expected, []).status, "pending");
  assertEquals(verifyCommandObservation(expected, [expected]).status, "passed");
  assertEquals(verifyCommandObservation(expected, [{ ...expected, stdout: "3\n" }]).status, "failed");
  assertEquals(verifyCommandObservation(expected, [{ ...expected, requestId: "request-89abcdef" }]).status, "pending");
  assertEquals(verifyCommandObservation(expected, [{ ...expected, exitCode: 1 }]).status, "failed");
});

Deno.test("delivery requires the expected revision and a matching request-bound submission capture", () => {
  const expected = {
    requestId: "request-0123abcd",
    skill: "plan",
    root: "dogfood",
    revision: "revision-a",
    sha256: "a".repeat(64),
    instructions: "The approved skill instructions.",
  };
  const usage = { ...expected, callId: "call-1", submissionKind: "provider", matchSource: "pinned" };
  const capture = { requestId: expected.requestId, callId: "call-1", prompt: `Prompt: ${expected.instructions}` };
  assertEquals(verifySkillSubmission(expected, usage, undefined).status, "pending");
  assertEquals(verifySkillSubmission(expected, usage, capture).status, "passed");
  assertEquals(verifySkillSubmission(expected, { ...usage, root: "blueprint" }, capture).status, "failed");
  assertEquals(verifySkillSubmission(expected, usage, { ...capture, requestId: "request-89abcdef" }).status, "failed");
  assertEquals(
    verifySkillSubmission(expected, usage, { ...capture, prompt: "No approved instructions" }).status,
    "failed",
  );
});

Deno.test("request case baseline measures actual portal changes and refuses replacement", async () => {
  const env = await TestEnvironment.create({ initGit: false });
  try {
    const portal = join(env.tempDir, "p234-s6-c1");
    await Deno.mkdir(portal);
    await Deno.writeTextFile(join(portal, "existing.md"), "initial");
    assertEquals((await observeWorkspaceChanges(env.tempDir, "p234-s6-c1")).status, "pending");
    await captureWorkspaceBaseline(env.tempDir, "p234-s6-c1");
    assertEquals((await observeWorkspaceChanges(env.tempDir, "p234-s6-c1")).status, "pending");
    await Deno.writeTextFile(join(portal, "notes.md"), "actual file");
    const changed = await observeWorkspaceChanges(env.tempDir, "p234-s6-c1");
    assertEquals(changed.status, "pending");
    assertEquals(changed.reasons, ["added: notes.md"]);
    await assertRejects(() => captureWorkspaceBaseline(env.tempDir, "p234-s6-c1"), Deno.errors.AlreadyExists);
    await assertRejects(() => captureWorkspaceBaseline(env.tempDir, "../escape"), Error, "Invalid case");
  } finally {
    await env.cleanup();
  }
});

Deno.test("diagnosis case baseline observes the group portal without assuming edits are forbidden", async () => {
  const env = await TestEnvironment.create({ initGit: false });
  try {
    const portal = join(env.tempDir, "p234-s2");
    await Deno.mkdir(portal);
    await captureWorkspaceBaseline(env.tempDir, "p234-s2-c1");
    await Deno.writeTextFile(join(portal, "regression.txt"), "evidence");
    const result = await observeWorkspaceChanges(env.tempDir, "p234-s2-c1");
    assertEquals(result.status, "pending");
    assertArrayIncludes(result.reasons, ["added: regression.txt"]);
  } finally {
    await env.cleanup();
  }
});

Deno.test("failed observations cannot be hidden by passing checks", () => {
  const result = evaluatePhase234({
    delivery: { status: "passed", reasons: [] },
    behavior: { status: "passed", reasons: [] },
    artifact: { status: "passed", reasons: [] },
    workspace: { status: "failed", reasons: ["Unexpected file created"] },
    commands: { status: "passed", reasons: [] },
  });
  assertEquals(result.effects.status, "failed");
  assertEquals(result.overall, "failed");
});

Deno.test("workspace snapshots detect added, removed, modified, and symlink changes", async () => {
  const env = await TestEnvironment.create({ initGit: false });
  const outside = await Deno.makeTempDir();
  try {
    const root = join(env.tempDir, "portal");
    await Deno.mkdir(root);
    await Deno.writeTextFile(join(root, "change.txt"), "before");
    await Deno.writeTextFile(join(root, "remove.txt"), "before");
    await Deno.writeTextFile(join(root, "mode.txt"), "unchanged content");
    await Deno.chmod(join(root, "mode.txt"), 0o644);
    const before = await snapshotWorkspace(env.tempDir, root);
    await Deno.writeTextFile(join(root, "change.txt"), "after");
    await Deno.remove(join(root, "remove.txt"));
    await Deno.writeTextFile(join(root, "new.txt"), "created");
    await Deno.symlink(outside, join(root, "link"));
    await Deno.chmod(join(root, "mode.txt"), 0o755);
    const after = await snapshotWorkspace(env.tempDir, root);
    const changes = compareWorkspaceSnapshots(before, after);
    assertEquals(changes.map((change) => [change.path, change.kind]), [
      ["change.txt", "modified"],
      ["link", "added"],
      ["mode.txt", "modified"],
      ["new.txt", "added"],
      ["remove.txt", "removed"],
    ]);
    await assertRejects(() => snapshotWorkspace(env.tempDir, outside), Error);
  } finally {
    await env.cleanup();
    await Deno.remove(outside, { recursive: true });
  }
});

Deno.test("baseline capture rejects a symlinked evidence directory outside the workspace", async () => {
  const env = await TestEnvironment.create({ initGit: false });
  const outside = await Deno.makeTempDir();
  try {
    await Deno.mkdir(join(env.tempDir, "p234-s6-c1"));
    await Deno.mkdir(join(env.tempDir, ".exa"), { recursive: true });
    await Deno.symlink(outside, join(env.tempDir, ".exa", "phase234-baselines"));
    await assertRejects(() => captureWorkspaceBaseline(env.tempDir, "p234-s6-c1"), Error, "Access denied");
    assertEquals([...Deno.readDirSync(outside)], []);
  } finally {
    await env.cleanup();
    await Deno.remove(outside, { recursive: true });
  }
});
