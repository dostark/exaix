/**
 * @module CheckMdPathsTest
 * @path tests/scripts/check_md_paths_test.ts
 * @description Tests for scripts/check_md_paths.ts — the stale-path gate that scans
 *   markdown files across the repo (and submodules) for filesystem path references
 *   that no longer resolve. Each candidate path is validated MD-relative first
 *   (relative to the markdown file's own directory) then repo-root as a fallback.
 *   Covers all three path forms (markdown links, backticked code paths, bare prose
 *   paths), external-URL/anchor skipping, and the single-match auto-fix in --fix mode
 *   (rewrite only when the stale basename resolves to exactly one repo location).
 * @architectural-layer Script (test)
 * @dependencies [@std/assert, @std/fs, @std/path]
 * @related-files [scripts/check_md_paths.ts]
 */

import { assert, assertEquals } from "@std/assert";
import { ensureDir } from "@std/fs";
import { join } from "@std/path";
import { applyBacktickFix, applyFix, checkMdPaths, extractHeadings, slugify } from "../../scripts/check_md_paths.ts";

async function sandbox(): Promise<{ root: string; cleanup: () => void }> {
  const root = await Deno.makeTempDir({ prefix: "md_paths_" });
  return { root, cleanup: () => Deno.removeSync(root, { recursive: true }) };
}

Deno.test("[md-paths] a markdown link resolving MD-relative passes", async () => {
  const { root, cleanup } = await sandbox();
  try {
    await ensureDir(join(root, "docs"));
    await Deno.writeTextFile(join(root, "docs", "target.md"), "# target\n");
    await Deno.writeTextFile(join(root, "docs", "index.md"), "See [t](./target.md).\n");
    const r = await checkMdPaths(root);
    assertEquals(r.violations.length, 0, JSON.stringify(r.violations));
    assertEquals(r.ok, true);
  } finally {
    cleanup();
  }
});

Deno.test("[md-paths] a markdown link to a repo-root path passes via the root fallback", async () => {
  const { root, cleanup } = await sandbox();
  try {
    await ensureDir(join(root, "packages", "core"));
    await Deno.writeTextFile(join(root, "packages", "core", "x.ts"), "export const x = 1;\n");
    await ensureDir(join(root, "deep", "nested"));
    // A deeply-nested doc referencing a repo-root-style path.
    await Deno.writeTextFile(
      join(root, "deep", "nested", "README.md"),
      "See `packages/core/x.ts` for details.\n",
    );
    const r = await checkMdPaths(root);
    assertEquals(r.violations.length, 0, JSON.stringify(r.violations));
  } finally {
    cleanup();
  }
});

Deno.test("[md-paths] a broken markdown link is flagged", async () => {
  const { root, cleanup } = await sandbox();
  try {
    await ensureDir(join(root, "docs"));
    await Deno.writeTextFile(join(root, "docs", "index.md"), "See [gone](./missing.md).\n");
    const r = await checkMdPaths(root);
    assertEquals(r.ok, false);
    assert(r.violations.some((v) => v.reference === "./missing.md"));
  } finally {
    cleanup();
  }
});

Deno.test("[md-paths] a broken backticked code path is flagged", async () => {
  const { root, cleanup } = await sandbox();
  try {
    await Deno.writeTextFile(
      join(root, "README.md"),
      "Edit `packages/core/src/constants.ts` to change it.\n",
    );
    const r = await checkMdPaths(root);
    assertEquals(r.ok, false);
    assert(r.violations.some((v) => v.reference === "packages/core/src/constants.ts"));
  } finally {
    cleanup();
  }
});

Deno.test("[md-paths] a broken bare-prose path is flagged", async () => {
  const { root, cleanup } = await sandbox();
  try {
    await Deno.writeTextFile(
      join(root, "README.md"),
      "The handler lives in packages/mcp/src/handlers/foo_tool.ts today.\n",
    );
    const r = await checkMdPaths(root);
    assertEquals(r.ok, false);
    assert(r.violations.some((v) => v.reference.includes("packages/mcp/src/handlers/foo_tool.ts")));
  } finally {
    cleanup();
  }
});

