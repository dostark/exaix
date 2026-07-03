#!/usr/bin/env -S deno run -A
/**
 * @module ValidateAgentsDocs
 * @path scripts/validate_agents_docs.ts
 * @description Ensures all agent-related documentation adheres to project schemas and cross-reference rules.
 *
 * Usage:
 *   deno run -A scripts/validate_agents_docs.ts
 */

import { walk } from "@std/fs";
import { parse } from "@std/yaml";
import type { JSONObject } from "@exaix/core/types";

const AGENTS_DIR = ".copilot";
const REQUIRED_KEYS = ["agent", "scope", "title", "short_summary", "version"];

function extractFrontmatter(md: string): string | null {
  const match = md.match(/^---\n([\s\S]*?)\n---/);
  return match ? match[1] : null;
}

async function validateFile(path: string): Promise<string[]> {
  const errors: string[] = [];
  const content = await Deno.readTextFile(path);
  const fmRaw = extractFrontmatter(content);
  if (!fmRaw) {
    errors.push(`${path}: missing YAML frontmatter`);
    return errors;
  }
  let fm;
  try {
    fm = parse(fmRaw) as JSONObject;
  } catch (e) {
    errors.push(`${path}: frontmatter YAML parse error: ${e}`);
    return errors;
  }
  for (const k of REQUIRED_KEYS) {
    if (!path.startsWith(".copilot/prompts/") && !fm[k]) {
      errors.push(`${path}: missing required frontmatter key '${k}'`);
    }
  }

  // quick safety check for obvious secrets
  // Detect common secret patterns. Use stricter matches to avoid false positives (e.g., 'pass' as a word).
  const secretRegex = /\b(AKIA|AIza|api_key|password|token)\s*[:=]/i;
  if (secretRegex.test(content)) {
    errors.push(`${path}: potential secret/token found (CI will fail on secrets)`);
  }

  // presence of a canonical prompt or examples
  const isTemplate = path.startsWith(".copilot/prompts/") || path.includes("README.md") ||
    path.includes("manifest.json");

  if (!isTemplate) {
    if (!content.includes("Canonical prompt") && !content.includes("Canonical Prompt")) {
      errors.push(`${path}: missing 'Canonical prompt' section`);
    }
    if (!content.includes("Examples")) {
      errors.push(`${path}: missing 'Examples' section`);
    }
  }

  return errors;
}

async function main() {
  const errors: string[] = [];
  const SUBMODULE_DIR = "exaix-dev-docs";
  const scanDirs = [AGENTS_DIR];
  try {
    const stat = await Deno.stat(SUBMODULE_DIR);
    if (stat.isDirectory) scanDirs.push(SUBMODULE_DIR);
  } catch {
    // Submodule not present, skip
  }

  try {
    for (const dir of scanDirs) {
      for await (const entry of walk(dir, { exts: [".md"], maxDepth: 4 })) {
        if (entry.isFile) {
          if (
            entry.path.includes("/planning/") || entry.path.includes("/issues/") ||
            entry.path.includes("/not_actual/") || entry.path.includes("/dev/") ||
            entry.name === "MAINTENANCE.md" || entry.name === "TOOLS.md"
          ) {
            continue;
          }
          const fileErrors = await validateFile(entry.path);
          errors.push(...fileErrors);
        }
      }
    }
  } catch (e) {
    console.error("Error scanning directories:", e);
    Deno.exit(2);
  }

  if (errors.length) {
    console.error("Validation failed with the following issues:");
    for (const e of errors) console.error(` - ${e}`);
    Deno.exit(1);
  }

  console.log("All agent docs passed validation.");
}

if (import.meta.main) await main();

export { extractFrontmatter, validateFile };
