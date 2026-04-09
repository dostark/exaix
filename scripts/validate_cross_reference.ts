/**
 * @module validate_cross_reference
 * @path scripts/validate_cross_reference.ts
 * @description Specifically validates .copilot/cross-reference.md relative links.
 */

import { existsSync } from "@std/fs";
import { join, resolve } from "@std/path";

const TARGET_FILE = ".copilot/cross-reference.md";

async function main() {
  const cwd = Deno.cwd();
  const filePath = join(cwd, TARGET_FILE);

  if (!existsSync(filePath)) {
    console.error(`❌ ${TARGET_FILE} not found!`);
    Deno.exit(1);
  }

  const content = await Deno.readTextFile(filePath);
  const links = content.matchAll(/\[.*?\]\((.*?)\)/g);

  let errors = 0;
  const baseDir = join(cwd, ".copilot");

  for (const match of links) {
    const link = match[1];
    if (link.startsWith("http")) continue; // Skip external

    // Remove anchor
    const [pathOnly, anchor] = link.split("#");

    if (!pathOnly) continue; // Just an anchor like (#Section)

    const fullPath = resolve(baseDir, pathOnly);

    if (!existsSync(fullPath)) {
      console.error(`❌ [${TARGET_FILE}]: Broken link -> ${link} (Target not found: ${fullPath})`);
      errors++;
    } else if (anchor) {
      // Optional: check anchor existence
      const targetContent = await Deno.readTextFile(fullPath);
      // Search for # Anchor or <a name="anchor"> or {#anchor}
      const anchorRegex = new RegExp(`^#+ .*?{#${anchor}}$|^#+ .*?${anchor}$|<a name="${anchor}">`, "mi");
      if (!anchorRegex.test(targetContent)) {
        // Soft warning for anchor (some might be implicit Markdown anchors)
        // For now, let's just log it.
        // console.log(`⚠️ [${TARGET_FILE}]: Anchor not found -> ${link}`);
      }
    }
  }

  if (errors > 0) {
    console.error(`\nFound ${errors} broken links in ${TARGET_FILE}`);
    Deno.exit(1);
  } else {
    console.log(`✅ ${TARGET_FILE} links verified!`);
  }
}

if (import.meta.main) {
  main();
}
