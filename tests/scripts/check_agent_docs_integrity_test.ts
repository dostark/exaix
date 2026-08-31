/**
 * @module CheckAgentDocsIntegrityTest
 * @path tests/scripts/check_agent_docs_integrity_test.ts
 * @description Tests for check:agent-docs-integrity gate — 6 cases covering
 *   dangling-readme-link, dangling-docs-index-link, dangling-manifest-path,
 *   dangling-docs-symlink, consistent corpus, and live corpus.
 */
import { assertEquals, assertStringIncludes } from "@std/assert";
import { dirname, join } from "@std/path";
import { fromFileUrl } from "@std/path";

const REPO_ROOT = join(dirname(fromFileUrl(import.meta.url)), "..", "..");

async function runCheck(copilotDir: string): Promise<{ code: number; output: string }> {
  const command = new Deno.Command(Deno.execPath(), {
    args: ["run", "-A", "scripts/check_agent_docs_integrity.ts", copilotDir],
    cwd: REPO_ROOT,
    stdout: "piped",
    stderr: "piped",
  });
  const result = await command.output();
  const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
  return { code: result.code, output };
}

function createTempCorpus(files: Record<string, string>, symlinks?: Record<string, string>): string {
  const dir = Deno.makeTempDirSync({ prefix: "agent-docs-test-" });
  const copilotDir = join(dir, ".copilot");
  const docsDir = join(copilotDir, "docs");
  Deno.mkdirSync(docsDir, { recursive: true });
  for (const [relPath, content] of Object.entries(files)) {
    const fullPath = join(copilotDir, relPath);
    Deno.mkdirSync(dirname(fullPath), { recursive: true });
    Deno.writeTextFileSync(fullPath, content);
  }
  if (symlinks) {
    for (const [relPath, target] of Object.entries(symlinks)) {
      const fullPath = join(copilotDir, relPath);
      Deno.mkdirSync(dirname(fullPath), { recursive: true });
      try {
        Deno.symlinkSync(target, fullPath);
      } catch {
        // symlink may already exist
      }
    }
  }
  return copilotDir;
}

Deno.test({
  name: "check:agent-docs-integrity — (a) README links a missing file → FAIL",
  fn: async () => {
    const copilotDir = createTempCorpus({
      "docs/README.md": "- [missing.md](missing.md): does not exist",
    });
    const result = await runCheck(copilotDir);
    assertEquals(result.code, 1, "should exit 1 on dangling README link");
    assertStringIncludes(result.output, "dangling-readme-link");
    Deno.removeSync(join(copilotDir, ".."), { recursive: true });
  },
});

Deno.test({
  name: "check:agent-docs-integrity — (b) DOCS.md links a missing file → FAIL",
  fn: async () => {
    const copilotDir = createTempCorpus({
      "DOCS.md": "- [ghost.md](docs/ghost.md): does not exist",
    });
    const result = await runCheck(copilotDir);
    assertEquals(result.code, 1, "should exit 1 on dangling DOCS.md link");
    assertStringIncludes(result.output, "dangling-docs-index-link");
    Deno.removeSync(join(copilotDir, ".."), { recursive: true });
  },
});

Deno.test({
  name: "check:agent-docs-integrity — (c) manifest.json path → deleted file → FAIL",
  fn: async () => {
    const copilotDir = createTempCorpus({
      "manifest.json": JSON.stringify({
        docs: [{ path: ".copilot/docs/ghost.md", short_summary: "ghost" }],
      }),
    });
    const result = await runCheck(copilotDir);
    assertEquals(result.code, 1, "should exit 1 on dangling manifest path");
    assertStringIncludes(result.output, "dangling-manifest-path");
    Deno.removeSync(join(copilotDir, ".."), { recursive: true });
  },
});

Deno.test({
  name: "check:agent-docs-integrity — (d) docs/ symlink → missing target → FAIL",
  fn: async () => {
    const copilotDir = createTempCorpus(
      { "docs/README.md": "# placeholder" },
      { "docs/broken.md": "/nonexistent/target.md" },
    );
    const result = await runCheck(copilotDir);
    assertEquals(result.code, 1, "should exit 1 on dangling docs symlink");
    assertStringIncludes(result.output, "dangling-docs-symlink");
    Deno.removeSync(join(copilotDir, ".."), { recursive: true });
  },
});

