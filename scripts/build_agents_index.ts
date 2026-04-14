#!/usr/bin/env -S deno run -A
/**
 * @module BuildAgentsIndex
 * @path scripts/build_agents_index.ts
 * @description Build a simple manifest.json and pre-chunk files for fast retrieval.
 *
 * Usage:
 *   deno run -A scripts/build_agents_index.ts
 */

import { walk } from "@std/fs";
import { parse } from "@std/yaml";
import type { JSONObject } from "../src/shared/types/json.ts";

const AGENTS_DIR = ".copilot";
const OUT_MANIFEST = `${AGENTS_DIR}/manifest.json`;
const CHUNKS_DIR = `${AGENTS_DIR}/chunks`;

function extractFrontmatter(md: string): string | null {
  const match = md.match(/^---\n([\s\S]*?)\n---/);
  return match ? match[1] : null;
}

function chunkText(text: string, size = 800): string[] {
  // naive chunking by whole paragraphs
  const paragraphs = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = "";
  for (const p of paragraphs) {
    if ((current + "\n\n" + p).length > size) {
      if (current) chunks.push(current);
      current = p;
    } else {
      current = current ? `${current}\n\n${p}` : p;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

export async function generateManifestObject() {
  const docs = [] as JSONObject[];
  await Deno.mkdir(CHUNKS_DIR, { recursive: true });
  for await (const entry of walk(AGENTS_DIR, { exts: [".md"], maxDepth: 3 })) {
    if (!entry.isFile) continue;
    const md = await Deno.readTextFile(entry.path);
    const fmRaw = extractFrontmatter(md);
    if (!fmRaw) continue;
    const fm = parse(fmRaw) as JSONObject;
    const short_summary = String(fm["short_summary"] ?? "");
    const chunks = chunkText(md.replace(/^---[\s\S]*?---/, ""));
    const chunkPaths: string[] = [];
    chunks.slice(0, 8).forEach((c, idx) => {
      const p = `${CHUNKS_DIR}/${entry.name}.chunk${idx}.txt`;
      Deno.writeTextFileSync(p, c);
      chunkPaths.push(p);
    });

    docs.push({
      path: entry.path,
      agent: fm["agent"],
      scope: fm["scope"],
      title: fm["title"],
      short_summary,
      version: fm["version"],
      topics: fm["topics"],
      chunks: chunkPaths,
    });
  }

  return { generated_at: new Date().toISOString(), docs };
}

export async function buildIndex() {
  const manifest = await generateManifestObject();
  await Deno.writeTextFile(OUT_MANIFEST, JSON.stringify(manifest, null, 2));
  console.log(`Wrote manifest to ${OUT_MANIFEST}`);
}

if (import.meta.main) await buildIndex();

export { chunkText, extractFrontmatter };
