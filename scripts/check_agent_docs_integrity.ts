#!/usr/bin/env -S deno run -A
/**
 * @module CheckAgentDocsIntegrity
 * @path scripts/check_agent_docs_integrity.ts
 * @description Validates referential integrity of the .copilot/ agent corpus:
 *   - dangling-readme-link: .copilot/docs/README.md references a non-existent file
 *   - dangling-docs-index-link: .copilot/DOCS.md references a non-existent file
 *   - dangling-manifest-path: manifest.json entry points to a deleted file
 *   - dangling-docs-symlink: a symlink in .copilot/docs/ points to a missing target
 *   - forbidden-folder: a retired zero-consumer folder (providers/, guidelines/)
 *     has reappeared under .copilot/
 *   - docs-readme-symlink-list: the "Symlinked root docs" section of docs/README.md
 *     names a file that is not actually a symlink there (GAP-133-2 drift class)
 *
 * Usage:
 *   deno run -A scripts/check_agent_docs_integrity.ts [.copilot/ path]
 *
 * This gate does NOT overlap with validate_doc_links.ts (markdown link validation over
 * the root docs) or validate_cross_reference.ts (cross-ref link resolution). It operates
 * at the corpus-index level — README index, manifest entries, symlinks, folder hygiene.
 */
import { join, resolve } from "@std/path";

export interface IIntegrityViolation {
  kind:
    | "dangling-readme-link"
    | "dangling-docs-index-link"
    | "dangling-manifest-path"
    | "dangling-docs-symlink"
    | "forbidden-folder"
    | "docs-readme-symlink-list";
  file: string;
  detail: string;
}

export interface IIntegrityResult {
  ok: boolean;
  violations: IIntegrityViolation[];
}

const MD_LINK_REGEX = /\[([^\]]+)\]\(([^)]+)\)/g;

function extractMdLinks(content: string): string[] {
  const links: string[] = [];
  let match: RegExpExecArray | null;
  const regex = new RegExp(MD_LINK_REGEX.source, "g");
  while ((match = regex.exec(content)) !== null) {
    const target = match[2].trim();
    if (target && !target.startsWith("http") && !target.startsWith("#")) {
      links.push(target);
    }
  }
  return links;
}