Deno.test("[md-paths] a reference to an existing file with a #anchor is NOT flagged", async () => {
  const { root, cleanup } = await sandbox();
  try {
    await Deno.writeTextFile(join(root, "Reference.md"), "# ref\n");
    // Both a backticked and a bare reference with a trailing #section on a real file.
    await Deno.writeTextFile(
      join(root, "README.md"),
      "See `Reference.md#some-section` and also Reference.md#other-section here.\n",
    );
    const r = await checkMdPaths(root);
    assertEquals(r.violations.length, 0, JSON.stringify(r.violations));
  } finally {
    cleanup();
  }
});

Deno.test("[md-paths] external URLs and anchors are ignored", async () => {
  const { root, cleanup } = await sandbox();
  try {
    await Deno.writeTextFile(
      join(root, "README.md"),
      "[web](https://example.com/x.md) and [anchor](#section) and [mail](mailto:a@b.co)\n",
    );
    const r = await checkMdPaths(root);
    assertEquals(r.violations.length, 0, JSON.stringify(r.violations));
  } finally {
    cleanup();
  }
});

Deno.test("[md-paths] --fix rewrites a stale path when its basename has exactly one repo match", async () => {
  const { root, cleanup } = await sandbox();
  try {
    // Real file lives at the NEW location.
    await ensureDir(join(root, "packages", "core", "src", "types"));
    await Deno.writeTextFile(
      join(root, "packages", "core", "src", "types", "constants.ts"),
      "export const C = 1;\n",
    );
    // Doc references the OLD (moved) location via a markdown LINK (fixable).
    const doc = join(root, "README.md");
    await Deno.writeTextFile(doc, "Never edit [constants](packages/core/src/constants.ts) directly.\n");

    const r = await checkMdPaths(root);
    assertEquals(r.ok, false);
    const v = r.violations.find((x) => x.reference === "packages/core/src/constants.ts");
    assert(v, "expected the stale ref to be flagged");
    assertEquals(v!.suggestion, "packages/core/src/types/constants.ts", "single unambiguous match");

    const fixed = await applyFix(root, r.violations);
    assertEquals(fixed, 1, "one path rewritten");
    const after = await Deno.readTextFile(doc);
    assert(after.includes("packages/core/src/types/constants.ts"), `rewritten: ${after}`);
    assert(!after.includes("(packages/core/src/constants.ts)"), "old path gone");
  } finally {
    cleanup();
  }
});

Deno.test("[md-paths] a relative markdown link's suggestion stays relative-correct from the MD file", async () => {
  const { root, cleanup } = await sandbox();
  try {
    // Real file at repo root.
    await Deno.writeTextFile(join(root, "CODE_STYLE.md"), "# style\n");
    // A deeply-nested doc with a WRONG relative link (`../../` doesn't reach root).
    await ensureDir(join(root, "a", "b", "c"));
    const doc = join(root, "a", "b", "c", "SKILL.md");
    await Deno.writeTextFile(doc, "See [style](../../CODE_STYLE.md).\n");

    const r = await checkMdPaths(root);
    const v = r.violations.find((x) => x.reference === "../../CODE_STYLE.md");
    assert(v, "the broken relative link is flagged");
    // The suggestion must be the correct RELATIVE path from a/b/c/ → ../../../CODE_STYLE.md,
    // NOT the repo-root path CODE_STYLE.md (which would render as a broken link).
    assertEquals(v!.suggestion, "../../../CODE_STYLE.md");

    await applyFix(root, r.violations);
    const after = await Deno.readTextFile(doc);
    assert(after.includes("(../../../CODE_STYLE.md)"), `relative-correct: ${after}`);
    // And the fix genuinely resolves now.
    const r2 = await checkMdPaths(root);
    assertEquals(r2.violations.length, 0, JSON.stringify(r2.violations));
  } finally {
    cleanup();
  }
});

Deno.test("[md-paths] a repo-root-style reference's suggestion stays repo-root", async () => {
  const { root, cleanup } = await sandbox();
  try {
    await ensureDir(join(root, "packages", "core", "src", "types"));
    await Deno.writeTextFile(join(root, "packages", "core", "src", "types", "constants.ts"), "1");
    const doc = join(root, "deep", "README.md");
    await ensureDir(join(root, "deep"));
    await Deno.writeTextFile(doc, "Edit `packages/core/src/constants.ts`.\n");
    const r = await checkMdPaths(root);
    const v = r.violations.find((x) => x.reference === "packages/core/src/constants.ts");
    assert(v);
    // Was written repo-root-style (no ./ or ../) → suggestion stays repo-root.
    assertEquals(v!.suggestion, "packages/core/src/types/constants.ts");
  } finally {
    cleanup();
  }
});

