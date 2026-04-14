#!/usr/bin/env -S deno run -A
/**
 * @module ValidateArchitecture
 * @path scripts/validate_architecture.ts
 * @description Verifies architectural boundary compliance and documentation grounding.
 *
 * Usage:
 *   deno run -A scripts/validate_architecture.ts
 */

import { join, relative, resolve } from "@std/path";
import { walk } from "@std/fs";

const ROOT = Deno.cwd();
const SRC_DIR = join(ROOT, "src");
const TESTS_DIR = join(ROOT, "tests");
const ARCH_DOC = join(ROOT, "ARCHITECTURE.md");

interface ModuleInfo {
  path?: string;
  moduleName?: string;
  description?: string;
  layer?: string;
  dependencies: string[];
  relatedFiles: string[];
  dependenciesProvided: boolean;
  relatedFilesProvided: boolean;
  isGrounded: boolean;
}

async function validate() {
  console.log("🔍 Validating Architecture Grounding & Headers...");

  const moduleMap = new Map<string, ModuleInfo>();
  const groundedFiles = new Set<string>();

  const srcFiles = new Set<string>();
  const testFiles = new Set<string>();

  // 1. Gather all .ts files in src/
  for await (const entry of walk(SRC_DIR, { includeDirs: false })) {
    if (!entry.path.endsWith(".ts")) continue;
    const relPath = relative(ROOT, entry.path);
    if (relPath.endsWith(".test.ts") || relPath.endsWith("_test.ts")) {
      testFiles.add(relPath);
    } else {
      srcFiles.add(relPath);
    }
  }

  // 1.1 Gather all .ts files in tests/
  if (await Deno.stat(TESTS_DIR).then((s) => s.isDirectory).catch(() => false)) {
    for await (const entry of walk(TESTS_DIR, { includeDirs: false })) {
      if (!entry.path.endsWith(".ts")) continue;
      const relPath = relative(ROOT, entry.path);
      testFiles.add(relPath);
    }
  }

  const allModules = new Set([...srcFiles, ...testFiles]);

  // 2. Parse ARCHITECTURE.md for explicit grounding
  const archContent = await Deno.readTextFile(ARCH_DOC);
  const explicitPathRegex = /src\/[a-zA-Z0-9_\-\/]+\.ts/g;
  let match;
  while ((match = explicitPathRegex.exec(archContent)) !== null) {
    const foundPath = match[0];
    if (srcFiles.has(foundPath)) {
      groundedFiles.add(foundPath);
    }
  }

  // Also check for directory-level grounding like src/cli/*.ts or src/*.ts
  const explicitDirRegex = /src\/([a-zA-Z0-9_\-\/]+\/)?\*\.ts/g;
  while ((match = explicitDirRegex.exec(archContent)) !== null) {
    const dirPath = match[0].replace("/*.ts", "");
    for (const file of srcFiles) {
      if (file.startsWith(dirPath)) {
        groundedFiles.add(file);
      }
    }
  }

  console.log(`📍 Explicitly grounded in ARCHITECTURE.md: ${groundedFiles.size} files`);

  // 3. Parse headers and build dependency graph
  let headerFailures = 0;
  for (const relPath of allModules) {
    const fullPath = join(ROOT, relPath);
    const content = await Deno.readTextFile(fullPath);

    const info = parseHeader(relPath, content);
    const missingFields = [];
    const isTest = testFiles.has(relPath);

    if (!info.moduleName) missingFields.push("@module");
    if (!info.path) {
      missingFields.push("@path");
    } else {
      // Normalize both paths for comparison
      const normalizedHeaderPath = info.path.replace(/^\/+/, "").replace(/\/+$/, "");
      const normalizedRelPath = relPath.replace(/^\/+/, "").replace(/\/+$/, "");
      if (normalizedHeaderPath !== normalizedRelPath) {
        console.error(`❌ Path mismatch in ${relPath}: header says '${info.path}', but actual path is '${relPath}'`);
        headerFailures++;
      }
    }
    if (!info.description) missingFields.push("@description");

    if (!isTest) {
      if (!info.layer) missingFields.push("@architectural-layer");
      // @dependencies is now automated from imports
      if (!info.relatedFilesProvided) missingFields.push("@related-files");
    }

    if (missingFields.length > 0) {
      console.error(`❌ Invalid header in ${relPath}. Missing fields: ${missingFields.join(", ")}`);
      headerFailures++;
    }
    moduleMap.set(relPath, info);
  }

  // 4. Perform reachability analysis (Transitive Grounding)
  const moduleNameToPath = new Map<string, string>();
  for (const [path, info] of moduleMap.entries()) {
    if (info.moduleName) {
      moduleNameToPath.set(info.moduleName, path);
    }
  }

  const queue = Array.from(groundedFiles);
  const fullyGrounded = new Set<string>(groundedFiles);

  while (queue.length > 0) {
    const current = queue.shift()!;
    const info = moduleMap.get(current);
    if (!info) continue;

    const links = [...info.dependencies, ...info.relatedFiles];
    for (const link of links) {
      // Try to resolve the link. It could be a project path, a module name, or a relative import path.
      let resolvedPath = srcFiles.has(link) ? link : moduleNameToPath.get(link);

      // If not resolved yet, it might be a relative import path from the current file
      if (!resolvedPath && (link.startsWith(".") || link.startsWith("@/"))) {
        let absolutePath: string;
        if (link.startsWith("@/")) {
          absolutePath = join(ROOT, link.substring(2));
        } else {
          const currentDir = join(ROOT, current, "..");
          absolutePath = resolve(currentDir, link);
        }

        // Try with various extensions
        const candidates = [
          absolutePath,
          absolutePath + ".ts",
          absolutePath + ".tsx",
          join(absolutePath, "mod.ts"),
          join(absolutePath, "index.ts"),
        ];
        for (const candidate of candidates) {
          const relCandidate = relative(ROOT, candidate);
          if (srcFiles.has(relCandidate) || testFiles.has(relCandidate)) {
            resolvedPath = relCandidate;
            break;
          }
        }
      }

      if (
        resolvedPath && (srcFiles.has(resolvedPath) || testFiles.has(resolvedPath)) && !fullyGrounded.has(resolvedPath)
      ) {
        fullyGrounded.add(resolvedPath);
        queue.push(resolvedPath);
      }
    }
  }

  // 5. Report results
  const ungrounded = Array.from(srcFiles).filter((f) => !fullyGrounded.has(f));

  console.log("\n--- Validation Summary ---");
  console.log(`Total Source Files: ${srcFiles.size}`);
  console.log(`Total Test Files:   ${testFiles.size}`);
  console.log(`Header Validation:  ${allModules.size - headerFailures} PASS, ${headerFailures} FAIL`);
  console.log(`Grounding Status:   ${fullyGrounded.size} GROUNDED, ${ungrounded.length} UNGROUNDED`);

  if (ungrounded.length > 0) {
    console.log("\n❌ Ungrounded Modules (Dead Documentation Zones):");
    ungrounded.sort().forEach((f) => console.log(`  - ${f}`));
  }

  if (headerFailures > 0 || ungrounded.length > 0) {
    Deno.exit(1);
  } else {
    console.log("\n✅ Architecture is fully grounded and valid!");
  }
}