export function checkAgentDocsIntegrity(copilotDir: string): IIntegrityResult {
  const violations: IIntegrityViolation[] = [];
  const docsDir = join(copilotDir, "docs");
  const readmePath = join(docsDir, "README.md");
  const manifestPath = join(copilotDir, "manifest.json");

  // --- (a) dangling-readme-link ---
  try {
    const readmeContent = Deno.readTextFileSync(readmePath);
    const links = extractMdLinks(readmeContent);
    for (const link of links) {
      // Resolve relative to the docs/ directory
      const resolved = resolve(docsDir, link);
      if (!existsSync(resolved)) {
        violations.push({
          kind: "dangling-readme-link",
          file: readmePath,
          detail: `README.md links to "${link}" (resolved: ${resolved}) but file does not exist`,
        });
      }
    }
  } catch {
    violations.push({
      kind: "dangling-readme-link",
      file: readmePath,
      detail: "Cannot read README.md or docs/ directory",
    });
  }

  // --- (b) dangling-docs-index-link ---
  const indexPath = join(copilotDir, "DOCS.md");
  try {
    const indexContent = Deno.readTextFileSync(indexPath);
    const links = extractMdLinks(indexContent);
    for (const link of links) {
      const resolved = resolve(copilotDir, link);
      if (!existsSync(resolved)) {
        violations.push({
          kind: "dangling-docs-index-link",
          file: indexPath,
          detail: `DOCS.md links to "${link}" (resolved: ${resolved}) but file does not exist`,
        });
      }
    }
  } catch {
    // DOCS.md may not exist yet — non-fatal
  }

  // --- (c) dangling-manifest-path ---
  try {
    const manifestRaw = Deno.readTextFileSync(manifestPath);
    const manifest = JSON.parse(manifestRaw);
    if (manifest.docs && Array.isArray(manifest.docs)) {
      for (const entry of manifest.docs) {
        if (entry.path) {
          const resolved = resolve(copilotDir, "..", entry.path);
          if (!existsSync(resolved)) {
            violations.push({
              kind: "dangling-manifest-path",
              file: manifestPath,
              detail: `manifest.json entry "${entry.path}" resolves to ${resolved} but file does not exist`,
            });
          }
        }
      }
    }
  } catch {
    violations.push({
      kind: "dangling-manifest-path",
      file: manifestPath,
      detail: "Cannot read or parse manifest.json",
    });
  }

  // --- (d) dangling-docs-symlink ---
  try {
    for (const entry of Deno.readDirSync(docsDir)) {
      const entryPath = join(docsDir, entry.name);
      try {
        const stat = Deno.lstatSync(entryPath);
        if (stat.isSymlink) {
          const target = Deno.readLinkSync(entryPath);
          const resolvedTarget = resolve(docsDir, target);
          if (!existsSync(resolvedTarget)) {
            violations.push({
              kind: "dangling-docs-symlink",
              file: entryPath,
              detail: `Symlink "${entry.name}" -> "${target}" (resolved: ${resolvedTarget}) target does not exist`,
            });
          }
        }
      } catch {
        // stat failed — skip
      }
    }
  } catch {
    violations.push({
      kind: "dangling-docs-symlink",
      file: docsDir,
      detail: "Cannot list docs/ directory",
    });
  }

  // --- (e) forbidden-folder ---
  // Retired zero-consumer folders (phase-133) must not silently reappear: SP5's
  // "no providers//guidelines/ directory" guarantee, fail-closed.
  for (const folder of ["providers", "guidelines"]) {
    const folderPath = join(copilotDir, folder);
    try {
      const stat = Deno.lstatSync(folderPath);
      if (stat.isDirectory) {
        violations.push({
          kind: "forbidden-folder",
          file: folderPath,
          detail: `Retired zero-consumer folder "${folder}" exists under ${copilotDir} — remove it`,
        });
      }
    } catch {
      // folder absent — expected
    }
  }

  // (f) docs-readme-symlink-list: the "Symlinked root docs" section of docs/README.md
  // may only name files that are actually symlinks there, so a documented symlink that
  // does not exist fails closed.
  try {
    const readmeContent = Deno.readTextFileSync(readmePath);
    const section = readmeContent.match(/### Symlinked root docs[\s\S]*?(?=\n#{1,3}\s|$)/)?.[0] ?? "";
    const claimed = [...section.matchAll(/-\s*\[([^\]]+)\]\(([^)]+)\)/g)].map((m) => m[1]);
    const actualSymlinks = new Set<string>();
    for (const entry of Deno.readDirSync(docsDir)) {
      try {
        if (Deno.lstatSync(join(docsDir, entry.name)).isSymlink) actualSymlinks.add(entry.name);
      } catch {
        // stat failed — skip
      }
    }
    for (const name of claimed) {
      if (!actualSymlinks.has(name)) {
        violations.push({
          kind: "docs-readme-symlink-list",
          file: readmePath,
          detail: `README "Symlinked root docs" lists "${name}" but no such symlink exists in ${docsDir}`,
        });
      }
    }
  } catch {
    // README/docs absent — non-fatal (covered by (a))
  }

  return { ok: violations.length === 0, violations };
}

function existsSync(p: string): boolean {
  try {
    Deno.lstatSync(p);
    return true;
  } catch {
    return false;
  }
}

function main() {
  const copilotDir = resolve(Deno.args[0] ?? ".copilot");
  const result = checkAgentDocsIntegrity(copilotDir);

  if (result.violations.length > 0) {
    console.error("🔍 Agent docs integrity violations found:");
    for (const v of result.violations) {
      console.error(`  ❌ [${v.kind}] ${v.file}: ${v.detail}`);
    }
    Deno.exit(1);
  } else {
    console.log("✅ Agent docs integrity check passed — no violations.");
    Deno.exit(0);
  }
}

if (import.meta.main) {
  main();
}
