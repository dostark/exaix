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
const TESTS_DIR = join(ROOT, "tests");
const PACKAGES_DIR = join(ROOT, "packages");
const SCRIPTS_DIR = join(ROOT, "scripts");
const APPS_DIR = join(ROOT, "apps");
const COPILOT_DIR = join(ROOT, ".copilot");
const TEAM_PACKAGES_DIR = join(ROOT, "packages-team");
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
  ungrounded?: boolean;
}

async function validate() {
  console.log("🔍 Validating Architecture Grounding & Headers...");

  const moduleMap = new Map<string, ModuleInfo>();
  const groundedFiles = new Set<string>();

  const srcFiles = new Set<string>();
  const testFiles = new Set<string>();
  const packageFiles = new Set<string>();

  // 1. Gather all .ts files in packages/, apps/, and packages-team/ (no top-level src/ anymore)
  for (const dir of [PACKAGES_DIR, APPS_DIR, TEAM_PACKAGES_DIR]) {
    if (await Deno.stat(dir).then((s) => s.isDirectory).catch(() => false)) {
      for await (const entry of walk(dir, { includeDirs: false })) {
        if (!entry.path.endsWith(".ts")) continue;
        const relPath = relative(ROOT, entry.path);
        if (relPath.endsWith(".test.ts") || relPath.endsWith("_test.ts")) {
          testFiles.add(relPath);
        } else {
          srcFiles.add(relPath);
        }
      }
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

  // 1.2 Gather all .ts files in packages/ and packages-team/
  for (const pkgDir of [PACKAGES_DIR, TEAM_PACKAGES_DIR]) {
    if (await Deno.stat(pkgDir).then((s) => s.isDirectory).catch(() => false)) {
      for await (const entry of walk(pkgDir, { includeDirs: false })) {
        if (!entry.path.endsWith(".ts")) continue;
        packageFiles.add(relative(ROOT, entry.path));
      }
    }
  }

  // 1.3 Gather all .ts files in scripts/
  if (await Deno.stat(SCRIPTS_DIR).then((s) => s.isDirectory).catch(() => false)) {
    for await (const entry of walk(SCRIPTS_DIR, { includeDirs: false })) {
      if (!entry.path.endsWith(".ts")) continue;
      packageFiles.add(relative(ROOT, entry.path));
    }
  }

  // 1.3b Gather all .ts files in apps/
  if (await Deno.stat(APPS_DIR).then((s) => s.isDirectory).catch(() => false)) {
    for await (const entry of walk(APPS_DIR, { includeDirs: false })) {
      if (!entry.path.endsWith(".ts")) continue;
      packageFiles.add(relative(ROOT, entry.path));
    }
  }

  // 1.4 Gather .md files in .copilot/
  if (await Deno.stat(COPILOT_DIR).then((s) => s.isDirectory).catch(() => false)) {
    for await (const entry of walk(COPILOT_DIR, { includeDirs: false })) {
      if (!entry.path.endsWith(".md")) continue;
      packageFiles.add(relative(ROOT, entry.path));
    }
  }

  const allModules = new Set([...srcFiles, ...testFiles]);
  const allKnownFiles = new Set([...srcFiles, ...testFiles, ...packageFiles]);

  // 2. Parse ARCHITECTURE.md for explicit grounding
  const archContent = await Deno.readTextFile(ARCH_DOC);
  // Match packages/<name>/src/..., packages/<name>/mod.ts, apps/<name>/src/..., apps/<name>/main.ts
  const explicitPathRegex =
    /(?:packages\/[a-zA-Z0-9_\-]+(?:\/src\/[a-zA-Z0-9_\/\-]+\.ts|\/mod\.ts)|apps\/[a-zA-Z0-9_\-]+(?:\/src\/[a-zA-Z0-9_\/\-]+\.ts|\/main\.ts))/g;
  let match;
  while ((match = explicitPathRegex.exec(archContent)) !== null) {
    const foundPath = match[0];
    if (srcFiles.has(foundPath)) {
      groundedFiles.add(foundPath);
    }
  }

  // Also check for directory-level grounding like packages/core/src/config/*.ts
  const explicitDirRegex =
    /(?:packages\/[a-zA-Z0-9_\-]+(?:\/src|)\/|apps\/[a-zA-Z0-9_\-]+\/src\/)[a-zA-Z0-9_\/\-]+\/\*\.ts/g;
  while ((match = explicitDirRegex.exec(archContent)) !== null) {
    const dirPath = match[0].replace("/*.ts", "");
    for (const file of srcFiles) {
      if (file.startsWith(dirPath)) {
        groundedFiles.add(file);
      }
    }
  }

  // Also match legacy src/ patterns for backward compatibility (retired paths)
  const legacyPathRegex = /src\/[a-zA-Z0-9_\-\/]+\.ts/g;
  while ((match = legacyPathRegex.exec(archContent)) !== null) {
    const foundPath = match[0];
    if (srcFiles.has(foundPath)) {
      groundedFiles.add(foundPath);
    }
  }

  console.log(`📍 Explicitly grounded in ARCHITECTURE.md: ${groundedFiles.size} files`);

  // 2.1 Also parse package and app READMEs for grounding
  // Build a map of @exaix/<name> -> packages/<name>/mod.ts for package references
  const exaixPackageMap = new Map<string, string>();
  for (const file of srcFiles) {
    const match = file.match(/^packages\/([a-zA-Z0-9_\-]+)\/mod\.ts$/);
    if (match) {
      exaixPackageMap.set(`@exaix/${match[1]}`, file);
    }
  }
  for (const dir of [PACKAGES_DIR, APPS_DIR]) {
    if (await Deno.stat(dir).then((s) => s.isDirectory).catch(() => false)) {
      for await (const entry of walk(dir, { includeDirs: false })) {
        if (entry.name.toLowerCase() !== "readme.md") continue;
        try {
          const readmeContent = await Deno.readTextFile(entry.path);
          // Match explicit source file paths (e.g. packages/request/src/processor.ts)
          const readmePathRegex =
            /(?:packages\/[a-zA-Z0-9_\-]+(?:\/src\/[a-zA-Z0-9_\/\-]+\.ts|\/mod\.ts)|apps\/[a-zA-Z0-9_\-]+(?:\/src\/[a-zA-Z0-9_\/\-]+\.ts|\/main\.ts))/g;
          let rmMatch;
          while ((rmMatch = readmePathRegex.exec(readmeContent)) !== null) {
            const foundPath = rmMatch[0];
            if (srcFiles.has(foundPath)) {
              groundedFiles.add(foundPath);
            }
          }
          // Match @exaix/<name> package references (e.g. @exaix/execution)
          const exaixRefRegex = /@exaix\/[a-zA-Z0-9_\-]+/g;
          while ((rmMatch = exaixRefRegex.exec(readmeContent)) !== null) {
            const found = exaixPackageMap.get(rmMatch[0]);
            if (found) groundedFiles.add(found);
          }
          // Match directory-level references like ../../packages/flow/
          const readmeDirLinkRegex = /packages\/[a-zA-Z0-9_\-]+\//g;
          while ((rmMatch = readmeDirLinkRegex.exec(readmeContent)) !== null) {
            const dirPath = rmMatch[0]; // e.g. "packages/execution/"
            const modPath = dirPath + "mod.ts";
            if (srcFiles.has(modPath)) {
              groundedFiles.add(modPath);
            }
          }
          // Also match directory-level patterns like packages/core/src/*.ts
          const readmeGlobRegex =
            /(?:packages\/[a-zA-Z0-9_\-]+(?:\/src|)\/|apps\/[a-zA-Z0-9_\-]+\/src\/)[a-zA-Z0-9_\/\-]+\/\*\.ts/g;
          while ((rmMatch = readmeGlobRegex.exec(readmeContent)) !== null) {
            const dirPath = rmMatch[0].replace("/*.ts", "");
            for (const file of srcFiles) {
              if (file.startsWith(dirPath)) {
                groundedFiles.add(file);
              }
            }
          }
        } catch {
          // skip unreadable files
        }
      }
    }
  }
  console.log(`📍 Explicitly grounded in READMEs: ${groundedFiles.size} files total (including ARCHITECTURE.md)`);

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

  // 4. Perform related-files reference validation and reachability analysis
  const moduleNameToPath = new Map<string, string>();
  for (const [path, info] of moduleMap.entries()) {
    if (info.moduleName) {
      moduleNameToPath.set(info.moduleName, path);
    }
  }

  for (const [relPath, info] of moduleMap.entries()) {
    for (const related of info.relatedFiles) {
      if (!(await resolveReference(related, relPath, moduleNameToPath, allKnownFiles))) {
        console.error(
          `❌ Invalid related-files reference in ${relPath}: '${related}' does not resolve to a known file or module.`,
        );
        headerFailures++;
      }
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

  // 4b. Files belonging to a grounded package or app are grounded (mod.ts/main.ts is the discoverable entry point).
  const groundedPackagePrefixes = new Set<string>();
  for (const f of fullyGrounded) {
    const pkgMatch = f.match(/^(packages\/[a-zA-Z0-9_\-]+)\//);
    if (pkgMatch) groundedPackagePrefixes.add(pkgMatch[1]);
    const appMatch = f.match(/^(apps\/[a-zA-Z0-9_\-]+)\//);
    if (appMatch) groundedPackagePrefixes.add(appMatch[1]);
  }
  for (const f of srcFiles) {
    if (!fullyGrounded.has(f)) {
      for (const prefix of groundedPackagePrefixes) {
        if (f.startsWith(prefix)) {
          fullyGrounded.add(f);
          break;
        }
      }
    }
  }

  // 4b. Verify ARCHITECTURE.md contains no implementation-specific file paths
  let archPathErrors = 0;
  try {
    const archContent = await Deno.readTextFile(ARCH_DOC);
    const archLines = archContent.split("\n");
    // Flags any line (prose or bullet) that contains file paths under packages/
    // or packages-team/ with /src/ — ARCHITECTURE.md must reference packages by
    // name only. YAML frontmatter (between --- markers) is metadata, not content.
    const implPathPattern = /(?:packages|packages-team)\/[^\s"')`]+src\//;
    let inFrontmatter = false;
    for (let i = 0; i < archLines.length; i++) {
      const line = archLines[i];
      if (line.trim() === "---") {
        inFrontmatter = !inFrontmatter;
        continue;
      }
      if (inFrontmatter) continue;
      if (implPathPattern.test(line)) {
        console.error(
          `❌ ARCHITECTURE.md:${i + 1} — implementation file path detected. ` +
            `ARCHITECTURE.md is a strategic document — reference packages by name, not file paths. ` +
            `Move path details to the relevant package README.`,
        );
        archPathErrors++;
      }
    }
  } catch {
    console.error("❌ Could not read ARCHITECTURE.md");
    archPathErrors++;
  }

  // 5. Report results
  const ungroundedCandidates = Array.from(srcFiles).filter((f) => !fullyGrounded.has(f));
  const exempted = ungroundedCandidates.filter((f) => moduleMap.get(f)?.ungrounded || f.includes("/tests/"));
  const ungrounded = ungroundedCandidates.filter((f) => !(moduleMap.get(f)?.ungrounded || f.includes("/tests/")));

  console.log("\n--- Validation Summary ---");
  console.log(`Total Source Files:  ${srcFiles.size}`);
  console.log(`Total Test Files:    ${testFiles.size}`);
  console.log(`Header Validation:   ${allModules.size - headerFailures} PASS, ${headerFailures} FAIL`);
  console.log(`Grounding Status:    ${fullyGrounded.size} GROUNDED, ${ungrounded.length} UNGROUNDED`);
  if (exempted.length > 0) {
    console.log(`Exempted (@ungrounded): ${exempted.length} files`);
  }

  if (ungrounded.length > 0) {
    console.log("\n❌ Ungrounded Modules (Dead Documentation Zones):");
    ungrounded.sort().forEach((f) => console.log(`  - ${f}`));
  }

  if (exempted.length > 0) {
    console.log("\n⚪ Exempted (tagged @ungrounded):");
    exempted.sort().forEach((f) => console.log(`  - ${f}`));
  }

  if (headerFailures > 0 || ungrounded.length > 0 || archPathErrors > 0) {
    Deno.exit(1);
  } else {
    console.log("\n✅ Architecture is fully grounded and valid!");
  }
  if (ungrounded.length > 0) {
    console.log("\n⚠️  Some modules are not reachable from documented roots, but have valid headers (self-grounded).");
    console.log(
      "   Tag with @ungrounded to silence or add README/ARCHITECTURE.md references to improve discoverability.",
    );
    Deno.exit(0);
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

    const ungrounded = header.match(/@ungrounded\b/);
    if (ungrounded) info.ungrounded = true;

    // Parse array @related-files
    const relatedMatch = header.match(/@related-files\s+\[([\s\S]*?)\]/);
    if (relatedMatch) {
      info.relatedFilesProvided = true;
      info.relatedFiles = relatedMatch[1]
        .split(/\s*(?:,|\n)\s*/)
        .map((s) => s.trim().replace(/^[*\s]*|[*\s]*$/g, "").replace(/^['"]|['"]$/g, ""))
        .filter((s) => s);
    }

    // Manual @dependencies (deprecated but still supported)
    const depsMatch = header.match(/@dependencies\s+\[(.*?)\]/);
    if (depsMatch) {
      info.dependenciesProvided = true;
      const deps = depsMatch[1].split(",").map((s) => s.trim().replace(/^['"]|['"]$/g, "")).filter((s) => s);
      info.dependencies.push(...deps);
    }
  }

  // 2. Automatically extract dependencies from imports and re-exports
  const importRegex = /(?:import|export)\s+.*?\s+from\s+["']([^"']+)["']/g;
  let match;
  while ((match = importRegex.exec(content)) !== null) {
    const importPath = match[1];
    // src/ kept for backward compatibility with retired paths
    if (
      importPath.startsWith(".") || importPath.startsWith("@/") || importPath.startsWith("src/") ||
      importPath.startsWith("packages/") || importPath.startsWith("apps/")
    ) {
      info.dependencies.push(importPath);
    }
  }

  return info;
}

async function resolveReference(
  link: string,
  currentPath: string,
  moduleNameToPath: Map<string, string>,
  allKnownFiles: Set<string>,
): Promise<string | undefined> {
  if (allKnownFiles.has(link)) {
    return link;
  }

  const moduleResolved = moduleNameToPath.get(link);
  if (moduleResolved) {
    return moduleResolved;
  }

  if (link === "@exaix/core") {
    return allKnownFiles.has("packages/core/mod.ts") ? "packages/core/mod.ts" : undefined;
  }

  if (link.startsWith("@exaix/core/")) {
    const absolutePath = join(ROOT, "packages/core/src", link.substring("@exaix/core/".length));
    return await resolveFileOrPattern(absolutePath);
  }

  if (link === "@exaix/schemas") {
    return allKnownFiles.has("packages/schemas/mod.ts") ? "packages/schemas/mod.ts" : undefined;
  }

  if (link.startsWith("@exaix/schemas/")) {
    const absolutePath = join(ROOT, "packages/schemas/src", link.substring("@exaix/schemas/".length));
    return await resolveFileOrPattern(absolutePath);
  }

  if (link === "@exaix/parsing") {
    return allKnownFiles.has("packages/parsing/mod.ts") ? "packages/parsing/mod.ts" : undefined;
  }

  if (link.startsWith("@exaix/parsing/")) {
    const absolutePath = join(ROOT, "packages/parsing/src", link.substring("@exaix/parsing/".length));
    return await resolveFileOrPattern(absolutePath);
  }

  if (link === "@exaix/ai") {
    return allKnownFiles.has("packages/ai/mod.ts") ? "packages/ai/mod.ts" : undefined;
  }

  if (link.startsWith("@exaix/ai/")) {
    const absolutePath = join(ROOT, "packages/ai/src", link.substring("@exaix/ai/".length));
    return await resolveFileOrPattern(absolutePath);
  }

  if (link === "@exaix/cli") {
    return allKnownFiles.has("packages/cli/mod.ts") ? "packages/cli/mod.ts" : undefined;
  }

  if (link.startsWith("@exaix/cli/")) {
    const absolutePath = join(ROOT, "packages/cli/src", link.substring("@exaix/cli/".length));
    return await resolveFileOrPattern(absolutePath);
  }

  if (link === "@exaix/mcp") {
    return allKnownFiles.has("packages/mcp/mod.ts") ? "packages/mcp/mod.ts" : undefined;
  }

  if (link.startsWith("@exaix/mcp/")) {
    const absolutePath = join(ROOT, "packages/mcp/src", link.substring("@exaix/mcp/".length));
    return await resolveFileOrPattern(absolutePath);
  }

  if (link === "@exaix/git") {
    return allKnownFiles.has("packages/git/mod.ts") ? "packages/git/mod.ts" : undefined;
  }

  if (link.startsWith("@exaix/git/")) {
    const absolutePath = join(ROOT, "packages/git/src", link.substring("@exaix/git/".length));
    return await resolveFileOrPattern(absolutePath);
  }

  if (link === "@exaix/tui") {
    return allKnownFiles.has("packages/tui/mod.ts") ? "packages/tui/mod.ts" : undefined;
  }

  if (link.startsWith("@exaix/tui/")) {
    const absolutePath = join(ROOT, "packages/tui/src", link.substring("@exaix/tui/".length));
    return await resolveFileOrPattern(absolutePath);
  }

  if (link === "@exaix/testing") {
    return allKnownFiles.has("packages/testing/mod.ts") ? "packages/testing/mod.ts" : undefined;
  }

  if (link.startsWith("@exaix/testing/")) {
    const absolutePath = join(ROOT, "packages/testing/src", link.substring("@exaix/testing/".length));
    return await resolveFileOrPattern(absolutePath);
  }

  if (link.startsWith("@/")) {
    const absolutePath = join(ROOT, link.substring(2));
    return await resolveFileOrPattern(absolutePath);
  }

  if (link.startsWith(".copilot/")) {
    const docsRoot = join(ROOT, "exaix-dev-docs");
    if (await exists(docsRoot)) {
      const candidate = join(docsRoot, link.replace(/^\.copilot\//, ""));
      if (await exists(candidate)) {
        return relative(ROOT, candidate);
      }
    }
  }

  // src/ kept for backward compatibility with retired paths
  if (
    link.startsWith("src/") || link.startsWith("tests/") || link.startsWith("packages/") || link.startsWith("apps/")
  ) {
    const normalized = link.replace(/^\/+/, "");
    if (allKnownFiles.has(normalized)) {
      return normalized;
    }
    const absolutePath = join(ROOT, normalized);
    return await resolveFileOrPattern(absolutePath);
  }

  if (link.startsWith(".") || link.startsWith("..")) {
    const currentDir = join(ROOT, currentPath, "..");
    const absolutePath = resolve(currentDir, link);
    return await resolveFileOrPattern(absolutePath);
  }

  return undefined;
}

async function resolveFileOrPattern(
  absolutePath: string,
): Promise<string | undefined> {
  if (absolutePath.endsWith("/*.ts")) {
    const dir = absolutePath.slice(0, -5);
    if (await isDirectory(dir)) {
      const firstMatch = await findTypeScriptFile(dir);
      if (firstMatch) {
        return relative(ROOT, firstMatch);
      }
    }
    return undefined;
  }

  if (absolutePath.endsWith("/")) {
    if (await isDirectory(absolutePath)) {
      return relative(ROOT, absolutePath).replace(/\/+$|\\+$/, "");
    }
  }

  const candidates = [
    absolutePath,
    `${absolutePath}.ts`,
    `${absolutePath}.tsx`,
    join(absolutePath, "mod.ts"),
    join(absolutePath, "index.ts"),
  ];

  for (const candidate of candidates) {
    if (await exists(candidate)) {
      return relative(ROOT, candidate);
    }
  }

  return undefined;
}

async function exists(path: string): Promise<boolean> {
  try {
    const stat = await Deno.stat(path);
    return stat.isFile || stat.isDirectory;
  } catch {
    return false;
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    const stat = await Deno.stat(path);
    return stat.isDirectory;
  } catch {
    return false;
  }
}

async function findTypeScriptFile(dir: string): Promise<string | undefined> {
  for await (const entry of walk(dir, { includeDirs: false })) {
    if (entry.path.endsWith(".ts")) {
      return entry.path;
    }
  }
  return undefined;
}

if (import.meta.main) {
  validate();
}
