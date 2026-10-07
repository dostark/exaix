/**
 * @module SkillCommandsCliTest
 * @path apps/exactl/tests/commands/skill_commands_cli_test.ts
 * @description Real `exactl` subprocesses under EXA_CONFIG_PATH drive every skill command through both
 *   registered aliases, `exactl skills` and `exactl memory skill`. A draft is created, approved only
 *   with the reviewed revision, deprecated, its history is read after the folder is deleted, and the
 *   process exit codes are 0 on success, 1 on a refused or failed operation and 2 on a malformed argument.
 * @architectural-layer CLI
 * @dependencies [@std/assert, @exaix/core/skills, ../../../../tests/integration/helpers/daemon_config.ts]
 * @related-files [apps/exactl/src/command_builders/skill_commands.ts, apps/exactl/src/commands/memory_commands.ts]
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { migrateDaemonWorkspace } from "../../../../tests/integration/helpers/daemon_config.ts";

const REPO_ROOT = join(import.meta.dirname!, "..", "..", "..", "..");
const EXACTL = join(REPO_ROOT, "apps", "exactl", "src", "exactl.ts");

interface ICliResult {
  code: number;
  out: string;
  err: string;
}

interface IWorkspace {
  root: string;
  run: (alias: "skills" | "memory skill", args: string[]) => Promise<ICliResult>;
  cleanup: () => Promise<void>;
}

async function workspace(): Promise<IWorkspace> {
  const root = await Deno.makeTempDir({ prefix: "exactl-skill-cli-" });
  const configPath = join(root, "exa.config.toml");
  await Deno.writeTextFile(configPath, `[system]\nroot = "${root}"\nversion = "1.0.0"\nlog_level = "error"\n`);
  await migrateDaemonWorkspace(root);
  return {
    root,
    async run(alias, args) {
      const result = await new Deno.Command("deno", {
        args: ["run", "-A", "--config", join(REPO_ROOT, "deno.json"), EXACTL, ...alias.split(" "), ...args],
        cwd: root,
        env: { EXA_CONFIG_PATH: configPath, EXA_TEST_MODE: "" },
        stdout: "piped",
        stderr: "piped",
      }).output();
      const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
      return { code: result.code, out: decode(result.stdout), err: decode(result.stderr) };
    },
    cleanup: () => Deno.remove(root, { recursive: true }),
  };
}

/** The CLI echoes journal events as plain lines before the result, so the JSON document starts at its own line. */
function jsonOf(out: string): ReturnType<typeof JSON.parse> {
  const lines = out.split("\n");
  const start = lines.findIndex((line) => line === "{" || line === "[" || line === "[]");
  assert(start >= 0, `no JSON document in output: ${out}`);
  return JSON.parse(lines.slice(start).join("\n"));
}

function revisionOf(out: string): string {
  const match = out.match(/Revision: ([0-9a-f-]{36})/);
  assert(match, `no revision in output: ${out}`);
  return match[1];
}

for (const alias of ["skills", "memory skill"] as const) {
  Deno.test(`[cli ${alias}] create, review-bound approve, deprecate and history through real processes`, async () => {
    const ws = await workspace();
    try {
      const slug = alias === "skills" ? "cli-skill-a" : "cli-skill-b";
      const created = await ws.run(alias, ["create", slug, "--instructions", "CLI body one."]);
      assertEquals(created.code, 0, created.err);
      assertStringIncludes(created.out, `Draft path: learned/${slug}`);
      const reviewed = revisionOf(created.out);

      const wrong = await ws.run(alias, ["approve", slug, "--revision", crypto.randomUUID()]);
      assertEquals(wrong.code, 1);
      assertStringIncludes(wrong.err, "skill_revision_mismatch");

      const malformed = await ws.run(alias, ["approve", slug, "--revision", "not-a-uuid"]);
      assertEquals(malformed.code, 2);
      const badName = await ws.run(alias, ["approve", "Bad Name", "--revision", reviewed]);
      assertEquals(badName.code, 2);
      const missingOption = await ws.run(alias, ["approve", slug]);
      assertEquals(missingOption.code, 2, "a missing required option is an argument error");

      const approved = await ws.run(alias, ["approve", slug, "--revision", reviewed, "--format", "json"]);
      assertEquals(approved.code, 0, approved.err);
      const active = jsonOf(approved.out);
      assertEquals([active.name, active.reviewedRevisionId, active.status], [slug, reviewed, "active"]);

      const again = await ws.run(alias, ["approve", slug, "--revision", active.activeRevisionId]);
      assertEquals(again.code, 1, "approving an active skill is refused");

      const valid = await ws.run(alias, ["validate", "--format", "json"]);
      assertEquals(valid.code, 0, valid.err);
      assertEquals(jsonOf(valid.out).valid, true);

      const deprecated = await ws.run(alias, ["deprecate", slug]);
      assertEquals(deprecated.code, 0, deprecated.err);
      assertStringIncludes(deprecated.out, "deprecated");
      const unknown = await ws.run(alias, ["deprecate", "no-such-skill"]);
      assertEquals(unknown.code, 1);

      await Deno.remove(join(ws.root, "Memory", "Skills", "learned", slug), { recursive: true });
      const missing = await ws.run(alias, ["validate", slug]);
      assertEquals(missing.code, 1, "a deleted skill is unknown to validate");
      const revisions = await ws.run(alias, ["revisions", slug, "--format", "json"]);
      assertEquals(revisions.code, 0, revisions.err);
      assertEquals(jsonOf(revisions.out), [], "revisions are stored on first use, and this skill was never used");
      const unknownTrace = await ws.run(alias, ["usage", "--trace", crypto.randomUUID()]);
      assertEquals(unknownTrace.code, 0);
      assertStringIncludes(unknownTrace.out, "No skill usage recorded");
      const noTrace = await ws.run(alias, ["usage"]);
      assertEquals(noTrace.code, 2);
    } finally {
      await ws.cleanup();
    }
  });
}

Deno.test("[cli] validate reports a broken folder with typed reasons and exits 1 without writing", async () => {
  const ws = await workspace();
  try {
    const broken = join(ws.root, "Memory", "Skills", "learned", "broken-skill");
    await Deno.mkdir(broken, { recursive: true });
    await Deno.writeTextFile(join(broken, "SKILL.md"), "no frontmatter SECRET_CONTENT");
    const result = await ws.run("skills", ["validate", "--format", "json"]);
    assertEquals(result.code, 1);
    const report = jsonOf(result.out);
    assertEquals(report.valid, false);
    assertEquals(report.diagnostics.some((d: { name: string }) => d.name === "broken-skill"), true);
    assert(!result.out.includes("SECRET_CONTENT") && !result.err.includes("SECRET_CONTENT"));
    assert(!result.out.includes(ws.root), "no host path in the report");
    const listed = await ws.run("skills", ["list", "--all", "--format", "json"]);
    assertEquals(listed.code, 0, listed.err);
    assertEquals(jsonOf(listed.out).diagnostics.length > 0, true);
  } finally {
    await ws.cleanup();
  }
});

Deno.test("[cli] both aliases advertise the same commands in their help", async () => {
  const ws = await workspace();
  try {
    for (const alias of ["skills", "memory skill"] as const) {
      const help = await ws.run(alias, ["--help"]);
      assertEquals(help.code, 0, help.err);
      for (const command of ["approve", "deprecate", "revisions", "usage", "validate", "show", "list"]) {
        assertStringIncludes(help.out, command);
      }
    }
  } finally {
    await ws.cleanup();
  }
});
