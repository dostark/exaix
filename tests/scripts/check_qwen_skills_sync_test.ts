/**
 * @module CheckQwenSkillsSyncTest
 * @path tests/scripts/check_qwen_skills_sync_test.ts
 * @description Tests for check:qwen-skills-sync gate
 */
import { assertEquals, assertStringIncludes } from "@std/assert";
import { dirname, join } from "@std/path";
import { fromFileUrl } from "@std/path";

const REPO_ROOT = join(dirname(fromFileUrl(import.meta.url)), "..", "..");

async function runCheck(): Promise<{ code: number; output: string }> {
  const command = new Deno.Command(Deno.execPath(), {
    args: ["run", "-A", "scripts/check_qwen_skills_sync.ts"],
    cwd: REPO_ROOT,
    stdout: "piped",
    stderr: "piped",
  });
  const result = await command.output();
  const output = new TextDecoder().decode(result.stdout) +
    new TextDecoder().decode(result.stderr);
  return { code: result.code, output };
}

function createTempFixture(files: Record<string, string>, qwenSkills: string[]): string {
  const dir = Deno.makeTempDirSync({ prefix: "qwen-sync-test-" });
  const skillsDir = join(dir, ".copilot", "skills");
  Deno.mkdirSync(skillsDir, { recursive: true });
  for (const [relPath, content] of Object.entries(files)) {
    const fullPath = join(skillsDir, relPath);
    Deno.mkdirSync(dirname(fullPath), { recursive: true });
    Deno.writeTextFileSync(fullPath, content);
  }
  const qwenDir = join(dir, ".qwen");
  Deno.mkdirSync(qwenDir, { recursive: true });
  const settings = { skills: qwenSkills.map((n) => `.copilot/skills/${n}`) };
  Deno.writeTextFileSync(join(qwenDir, "settings.json"), JSON.stringify(settings, null, 2));
  return dir;
}

Deno.test("check:qwen-skills-sync — live corpus PASS", async () => {
  const result = await runCheck();
  assertEquals(result.code, 0, "live corpus should be in sync");
});

Deno.test("check:qwen-skills-sync — detects missing skill", async () => {
  const tmpDir = createTempFixture(
    {
      "exists/SKILL.md": "---\nname: exists\nqwen_skill: exists\n---\n# body",
      "missing/SKILL.md": "---\nname: missing\nqwen_skill: missing\n---\n# body",
    },
    ["exists"],
  );
  const scriptPath = join(REPO_ROOT, "scripts", "check_qwen_skills_sync.ts");
  const command = new Deno.Command(Deno.execPath(), {
    args: ["run", "-A", scriptPath],
    cwd: tmpDir,
    stdout: "piped",
    stderr: "piped",
  });
  const result = await command.output();
  const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
  assertEquals(result.code, 1, "should exit 1 on missing skill");
  assertStringIncludes(output, "missing");
  Deno.removeSync(tmpDir, { recursive: true });
});

Deno.test("check:qwen-skills-sync — detects stale entry", async () => {
  const tmpDir = createTempFixture(
    {
      "exists/SKILL.md": "---\nname: exists\nqwen_skill: exists\n---\n# body",
    },
    ["exists", "ghost"],
  );
  const scriptPath = join(REPO_ROOT, "scripts", "check_qwen_skills_sync.ts");
  const command = new Deno.Command(Deno.execPath(), {
    args: ["run", "-A", scriptPath],
    cwd: tmpDir,
    stdout: "piped",
    stderr: "piped",
  });
  const result = await command.output();
  const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
  assertEquals(result.code, 1, "should exit 1 on stale entry");
  assertStringIncludes(output, "ghost");
  Deno.removeSync(tmpDir, { recursive: true });
});
