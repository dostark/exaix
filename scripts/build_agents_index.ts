#!/usr/bin/env -S deno run -A
/**
 * @module BuildAgentsIndex
 * @path scripts/build_agents_index.ts
 * @description Build manifest.json for developer-agent tooling.
 *
 * Usage:
 *   deno run -A scripts/build_agents_index.ts
 *   deno run -A scripts/build_agents_index.ts -- --include-submodule
 */

import { walk } from "@std/fs";
import { parse } from "@std/yaml";
import type { JSONObject } from "@exaix/core/types";

const AGENTS_DIR = ".copilot";
const SUBMODULE_DIR = "exaix-dev-docs";
const OUT_MANIFEST = `${AGENTS_DIR}/manifest.json`;

function extractFrontmatter(md: string): string | null {
  const match = md.match(/^---\n([\s\S]*?)\n---/);
  return match ? match[1] : null;
}

export async function generateManifestObject(includeSubmodule = false) {
  const docs = [] as JSONObject[];

  const scanDirs = [AGENTS_DIR];
  if (includeSubmodule) {
    try {
      const stat = await Deno.stat(SUBMODULE_DIR);
      if (stat.isDirectory) scanDirs.push(SUBMODULE_DIR);
    } catch {
      // Submodule not present, skip
    }
  }

  for (const dir of scanDirs) {
    for await (const entry of walk(dir, { exts: [".md"], maxDepth: 4 })) {
      if (!entry.isFile) continue;
      const md = await Deno.readTextFile(entry.path);
      const fmRaw = extractFrontmatter(md);
      if (!fmRaw) continue;
      const fm = parse(fmRaw) as JSONObject;

      docs.push({
        path: entry.path,
        agent: fm["agent"],
        scope: fm["scope"],
        title: fm["title"],
        short_summary: String(fm["short_summary"] ?? ""),
        version: fm["version"],
        topics: fm["topics"],
        qwen_skill: fm["qwen_skill"],
      });
    }
  }

  // Include root-level markdown files that are marked as copilot knowledge base.
  // maxDepth: 1 limits the walk to the root directory only (no subdirectory recursion).
  for await (const entry of walk(".", { exts: [".md"], maxDepth: 1 })) {
    if (!entry.isFile) continue;
    const md = await Deno.readTextFile(entry.path);
    const fmRaw = extractFrontmatter(md);
    if (!fmRaw) continue;
    const fm = parse(fmRaw) as JSONObject;
    if (!fm["copilot_knowledge_base"]) continue;

    docs.push({
      path: entry.path,
      agent: fm["agent"],
      scope: fm["scope"],
      title: fm["title"],
      short_summary: String(fm["short_summary"] ?? fm["description"] ?? ""),
      version: fm["version"],
      topics: fm["topics"],
      qwen_skill: fm["qwen_skill"],
    });
  }

  // No `generated_at` timestamp: it made the committed manifest churn on every
  // run (a nondeterministic 1-line diff) with no consumer using the value.
  // The manifest is now deterministic — it changes only when `docs` change.
  return { docs };
}

export async function generateDocsIndex(docs: JSONObject[]) {
  const indexPath = `.copilot/DOCS.md`;
  function toRelPath(raw: string): string {
    if (raw.startsWith(".copilot/")) return raw.replace(".copilot/", "");
    if (!raw.startsWith(".") && !raw.startsWith("/")) return `../${raw}`;
    return raw;
  }
  let taskTable = "| Task Type | Primary Doc |\n| --- | --- |\n";
  for (const doc of docs) {
    if (!doc.title) continue;
    const relPath = toRelPath(String(doc.path));
    taskTable += `| ${doc.title} | [${relPath}](${relPath}) |\n`;
  }

  const topicMap: Record<string, string[]> = {};
  for (const doc of docs) {
    if (!doc.topics || !Array.isArray(doc.topics)) continue;
    const relPath = toRelPath(String(doc.path));
    for (const topic of doc.topics) {
      if (!topicMap[String(topic)]) topicMap[String(topic)] = [];
      topicMap[String(topic)].push(`[${relPath}](${relPath})`);
    }
  }
  let topicList = "";
  for (const topic of Object.keys(topicMap).sort()) {
    topicList += `- **\`${topic}\`** → ${topicMap[topic].join(", ")}\n`;
  }

  const content = `---
agent: general
scope: dev
title: Doc Catalog
short_summary: "Complete index of agent docs by task and topic."
version: "1.0"
topics: ["reference", "docs", "catalog"]
---

## Task → Doc

${taskTable}
## Search by Topic

${topicList}
`;
  await Deno.writeTextFile(indexPath, content);
  console.log(`Wrote ${indexPath}`);
}

export async function buildIndex(includeSubmodule = false) {
  const manifest = await generateManifestObject(includeSubmodule);
  await Deno.writeTextFile(OUT_MANIFEST, JSON.stringify(manifest, null, 2) + "\n");
  console.log(`Wrote manifest to ${OUT_MANIFEST}`);

  await generateDocsIndex(manifest.docs);

  // Normalize the generated markdown/JSON to exactly what `deno fmt` produces,
  // so the formatter never reports these generated files dirty (the generator
  // and `deno fmt` would otherwise disagree on table alignment / trailing
  // newline and drift forever). Non-fatal if `deno fmt` is unavailable.
  await formatGenerated([`${AGENTS_DIR}/DOCS.md`, OUT_MANIFEST]);
}

/** Runs `deno fmt` over the given generated files; ignores failures. */
async function formatGenerated(paths: string[]): Promise<void> {
  try {
    await new Deno.Command("deno", { args: ["fmt", ...paths], stdout: "null", stderr: "null" })
      .output();
  } catch {
    // deno fmt not available in this environment — generated files stay as-written.
  }
}

if (import.meta.main) {
  const includeSubmodule = Deno.args.includes("--include-submodule");
  await buildIndex(includeSubmodule);
}

export { extractFrontmatter };