Deno.test("[md-paths] --fix does NOT rewrite when the basename has multiple repo matches (ambiguous)", async () => {
  const { root, cleanup } = await sandbox();
  try {
    await ensureDir(join(root, "a"));
    await ensureDir(join(root, "b"));
    await Deno.writeTextFile(join(root, "a", "constants.ts"), "1");
    await Deno.writeTextFile(join(root, "b", "constants.ts"), "2");
    const doc = join(root, "README.md");
    await Deno.writeTextFile(doc, "See `src/constants.ts`.\n");

    const r = await checkMdPaths(root);
    const v = r.violations.find((x) => x.reference === "src/constants.ts");
    assert(v, "flagged");
    assertEquals(v!.suggestion, undefined, "ambiguous → no suggestion");

    const fixed = await applyFix(root, r.violations);
    assertEquals(fixed, 0, "ambiguous refs are not auto-rewritten");
    assertEquals(await Deno.readTextFile(doc), "See `src/constants.ts`.\n", "unchanged");
  } finally {
    cleanup();
  }
});

Deno.test("[md-paths] @-prefixed package import specifiers are NOT treated as filesystem paths", async () => {
  const { root, cleanup } = await sandbox();
  try {
    await Deno.writeTextFile(
      join(root, "README.md"),
      "Import from `@exaix/core/config/env_schema.ts` and `@exaix/ai/src/llm_client.ts`.\n",
    );
    const r = await checkMdPaths(root);
    assertEquals(r.violations.length, 0, JSON.stringify(r.violations));
  } finally {
    cleanup();
  }
});

Deno.test("[md-paths] a valid script path inside a `deno run ...` command line is not a false positive", async () => {
  const { root, cleanup } = await sandbox();
  try {
    await ensureDir(join(root, "scripts"));
    await Deno.writeTextFile(join(root, "scripts", "build.ts"), "1");
    await Deno.writeTextFile(
      join(root, "README.md"),
      "Run `deno run --allow-read scripts/build.ts` to rebuild.\n",
    );
    const r = await checkMdPaths(root);
    assertEquals(r.violations.length, 0, JSON.stringify(r.violations));
  } finally {
    cleanup();
  }
});

Deno.test("[md-paths] --fix rewrites link-style refs but NOT bare-prose example paths", async () => {
  const { root, cleanup } = await sandbox();
  try {
    // A single real file whose basename matches BOTH the link and the prose ref.
    await ensureDir(join(root, "sub"));
    await Deno.writeTextFile(join(root, "sub", "memory.ts"), "1");
    const doc = join(root, "index.md");
    // A real relative LINK to the moved file (should be fixed) + a prose EXAMPLE path
    // with the same basename (should NOT be fixed — it's an illustrative placeholder).
    await Deno.writeTextFile(
      doc,
      "See [m](./old/memory.ts). Example: add the new mcp/handlers/memory.ts handler.\n",
    );

    const r = await checkMdPaths(root);
    const link = r.violations.find((v) => v.reference === "./old/memory.ts");
    const prose = r.violations.find((v) => v.reference === "mcp/handlers/memory.ts");
    assert(link, "the broken link is flagged");
    assert(link!.suggestion, "the link has an unambiguous suggestion");
    assert(prose, "the prose example path is flagged (report), too");
    // applyFix only touches the link-style one.
    const fixed = await applyFix(root, r.violations);
    assertEquals(fixed, 1, "only the link-style ref is auto-rewritten");
    const after = await Deno.readTextFile(doc);
    assert(after.includes("./sub/memory.ts"), `link fixed: ${after}`);
    assert(after.includes("mcp/handlers/memory.ts"), "prose example path left untouched");
  } finally {
    cleanup();
  }
});

// Bare-path-in-prose backtick facet

Deno.test("[md-backtick] a RESOLVABLE bare prose path is reported as a style violation", async () => {
  const { root, cleanup } = await sandbox();
  try {
    await ensureDir(join(root, "packages", "core", "src"));
    await Deno.writeTextFile(join(root, "packages", "core", "src", "config.ts"), "1");
    await Deno.writeTextFile(
      join(root, "README.md"),
      "The config lives in packages/core/src/config.ts today.\n",
    );
    const r = await checkMdPaths(root);
    assertEquals(r.ok, false, "style violations make it not-ok");
    assert(
      r.styleViolations.some((v) => v.reference === "packages/core/src/config.ts"),
      JSON.stringify(r.styleViolations),
    );
  } finally {
    cleanup();
  }
});