function parseHeader(_filePath: string, content: string): ModuleInfo {
  const info: ModuleInfo = {
    dependencies: [],
    relatedFiles: [],
    dependenciesProvided: false,
    relatedFilesProvided: false,
    isGrounded: false,
  };

  // 1. Parse standard header fields
  const headerMatch = content.match(/\/\*\*([\s\S]*?)\*\//);
  if (headerMatch) {
    const header = headerMatch[1];

    const moduleMatch = header.match(/@module\s+([^\n]+)/);
    const pathMatch = header.match(/@path\s+([^\n]+)/);
    const architecturalLayer = header.match(/@architectural-layer\s+([^\n]+)/);
    const description = header.match(/@description\s+([^\n]+)/);

    if (moduleMatch) info.moduleName = moduleMatch[1].trim();
    if (pathMatch) info.path = pathMatch[1].trim();
    if (architecturalLayer) info.layer = architecturalLayer[1].trim();
    if (description) info.description = description[1].trim();

    // Parse array @related-files
    const relatedMatch = header.match(/@related-files\s+\[(.*?)\]/);
    if (relatedMatch) {
      info.relatedFilesProvided = true;
      info.relatedFiles = relatedMatch[1].split(",").map((s) => s.trim().replace(/^['"]|['"]$/g, "")).filter((s) => s);
    }

    // Manual @dependencies (deprecated but still supported)
    const depsMatch = header.match(/@dependencies\s+\[(.*?)\]/);
    if (depsMatch) {
      info.dependenciesProvided = true;
      const deps = depsMatch[1].split(",").map((s) => s.trim().replace(/^['"]|['"]$/g, "")).filter((s) => s);
      info.dependencies.push(...deps);
    }
  }

  // 2. Automatically extract dependencies from imports
  const importRegex = /import\s+.*?\s+from\s+["']([^"']+)["']/g;
  let match;
  while ((match = importRegex.exec(content)) !== null) {
    const importPath = match[1];
    // Only care about relative imports, alias imports, or src subpaths
    if (importPath.startsWith(".") || importPath.startsWith("@/") || importPath.startsWith("src/")) {
      info.dependencies.push(importPath);
    }
  }

  return info;
}

if (import.meta.main) {
  validate();
}
