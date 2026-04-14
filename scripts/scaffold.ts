#!/usr/bin/env -S deno run -A
/**
 * @module Scaffold
 * @path scripts/scaffold.ts
 * @description Workspace initializer that creates the required directory structure and copies templates.
 *
 * Usage:
 *   deno run -A scripts/scaffold.ts [target_dir]
 */

import { ensureDir } from "@std/fs";
import { dirname, fromFileUrl, join, resolve } from "@std/path";

async function main() {
  const target = resolve(Deno.args[0] || Deno.cwd());
  const repoRoot = resolve(join(dirname(fromFileUrl(import.meta.url)), ".."));

  console.log(`Scaffolding runtime workspace at: ${target}`);

  const dirs = [
    ".exa",
    "Blueprints/Identities",
    "Blueprints/Flows",
    "Workspace/Requests",
    "Workspace/Plans",
    "Memory",
    "Memory/Projects",
    "Memory/Execution",
    "Memory/Index",
    "Memory/Reports",
    "Portals",
    "scripts",
  ];

  for (const dir of dirs) {
    const fullPath = join(target, dir);
    await ensureDir(fullPath);
    // Create .gitkeep
    try {
      await Deno.writeTextFile(join(fullPath, ".gitkeep"), "");
    } catch {
      // Ignore if exists or read-only
    }
  }

  // Copy templates
  const templates = [
    { src: "templates/exa.config.sample.toml", dest: "exa.config.sample.toml" },
    { src: "templates/README.md", dest: "README.md" },
  ];

  for (const t of templates) {
    const srcPath = join(repoRoot, t.src);
    const destPath = join(target, t.dest);

    try {
      if (await Deno.stat(srcPath).then((s) => s.isFile).catch(() => false)) {
        if (!(await Deno.stat(destPath).catch(() => null))) {
          await Deno.copyFile(srcPath, destPath);
          console.log(`Copied ${t.dest}`);
        }
      }
    } catch (err) {
      console.warn(`Warning: Could not copy ${t.dest}: ${err}`);
    }
  }

  console.log("\nScaffold complete. You can now run in the target workspace:");
  console.log("  deno task cache");
  console.log("  deno task setup");
}

if (import.meta.main) {
  await main();
}
