/**
 * @module AgentDocsSecretScanTest
 * @path tests/agents/agent_docs_secret_scan_test.ts
 * @description Scans the whole `.copilot/` agent-docs corpus for committed credentials.
 *
 *   Replaces the secret-scan case in `claude_enhancements_test.ts`, which walked
 *   `Deno.readDir(".copilot")` NON-recursively and matched only `.md`. That covered 2 of 58
 *   markdown files — a planted `AKIA…` key in `.copilot/docs/GLOSSARY.md` passed it cleanly.
 *   Everything the corpus actually consists of (`skills/`, `docs/`, `prompts/`, `chunks/`) sat
 *   outside the scan while the test reported the corpus clean.
 *
 *   Its two sibling cases asserted `.copilot/manifest.json` exists and `Array.isArray(manifest.docs)`.
 *   `scripts/check_agent_docs_integrity.ts` (pre-commit gates 16/17) already validates the manifest
 *   far more strictly — it resolves every referenced path and fails on dangling entries — so those
 *   two were deleted rather than moved. `google_enhancements_test.ts` and
 *   `openai_enhancements_test.ts` were byte-identical to each other, named for providers neither
 *   one mentioned, and asserted only `Array.isArray(manifest.docs)`; both were deleted.
 * @architectural-layer Test
 * @related-files [scripts/check_agent_docs_integrity.ts, scripts/build_agents_index.ts]
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";

const CORPUS_ROOT = ".copilot";

/** Extensions that carry prose or config an agent reads — i.e. anywhere a key could be pasted. */
const SCANNED_EXTENSIONS = [".md", ".json", ".yaml", ".yml", ".txt"];

/** Credential shapes with enough structure to be unambiguous; excludes loose patterns like
 * /api[_-]?key/ since the corpus is full of that word in config docs and would stay permanently red. */
const SECRET_PATTERNS: ReadonlyArray<[name: string, pattern: RegExp]> = [
  ["AWS access key id", /AKIA[A-Z0-9]{16}/],
  ["OpenAI secret key", /sk-[a-zA-Z0-9]{32,}/],
  ["GitHub personal token", /ghp_[a-zA-Z0-9]{36}/],
  ["GitHub server token", /ghs_[a-zA-Z0-9]{36}/],
  ["Anthropic api key", /sk-ant-[a-zA-Z0-9-]{24,}/],
  ["Google api key", /AIza[a-zA-Z0-9_-]{35}/],
  ["Slack token", /xox[baprs]-[a-zA-Z0-9-]{10,}/],
  ["private key block", /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/],
];

async function collectCorpusFiles(dir: string, found: string[] = []): Promise<string[]> {
  for await (const entry of Deno.readDir(dir)) {
    const path = join(dir, entry.name);
    // Symlinks are followed by stat but not by isDirectory on the entry, and `.copilot/docs/`
    // contains them deliberately; resolve so a symlinked subtree is not silently skipped.
    const stat = await Deno.stat(path).catch(() => null);
    if (!stat) continue;
    if (stat.isDirectory) {
      await collectCorpusFiles(path, found);
    } else if (SCANNED_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
      found.push(path);
    }
  }
  return found;
}

Deno.test("[security][agent-docs] the scanner reaches the whole corpus, not just its top level", async () => {
  // Guards the exact defect this file replaces. An assert-absence test passes trivially when its
  // input set is empty or tiny, so the corpus size is pinned before anything is scanned.
  const files = await collectCorpusFiles(CORPUS_ROOT);
  const topLevel = files.filter((f) => f.split("/").length === 2);

  assert(files.length > 40, `expected the full .copilot corpus, only reached ${files.length} files`);
  assert(
    files.length > topLevel.length * 5,
    `scan looks top-level-only: ${files.length} total vs ${topLevel.length} at the root`,
  );
  assert(
    files.some((f) => f.startsWith(".copilot/skills/")),
    "skills/ holds most of the corpus and must be scanned",
  );
});

Deno.test("[security][agent-docs] the patterns actually match known credential shapes", () => {
  // A "nothing found" assertion is green both when the corpus is clean AND when the detector is
  // broken. This positive control separates the two: if a pattern is mangled, this fails while
  // the scan below stays misleadingly green.
  const samples: ReadonlyArray<[string, string]> = [
    ["AWS access key id", "AKIAIOSFODNN7EXAMPLE"],
    ["OpenAI secret key", "sk-" + "a".repeat(40)],
    ["GitHub personal token", "ghp_" + "b".repeat(36)],
    ["GitHub server token", "ghs_" + "c".repeat(36)],
    ["Anthropic api key", "sk-ant-" + "d".repeat(30)],
    ["Google api key", "AIza" + "e".repeat(35)],
    ["Slack token", "xoxb-" + "1".repeat(20)],
    ["private key block", "-----BEGIN RSA PRIVATE KEY-----"],
  ];

  for (const [name, sample] of samples) {
    const entry = SECRET_PATTERNS.find(([patternName]) => patternName === name);
    assert(entry, `no pattern registered for ${name}`);
    assert(entry[1].test(sample), `pattern "${name}" no longer matches its own credential shape`);
  }
  assertEquals(samples.length, SECRET_PATTERNS.length, "every registered pattern needs a control sample");
});

Deno.test("[security][agent-docs] no committed credentials anywhere in .copilot/", async () => {
  const files = await collectCorpusFiles(CORPUS_ROOT);
  const hits: string[] = [];

  for (const file of files) {
    const content = await Deno.readTextFile(file);
    for (const [name, pattern] of SECRET_PATTERNS) {
      const match = content.match(pattern);
      if (match) hits.push(`${file}: ${name} (${match[0].slice(0, 12)}…)`);
    }
  }

  assertEquals(hits, [], `credential-shaped strings committed to the agent-docs corpus:\n${hits.join("\n")}`);
});
