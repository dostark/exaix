#!/usr/bin/env -S deno run -A
/**
 * @module BuildAgentsIndex
 * @path scripts/build_agents_index.ts
 * @description Build manifest.json and cross-reference.md for developer-agent tooling.
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

export async function updateCrossReference(docs: JSONObject[]) {
  const crossRefPath = ".copilot/cross-reference.md";
  const crossRefMd = await Deno.readTextFile(crossRefPath);

  // Build task quick reference
  let taskTable = "| Task Type | Primary Doc | Secondary Docs |\n| --- | --- | --- |\n";
  for (const doc of docs) {
    if (!doc.title || doc.path === ".copilot/cross-reference.md") continue;
    const rawPath = String(doc.path);
    const relPath = rawPath.startsWith(".copilot/")
      ? rawPath.replace(".copilot/", "")
      : rawPath.startsWith("exaix-dev-docs/")
      ? `../${rawPath}`
      : rawPath.startsWith("./")
      ? `../${rawPath.slice(2)}`
      : `../${rawPath}`;
    const title = String(doc.title);
    taskTable += `| ${title} | [${relPath}](${relPath}) | |\n`;
  }

  // Build topic search
  const topicMap: Record<string, string[]> = {};
  for (const doc of docs) {
    if (!doc.topics || !Array.isArray(doc.topics) || doc.path === ".copilot/cross-reference.md") continue;
    const rawPath = String(doc.path);
    const relPath = rawPath.startsWith(".copilot/")
      ? rawPath.replace(".copilot/", "")
      : rawPath.startsWith("exaix-dev-docs/")
      ? `../${rawPath}`
      : rawPath.startsWith("./")
      ? `../${rawPath.slice(2)}`
      : `../${rawPath}`;
    for (const topic of doc.topics) {
      if (!topicMap[String(topic)]) topicMap[String(topic)] = [];
      topicMap[String(topic)].push(`[${relPath}](${relPath})`);
    }
  }

  let topicList = "";
  for (const topic of Object.keys(topicMap).sort()) {
    topicList += `- **\`${topic}\`** → ${topicMap[topic].join(", ")}\n`;
  }

  const updatedMd = crossRefMd
    .replace(
      /## Task → Agent Doc Quick Reference\n\n[\s\S]*?(?=\n## Search by Topic)/,
      `## Task → Agent Doc Quick Reference\n\n${taskTable}`,
    )
    .replace(
      /## Search by Topic\n\n[\s\S]*?(?=\n> See|\n## |$)/,
      `## Search by Topic\n\n${topicList}`,
    );

  await Deno.writeTextFile(crossRefPath, updatedMd);
  console.log(`Updated cross-reference.md`);
}

export async function generateQwenSkills(docs: JSONObject[]) {
  for (const doc of docs) {
    // Only generate wrappers if qwen_skill frontmatter exists
    const qwenSkill = doc["qwen_skill"];
    if (qwenSkill) {
      const skillName = String(qwenSkill);
      const skillDir = `.qwen/skills/${skillName}`;
      await Deno.mkdir(skillDir, { recursive: true });
      const relPath = `../../../` + String(doc.path);
      const wrapperContent = `---
name: ${skillName}
description: Automatically generated routing wrapper for ${skillName} skill.
---

# ⚠️ AUTOMATIC ROUTING WRAPPER

> **CRITICAL**: This is an auto-generated routing skill.
> The true canonical source for this skill is located at:
> \`${String(doc.path)}\`

## INSTRUCTIONS FOR QWEN:

1. **DO NOT** execute based on this file.
2. **MUST** read the canonical source file before proceeding.
3. Use the \`view_file\` tool to read \`${relPath}\`
4. Follow the strict instructions and constraints defined in the canonical source.
5. If the canonical source instructs you to read additional files or blueprints, you MUST read those as well.
`;
      await Deno.writeTextFile(`${skillDir}/SKILL.md`, wrapperContent);
      console.log(`Generated Qwen skill wrapper for ${skillName}`);
    }
  }
}

export async function buildIndex(includeSubmodule = false) {
  const manifest = await generateManifestObject(includeSubmodule);
  await Deno.writeTextFile(OUT_MANIFEST, JSON.stringify(manifest, null, 2));
  console.log(`Wrote manifest to ${OUT_MANIFEST}`);

  await updateCrossReference(manifest.docs);
  await generateQwenSkills(manifest.docs);
}

if (import.meta.main) {
  const includeSubmodule = Deno.args.includes("--include-submodule");
  await buildIndex(includeSubmodule);
}

export { extractFrontmatter };