Deno.test("[md-backtick] an UNRESOLVABLE bare prose path is NOT a style violation (no backtick nag)", async () => {
  const { root, cleanup } = await sandbox();
  try {
    // A hypothetical/example path that does not resolve — must not be nagged to backtick.
    await Deno.writeTextFile(
      join(root, "README.md"),
      "Example: add the new mcp/handlers/memory.ts handler.\n",
    );
    const r = await checkMdPaths(root);
    assertEquals(
      r.styleViolations.length,
      0,
      "unresolvable bare paths are not style violations",
    );
  } finally {
    cleanup();
  }
});

Deno.test("[md-backtick] backticked, linked, and fenced paths are NOT style violations", async () => {
  const { root, cleanup } = await sandbox();
  try {
    await ensureDir(join(root, "pkg"));
    await Deno.writeTextFile(join(root, "pkg", "a.ts"), "1");
    await Deno.writeTextFile(join(root, "pkg", "b.ts"), "1");
    await Deno.writeTextFile(join(root, "pkg", "c.ts"), "1");
    await Deno.writeTextFile(join(root, "target.md"), "# t\n");
    await Deno.writeTextFile(
      join(root, "README.md"),
      [
        "Already good: `pkg/a.ts`.",
        "A link: [b](pkg/b.ts).",
        "```bash",
        "cat pkg/c.ts   # inside a fence — exempt",
        "```",
        "",
      ].join("\n"),
    );
    const r = await checkMdPaths(root);
    assertEquals(r.styleViolations.length, 0, JSON.stringify(r.styleViolations));
  } finally {
    cleanup();
  }
});

Deno.test("[md-backtick] applyBacktickFix wraps only resolvable bare prose paths", async () => {
  const { root, cleanup } = await sandbox();
  try {
    await ensureDir(join(root, "packages", "core", "src"));
    await Deno.writeTextFile(join(root, "packages", "core", "src", "config.ts"), "1");
    const doc = join(root, "README.md");
    // One resolvable bare path (fix) + one unresolvable example (leave).
    await Deno.writeTextFile(
      doc,
      "See packages/core/src/config.ts and also the example foo/bar/missing.ts here.\n",
    );

    const r = await checkMdPaths(root);
    const wrapped = await applyBacktickFix(root, r.styleViolations);
    assertEquals(wrapped, 1, "only the resolvable bare path is wrapped");
    const after = await Deno.readTextFile(doc);
    assert(after.includes("`packages/core/src/config.ts`"), `wrapped: ${after}`);
    assert(after.includes("foo/bar/missing.ts"), "unresolvable example left as-is");
    assert(!after.includes("`foo/bar/missing.ts`"), "unresolvable example not wrapped");

    // Re-check: no more style violations for the wrapped path.
    const r2 = await checkMdPaths(root);
    assert(!r2.styleViolations.some((v) => v.reference === "packages/core/src/config.ts"));
  } finally {
    cleanup();
  }
});

Deno.test("[md-backtick] a bare path inside an UNFENCED shell command line is exempt (wrapping would break the command)", async () => {
  const { root, cleanup } = await sandbox();
  try {
    await ensureDir(join(root, "scripts"));
    await Deno.writeTextFile(join(root, "scripts", "gen.ts"), "1");
    await ensureDir(join(root, ".copilot"));
    await Deno.writeTextFile(join(root, ".copilot", "manifest.json"), "[]");
    await Deno.writeTextFile(
      join(root, "README.md"),
      [
        "Run these:",
        "  cat .copilot/manifest.json | jq '.'", // pipe → shell command
        "  deno run -A scripts/gen.ts", // deno run → shell command
        "  ls && scripts/gen.ts", // && → shell command
        "",
      ].join("\n"),
    );
    const r = await checkMdPaths(root);
    assertEquals(r.styleViolations.length, 0, JSON.stringify(r.styleViolations));
  } finally {
    cleanup();
  }
});

