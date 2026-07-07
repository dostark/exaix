#!/usr/bin/env -S deno run -A
/**
 * @module InjectAgentContext
 * @path scripts/inject_agent_context.ts
 * @description RAG utility to inject relevant document chunks and agent instructions into a prompt context.
 *
 * Usage:
 *   deno run --allow-read scripts/inject_agent_context.ts --query <text> --agent <type>
 */

import { walk } from "@std/fs";
import { parse } from "@std/yaml";
import type { JSONObject } from "@exaix/core/types";

const AGENTS_DIR = ".copilot";

function extractFrontmatter(md: string): string | null {
  const match = md.match(/^---\n([\s\S]*?)\n---/);
  return match ? match[1] : null;
}

function scoreField(text: string, query: string, exactMatchWeight: number, tokenWeight: number): number {
  if (!text) return 0;

  const normalizedText = text.toLowerCase();
  const normalizedQuery = query.toLowerCase();
  let score = 0;

  if (normalizedText.includes(normalizedQuery)) score += exactMatchWeight;

  const tokens = normalizedQuery.split(/\s+/).filter(Boolean);
  for (const token of tokens) {
    if (normalizedText.includes(token)) score += tokenWeight;
  }

  return score;
}

function getMatchedTokenCount(text: string, query: string): number {
  if (!text) return 0;

  const normalizedText = text.toLowerCase();
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  let count = 0;

  for (const token of tokens) {
    if (normalizedText.includes(token)) count += 1;
  }

  return count;
}

function extractHeadings(md: string): string {
  return Array.from(md.matchAll(/^#{1,6}\s+(.+)$/gm)).map((match) => match[1]).join("\n");
}

function scoreDoc(path: string, md: string, fm: JSONObject, query: string) {
  const q = query.toLowerCase();
  let score = 0;
  const headings = extractHeadings(md);
  const focusText = [
    path,
    String(fm.title || ""),
    String(fm.short_summary || ""),
    String(fm.description || ""),
    Array.isArray(fm.topics) ? fm.topics.join(" ") : "",
    headings,
  ].join("\n");
  const matchedFocusTokens = getMatchedTokenCount(focusText, q);

  score += scoreField(String(fm.title || ""), q, 20, 4);
  score += scoreField(String(fm.short_summary || ""), q, 18, 3);
  score += scoreField(String(fm.description || ""), q, 12, 2);
  score += scoreField(Array.isArray(fm.topics) ? fm.topics.join(" ") : "", q, 8, 2);
  score += scoreField(path, q, 15, 3);
  score += scoreField(headings, q, 24, 5);
  score += matchedFocusTokens * matchedFocusTokens * 6;
  score += scoreField(md, q, 10, 1);

  return score;
}

async function findBest(agent: string, query: string) {
  let best: { path?: string; fm?: JSONObject; score: number; md?: string } = { score: 0 };

  // Check if .copilot directory exists
  try {
    await Deno.stat(AGENTS_DIR);
  } catch {
    // Directory doesn't exist, return empty result
    return best;
  }

  for await (const entry of walk(AGENTS_DIR, { exts: [".md"], maxDepth: 3 })) {
    if (!entry.isFile) continue;
    const md = await Deno.readTextFile(entry.path);
    const fmRaw = extractFrontmatter(md) || "";
    const fm = fmRaw ? (parse(fmRaw) as JSONObject) : {};
    // A document is eligible when either frontmatter field matches the requested agent.
    const docAgents = [fm.agent, fm.identity].filter((value): value is string => typeof value === "string");
    if (!docAgents.includes(agent)) continue;
    const s = scoreDoc(entry.path, md, fm, query);
    if (s > best.score) best = { path: entry.path, fm, score: s, md };
  }
  return best;
}

export async function inject(
  agent: string,
  query: string,
  _maxChunks = 2,
): Promise<{ found: boolean; path?: string; title?: string; short_summary?: string; snippet?: string }> {
  const best = await findBest(agent, query);
  if (!best.path) return { found: false };
  const mdBody = best.md!.replace(/^---[\s\S]*?---/, "");
  const paragraphs = mdBody.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  // Prefer a paragraph that mentions 'rag' or 'inject' or is reasonably long.
  let paragraph = "";
  for (const p of paragraphs) {
    const low = p.toLowerCase();
    if (low.includes("rag") || low.includes("inject")) {
      paragraph = p;
      break;
    }
  }
  if (!paragraph) {
    paragraph = paragraphs.find((p) => p.length > 40 && !/^key points$/i.test(p)) || paragraphs[0] || "";
  }
  return {
    found: true,
    path: best.path,
    title: String(best.fm!.title || ""),
    short_summary: String(best.fm!.short_summary || ""),
    snippet: paragraph,
  };
}
async function main() {
  const args = new Map<string, string>();
  for (let i = 0; i < Deno.args.length; i++) {
    if (Deno.args[i].startsWith("--")) {
      const key = Deno.args[i].slice(2);
      const val = Deno.args[i + 1] || "";
      args.set(key, val);
      i++;
    }
  }
  const query = args.get("query") || "";
  const agent = args.get("agent") || "copilot";
  if (!query) {
    console.error("Usage: --query <text> --agent <agent>");
    Deno.exit(2);
  }

  const best = await findBest(agent, query);
  if (!best.path) {
    console.log(JSON.stringify({ found: false }));
    Deno.exit(0);
  }

  const mdBody = best.md!.replace(/^---[\s\S]*?---/, "");
  const paragraph = mdBody.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)[0] || "";
  console.log(
    JSON.stringify({
      found: true,
      path: best.path,
      title: String(best.fm!.title || ""),
      short_summary: String(best.fm!.short_summary || ""),
      snippet: paragraph,
    }),
  );
}

if (import.meta.main) await main();
