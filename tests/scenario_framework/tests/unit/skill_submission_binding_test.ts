/**
 * @module SkillSubmissionBindingTest
 * @path tests/scenario_framework/tests/unit/skill_submission_binding_test.ts
 * @description Binds a retained provider prompt to the request's unique journal submission.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/skill_delivery_observation.ts]
 */
import { assert, assertArrayIncludes, assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { createSkillLoaderFor, initTestDbService, REPO_ROOT, testSkillContext } from "@exaix/testing";
import { SkillRootKind } from "@exaix/core";
import { computeRevisionId, computeSkillContentSha256 } from "@exaix/core/skills";
import { bindRecordedSkillSubmission } from "../../runner/skill_delivery_observation.ts";

const REQUEST_ID = "request-2e9cc893";
const TRACE_ID = "2e9cc893-9093-44c7-93d4-dfdceba859ec";

async function loadFixBug() {
  const loaded = await createSkillLoaderFor([{
    path: join(REPO_ROOT, "Blueprints/Skills"),
    kind: SkillRootKind.BLUEPRINT,
    writable: false,
    project: null,
  }]).get("fix-bug", testSkillContext());
  if (!loaded) throw new Error("Blueprint fix-bug is missing");
  return loaded;
}

function bodyOf(skillMd: string): string {
  return skillMd.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
}

async function seedRevision(
  db: Awaited<ReturnType<typeof initTestDbService>>["db"],
  snapshot: Awaited<ReturnType<typeof loadFixBug>>["snapshot"],
): Promise<{ revision: string; hash: string }> {
  const hash = await computeSkillContentSha256(snapshot);
  const revision = await computeRevisionId(hash);
  await db.preparedRun(
    'INSERT INTO skill_revisions (revision_id, content_sha256, skill_name, skill_md, exaix_yaml, "references", first_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [
      revision,
      hash,
      "fix-bug",
      snapshot.skill_md,
      snapshot.exaix_yaml,
      JSON.stringify(snapshot.references),
      "2026-01-01",
    ],
  );
  return { revision, hash };
}

async function seedUsage(
  db: Awaited<ReturnType<typeof initTestDbService>>["db"],
  callId: string,
  revision: string,
  skillName = "fix-bug",
  renderMode = "full",
): Promise<void> {
  await db.preparedRun(
    "INSERT INTO skill_usage (call_id, revision_id, skill_name, trace_id, request_id, agent_role, match_source, render_mode, submission_kind, round, attempt, root_kind, source_path, config_generation, used_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [
      callId,
      revision,
      skillName,
      TRACE_ID,
      REQUEST_ID,
      "senior-coder",
      "pinned",
      renderMode,
      "provider",
      1,
      1,
      "blueprint",
      skillName,
      "test",
      "2026-01-01",
    ],
  );
}

async function writeCapture(
  root: string,
  prompt: string,
  overrides: Record<string, string> = {},
): Promise<void> {
  await Deno.mkdir(join(root, ".exa", "phase234-evidence"), { recursive: true });
  await Deno.writeTextFile(
    join(root, ".exa", "phase234-evidence", "fix-bug-provider-prompt.json"),
    JSON.stringify({
      skill: "fix-bug",
      root: "blueprint",
      revision: overrides.revision ?? "",
      sha256: overrides.sha256 ?? "",
      prompt,
      ...(overrides.requestId === undefined ? {} : { requestId: overrides.requestId }),
      ...(overrides.callId === undefined ? {} : { callId: overrides.callId }),
    }),
    { mode: 0o600 },
  );
}

Deno.test("binding accepts a captured prompt for the request's unique submission", async () => {
  const env = await initTestDbService();
  try {
    const loaded = await loadFixBug();
    const { revision, hash } = await seedRevision(env.db, loaded.snapshot);
    await seedUsage(env.db, "call-1", revision);
    await seedUsage(env.db, "call-1", revision, "response-contract");
    await writeCapture(env.tempDir, `# Prompt\n\n**Instructions:**\n${bodyOf(loaded.snapshot.skill_md)}\n`, {
      revision,
      sha256: hash,
    });
    const binding = await bindRecordedSkillSubmission(env.tempDir, "p234-s2-c1", REQUEST_ID);
    assertEquals(binding.result.status, "passed");
    assertEquals(binding.capture?.callId, "call-1");
    assertEquals(binding.usage?.revision, revision);
    assertEquals(binding.expected?.skill, "fix-bug");
  } finally {
    await env.cleanup();
  }
});