Deno.test("[md-backtick] bare paths in YAML frontmatter and HTML comments are exempt", async () => {
  const { root, cleanup } = await sandbox();
  try {
    await ensureDir(join(root, "scripts"));
    await Deno.writeTextFile(join(root, "scripts", "gen.ts"), "1");
    await Deno.writeTextFile(
      join(root, "README.md"),
      [
        "---",
        "description: generated by scripts/gen.ts",
        "links:",
        "  - scripts/gen.ts",
        "---",
        "",
        "<!-- This file is generated by scripts/gen.ts -->",
        "",
        "# Title",
        "",
        "Real prose mentioning scripts/gen.ts here.",
        "",
      ].join("\n"),
    );
    const r = await checkMdPaths(root);
    // Only the ONE real-prose mention is flagged; frontmatter + comment are exempt.
    assertEquals(r.styleViolations.length, 1, JSON.stringify(r.styleViolations));
    assertEquals(r.styleViolations[0].line, 11);
  } finally {
    cleanup();
  }
});

Deno.test("[md-backtick] wrapping does not double-backtick or corrupt a path already in a table cell link", async () => {
  const { root, cleanup } = await sandbox();
  try {
    await ensureDir(join(root, "pkg"));
    await Deno.writeTextFile(join(root, "pkg", "x.ts"), "1");
    const doc = join(root, "README.md");
    await Deno.writeTextFile(doc, "| Comp | `pkg/x.ts` | ok |\n");
    const r = await checkMdPaths(root);
    assertEquals(r.styleViolations.length, 0, "already backticked in a table → no violation");
  } finally {
    cleanup();
  }
});

Deno.test("[md-paths] scans nested markdown and resolves relative to each file's own dir", async () => {
  const { root, cleanup } = await sandbox();
  try {
    await ensureDir(join(root, "packages", "foo"));
    await Deno.writeTextFile(join(root, "packages", "foo", "sibling.md"), "# s\n");
    // Relative link that is only valid from THIS file's directory.
    await Deno.writeTextFile(
      join(root, "packages", "foo", "README.md"),
      "See [s](./sibling.md).\n",
    );
    const r = await checkMdPaths(root);
    assertEquals(r.violations.length, 0, JSON.stringify(r.violations));
  } finally {
    cleanup();
  }
});

// Anchor-fragment validation (markdown-link syntax only)

Deno.test("[md-anchors] slugify matches GitHub's algorithm for known-good repo anchors", () => {
  assertEquals(slugify("Behavioral Guidelines"), "behavioral-guidelines");
  assertEquals(slugify("Task Checklist"), "task-checklist");
  assertEquals(slugify("2. No Magic Numbers or Strings"), "2-no-magic-numbers-or-strings");
  // Regression: GitHub does NOT collapse a run left behind by a removed character —
  // "Skills & Plans" strips only "&", both flanking spaces survive as two hyphens.
  // Verified against this repo's own real (working) cross-reference in
  // docs/Exaix_Dogfooding.md ("## 5. Skills & Plans" -> "#5-skills--plans").
  assertEquals(slugify("5. Skills & Plans"), "5-skills--plans");
  assertEquals(slugify("Search & Filter"), "search--filter");
  assertEquals(slugify("Split View / Panes"), "split-view--panes");
  assertEquals(slugify("Conceptual Alignment — Where They Agree"), "conceptual-alignment--where-they-agree");
});

Deno.test("[md-anchors] extractHeadings honors an explicit {#custom-id} override", () => {
  const headings = extractHeadings("## 🤖 Agent Tool Index (MCP) {#agent-tools}\n\nbody\n");
  assertEquals(headings.length, 1);
  assertEquals(headings[0].slug, "agent-tools");
  assertEquals(headings[0].text, "🤖 Agent Tool Index (MCP)");
});

Deno.test("[md-anchors] extractHeadings disambiguates duplicate slugs like GitHub (-1, -2, ...)", () => {
  const headings = extractHeadings("## Foo\n\n## Foo\n\n## Foo\n");
  assertEquals(headings.map((h) => h.slug), ["foo", "foo-1", "foo-2"]);
});

Deno.test("[md-anchors] extractHeadings ignores a heading-shaped line inside a fenced code block", () => {
  // Regression: a `# step-manifest` line inside a yaml fence must never be treated
  // as a real H1 heading (this exact confusion previously corrupted step-manifest
  // blocks under a markdown-lint auto-fix pass).
  const headings = extractHeadings("# Real Heading\n\n```yaml\n# step-manifest\nstep: 1\n```\n");
  assertEquals(headings.map((h) => h.text), ["Real Heading"]);
});