Deno.test({
  name: "check:agent-docs-integrity — (e) consistent corpus → PASS",
  fn: async () => {
    const copilotDir = createTempCorpus({
      "docs/README.md": "- [real.md](real.md): exists",
      "docs/real.md": "# real content",
      "manifest.json": JSON.stringify({
        docs: [{ path: ".copilot/docs/real.md", short_summary: "real" }],
      }),
    });
    const result = await runCheck(copilotDir);
    assertEquals(result.code, 0, "should exit 0 on consistent corpus");
    Deno.removeSync(join(copilotDir, ".."), { recursive: true });
  },
});

Deno.test({
  name: "check:agent-docs-integrity — (f) live .copilot/ → PASS",
  fn: async () => {
    const result = await runCheck(join(REPO_ROOT, ".copilot"));
    assertEquals(result.code, 0, "live .copilot/ should pass integrity check");
  },
});

Deno.test({
  name: "check:agent-docs-integrity — (g) a retired zero-consumer folder reappears → FAIL",
  fn: async () => {
    const copilotDir = createTempCorpus({
      "docs/README.md": "# placeholder",
      "manifest.json": JSON.stringify({ docs: [] }),
    });
    Deno.mkdirSync(join(copilotDir, "providers"), { recursive: true });
    const result = await runCheck(copilotDir);
    assertEquals(result.code, 1, "should exit 1 when a retired folder reappears");
    assertStringIncludes(result.output, "forbidden-folder");
    Deno.removeSync(join(copilotDir, ".."), { recursive: true });
  },
});

Deno.test({
  name: "check:agent-docs-integrity — (h) docs README lists a root-doc symlink that does not exist → FAIL",
  fn: async () => {
    const copilotDir = createTempCorpus({
      // The "Symlinked root docs" section claims GLOSSARY.md too, but docs/GLOSSARY.md is a
      // regular file (the moved dev glossary), not a symlink.
      "docs/README.md": [
        "### Symlinked root docs",
        "",
        "- [ARCHITECTURE.md](../../ARCHITECTURE.md): System architecture.",
        "- [CODE_STYLE.md](../../CODE_STYLE.md): Coding standards.",
        "- [GLOSSARY.md](../../GLOSSARY.md): Concept-level glossary.",
        "",
      ].join("\n"),
      "docs/GLOSSARY.md": "---\ntitle: Exaix Developer Glossary\n---\n",
      "../ARCHITECTURE.md": "# architecture",
      "../CODE_STYLE.md": "# style",
      "../GLOSSARY.md": "# concept glossary",
      "manifest.json": JSON.stringify({ docs: [] }),
    }, { "docs/ARCHITECTURE.md": "../../ARCHITECTURE.md", "docs/CODE_STYLE.md": "../../CODE_STYLE.md" });
    const result = await runCheck(copilotDir);
    assertEquals(result.code, 1, "should exit 1 when a documented symlink is not present");
    assertStringIncludes(result.output, "docs-readme-symlink-list");
    Deno.removeSync(join(copilotDir, ".."), { recursive: true });
  },
});

Deno.test({
  name: "check:agent-docs-integrity — (i) docs README symlink list matches the real symlinks → PASS",
  fn: async () => {
    const copilotDir = createTempCorpus({
      "docs/README.md": [
        "### Symlinked root docs",
        "",
        "- [ARCHITECTURE.md](../../ARCHITECTURE.md): System architecture.",
        "- [CODE_STYLE.md](../../CODE_STYLE.md): Coding standards.",
        "",
      ].join("\n"),
      "../ARCHITECTURE.md": "# architecture",
      "../CODE_STYLE.md": "# style",
      "manifest.json": JSON.stringify({ docs: [] }),
    }, {
      "docs/ARCHITECTURE.md": "../../ARCHITECTURE.md",
      "docs/CODE_STYLE.md": "../../CODE_STYLE.md",
    });
    const result = await runCheck(copilotDir);
    assertEquals(result.code, 0, "should exit 0 when documented symlinks match reality");
    Deno.removeSync(join(copilotDir, ".."), { recursive: true });
  },
});