Deno.test("binding keeps a missing provider capture pending", async () => {
  const env = await initTestDbService();
  try {
    const loaded = await loadFixBug();
    const { revision } = await seedRevision(env.db, loaded.snapshot);
    await seedUsage(env.db, "call-1", revision);
    const binding = await bindRecordedSkillSubmission(env.tempDir, "p234-s2-c1", REQUEST_ID);
    assertEquals(binding.result.status, "pending");
    assertArrayIncludes(binding.result.reasons, ["Provider submission capture unavailable"]);
  } finally {
    await env.cleanup();
  }
});

Deno.test("binding rejects a capture for another revision or without the approved body", async () => {
  const env = await initTestDbService();
  try {
    const loaded = await loadFixBug();
    const { revision, hash } = await seedRevision(env.db, loaded.snapshot);
    await seedUsage(env.db, "call-1", revision);
    const body = bodyOf(loaded.snapshot.skill_md);
    await writeCapture(env.tempDir, `**Instructions:**\n${body}\n`, { revision: `${revision}-other`, sha256: hash });
    assertEquals((await bindRecordedSkillSubmission(env.tempDir, "p234-s2-c1", REQUEST_ID)).result.status, "failed");
    await writeCapture(env.tempDir, "A different prompt.", { revision, sha256: hash });
    assertEquals((await bindRecordedSkillSubmission(env.tempDir, "p234-s2-c1", REQUEST_ID)).result.status, "failed");
  } finally {
    await env.cleanup();
  }
});

Deno.test("binding rejects malformed captures instead of crashing evaluation", async () => {
  const env = await initTestDbService();
  try {
    const loaded = await loadFixBug();
    const { revision } = await seedRevision(env.db, loaded.snapshot);
    await seedUsage(env.db, "call-1", revision);
    await Deno.mkdir(join(env.tempDir, ".exa", "phase234-evidence"), { recursive: true });
    await Deno.writeTextFile(
      join(env.tempDir, ".exa", "phase234-evidence", "fix-bug-provider-prompt.json"),
      "{not json",
    );
    const binding = await bindRecordedSkillSubmission(env.tempDir, "p234-s2-c1", REQUEST_ID);
    assertEquals(binding.result.status, "failed");
  } finally {
    await env.cleanup();
  }
});

Deno.test("binding accepts an explicit capture call identity when the request has several submissions", async () => {
  const env = await initTestDbService();
  try {
    const loaded = await loadFixBug();
    const { revision, hash } = await seedRevision(env.db, loaded.snapshot);
    await seedUsage(env.db, "call-1", revision);
    await seedUsage(env.db, "call-2", revision);
    await writeCapture(env.tempDir, `**Instructions:**\n${bodyOf(loaded.snapshot.skill_md)}\n`, {
      revision,
      sha256: hash,
      requestId: REQUEST_ID,
      callId: "call-2",
    });
    const binding = await bindRecordedSkillSubmission(env.tempDir, "p234-s2-c1", REQUEST_ID);
    assertEquals(binding.result.status, "passed");
    assertEquals(binding.capture?.callId, "call-2");
    assertEquals(binding.usage?.callId, "call-2");
  } finally {
    await env.cleanup();
  }
});

Deno.test("binding rejects an explicit call identity that is not in the journal", async () => {
  const env = await initTestDbService();
  try {
    const loaded = await loadFixBug();
    const { revision, hash } = await seedRevision(env.db, loaded.snapshot);
    await seedUsage(env.db, "call-1", revision);
    await writeCapture(env.tempDir, `**Instructions:**\n${bodyOf(loaded.snapshot.skill_md)}\n`, {
      revision,
      sha256: hash,
      requestId: REQUEST_ID,
      callId: "call-missing",
    });
    const binding = await bindRecordedSkillSubmission(env.tempDir, "p234-s2-c1", REQUEST_ID);
    assertEquals(binding.result.status, "failed");
  } finally {
    await env.cleanup();
  }
});