Deno.test("[md-anchors] a same-file markdown-link anchor to an existing heading passes", async () => {
  const { root, cleanup } = await sandbox();
  try {
    await Deno.writeTextFile(
      join(root, "README.md"),
      "## Behavioral Guidelines\n\nSee [above](#behavioral-guidelines).\n",
    );
    const r = await checkMdPaths(root);
    assertEquals(r.anchorViolations.length, 0, JSON.stringify(r.anchorViolations));
    assertEquals(r.ok, true);
  } finally {
    cleanup();
  }
});

Deno.test("[md-anchors] a same-file markdown-link anchor to a NON-existent heading is flagged", async () => {
  const { root, cleanup } = await sandbox();
  try {
    await Deno.writeTextFile(
      join(root, "README.md"),
      "## Behavioral Guidelines\n\nSee [it](#task-checklist).\n",
    );
    const r = await checkMdPaths(root);
    assertEquals(r.ok, false);
    assertEquals(r.anchorViolations.length, 1);
    assertEquals(r.anchorViolations[0].fragment, "task-checklist");
    assertEquals(r.anchorViolations[0].targetFile, "README.md");
    assertEquals(r.anchorViolations[0].line, 3);
  } finally {
    cleanup();
  }
});

Deno.test("[md-anchors] a cross-file markdown-link anchor to an existing heading in the target passes", async () => {
  const { root, cleanup } = await sandbox();
  try {
    await Deno.writeTextFile(join(root, "ARCHITECTURE.md"), "## Request Processing Flow\n\nbody\n");
    await Deno.writeTextFile(
      join(root, "README.md"),
      "See [flow](ARCHITECTURE.md#request-processing-flow) for details.\n",
    );
    const r = await checkMdPaths(root);
    assertEquals(r.anchorViolations.length, 0, JSON.stringify(r.anchorViolations));
  } finally {
    cleanup();
  }
});

Deno.test("[md-anchors] a cross-file markdown-link anchor to a MISSING heading in the target is flagged", async () => {
  const { root, cleanup } = await sandbox();
  try {
    await Deno.writeTextFile(join(root, "CONTRIBUTING.md"), "## Hooks\n\nbody\n");
    await Deno.writeTextFile(
      join(root, "README.md"),
      "See [checklist](CONTRIBUTING.md#task-checklist) for details.\n",
    );
    const r = await checkMdPaths(root);
    assertEquals(r.ok, false);
    assertEquals(r.anchorViolations.length, 1);
    assertEquals(r.anchorViolations[0].fragment, "task-checklist");
    assertEquals(r.anchorViolations[0].targetFile, "CONTRIBUTING.md");
  } finally {
    cleanup();
  }
});

Deno.test("[md-anchors] a link whose FILE does not resolve is reported once as a stale path, not double-reported as an anchor violation", async () => {
  const { root, cleanup } = await sandbox();
  try {
    await Deno.writeTextFile(join(root, "README.md"), "See [x](./missing.md#some-section).\n");
    const r = await checkMdPaths(root);
    assertEquals(r.anchorViolations.length, 0, JSON.stringify(r.anchorViolations));
    assert(r.violations.some((v) => v.reference === "./missing.md"));
  } finally {
    cleanup();
  }
});

Deno.test("[md-anchors] a #fragment into a non-markdown target is not validated as a heading anchor", async () => {
  const { root, cleanup } = await sandbox();
  try {
    await Deno.writeTextFile(join(root, "constants.ts"), "export const X = 1;\n");
    await Deno.writeTextFile(
      join(root, "README.md"),
      "See [x](./constants.ts#not-a-real-heading-anchor).\n",
    );
    const r = await checkMdPaths(root);
    assertEquals(r.anchorViolations.length, 0, JSON.stringify(r.anchorViolations));
  } finally {
    cleanup();
  }
});

Deno.test("[md-anchors] backticked and bare-prose #anchor mentions remain unvalidated (link syntax only)", async () => {
  const { root, cleanup } = await sandbox();
  try {
    await Deno.writeTextFile(join(root, "Reference.md"), "# ref\n");
    await Deno.writeTextFile(
      join(root, "README.md"),
      "See `Reference.md#nonexistent-section` and also Reference.md#other-nonexistent here.\n",
    );
    const r = await checkMdPaths(root);
    assertEquals(r.anchorViolations.length, 0, JSON.stringify(r.anchorViolations));
  } finally {
    cleanup();
  }
});