Deno.test("binding rejects a capture that names another request", async () => {
  const env = await initTestDbService();
  try {
    const loaded = await loadFixBug();
    const { revision, hash } = await seedRevision(env.db, loaded.snapshot);
    await seedUsage(env.db, "call-1", revision);
    await writeCapture(env.tempDir, `**Instructions:**\n${bodyOf(loaded.snapshot.skill_md)}\n`, {
      revision,
      sha256: hash,
      requestId: "request-89abcdef",
      callId: "call-1",
    });
    const binding = await bindRecordedSkillSubmission(env.tempDir, "p234-s2-c1", REQUEST_ID);
    assertEquals(binding.result.status, "failed");
  } finally {
    await env.cleanup();
  }
});

Deno.test("binding prefers a request-scoped capture over a shared skill capture", async () => {
  const env = await initTestDbService();
  try {
    const loaded = await loadFixBug();
    const { revision, hash } = await seedRevision(env.db, loaded.snapshot);
    await seedUsage(env.db, "call-1", revision);
    const body = bodyOf(loaded.snapshot.skill_md);
    await writeCapture(env.tempDir, "**Instructions:**\nWrong generic body.\n", { revision, sha256: hash });
    await Deno.writeTextFile(
      join(env.tempDir, ".exa", "phase234-evidence", `fix-bug-${REQUEST_ID}-provider-prompt.json`),
      JSON.stringify({
        skill: "fix-bug",
        root: "blueprint",
        revision,
        sha256: hash,
        prompt: `**Instructions:**\n${body}\n`,
        requestId: REQUEST_ID,
        callId: "call-1",
      }),
      { mode: 0o600 },
    );
    const binding = await bindRecordedSkillSubmission(env.tempDir, "p234-s2-c1", REQUEST_ID);
    assertEquals(binding.result.status, "passed");
  } finally {
    await env.cleanup();
  }
});

Deno.test("binding refuses an ambiguous request with more than one call identity", async () => {
  const env = await initTestDbService();
  try {
    const loaded = await loadFixBug();
    const { revision, hash } = await seedRevision(env.db, loaded.snapshot);
    await seedUsage(env.db, "call-1", revision);
    await seedUsage(env.db, "call-2", revision);
    await writeCapture(env.tempDir, `**Instructions:**\n${bodyOf(loaded.snapshot.skill_md)}\n`, {
      revision,
      sha256: hash,
    });
    const binding = await bindRecordedSkillSubmission(env.tempDir, "p234-s2-c1", REQUEST_ID);
    assertEquals(binding.result.status, "pending");
    assert(binding.result.reasons.some((reason) => reason.includes("multiple")));
  } finally {
    await env.cleanup();
  }
});

Deno.test("binding rejects a captured prompt that omits the approved revision body", async () => {
  const env = await initTestDbService();
  try {
    const loaded = await loadFixBug();
    const { revision, hash } = await seedRevision(env.db, loaded.snapshot);
    await seedUsage(env.db, "call-1", revision);
    await writeCapture(env.tempDir, "The approved instructions are absent.", { revision, sha256: hash });
    const binding = await bindRecordedSkillSubmission(env.tempDir, "p234-s2-c1", REQUEST_ID);
    assertEquals(binding.result.status, "failed");
  } finally {
    await env.cleanup();
  }
});

Deno.test("binding rejects a capture reached through an escaping symlink", async () => {
  const env = await initTestDbService();
  const outside = await Deno.makeTempDir();
  try {
    const loaded = await loadFixBug();
    const { revision } = await seedRevision(env.db, loaded.snapshot);
    await seedUsage(env.db, "call-1", revision);
    await Deno.mkdir(join(env.tempDir, ".exa"), { recursive: true });
    await Deno.symlink(outside, join(env.tempDir, ".exa", "phase234-evidence"));
    await assertRejects(() => bindRecordedSkillSubmission(env.tempDir, "p234-s2-c1", REQUEST_ID), Error);
  } finally {
    await env.cleanup();
    await Deno.remove(outside, { recursive: true });
  }
});
