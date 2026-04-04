/**
 * @module ConfigParser
 * @path src/services/portal_knowledge/config_parser.ts
 * @description Strategy 2 of PortalKnowledgeService: reads and parses known
 * config files (package.json, deno.json, tsconfig.json, .gitignore) to extract
 * dependency information, tech stack details, and gitignore patterns.
 * Pure function module — zero LLM / network dependencies, sandboxed-safe.
 * @architectural-layer Services
 * * @related-files [src/services/portal_knowledge/directory_analyzer.ts, src/services/portal_knowledge/key_file_identifier.ts]
 */

import { join } from "@std/path";
import { LANG_JAVASCRIPT, LANG_TYPESCRIPT } from "../../shared/constants.ts";
import { DependencyCategory, SystemCommand } from "../../shared/enums.ts";
import type { IDependencyInfo } from "../../shared/schemas/portal_knowledge.ts";

// ---------------------------------------------------------------------------
// Specific JSON shape types for config file parsing
// ---------------------------------------------------------------------------

interface PackageJsonShape {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
}

interface DenoJsonShape {
  imports?: Record<string, string>;
  tasks?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Public return type
// ---------------------------------------------------------------------------

export interface IConfigParseResult {
  dependencies?: IDependencyInfo[];
  techStack?: {
    primaryLanguage?: string;
    framework?: string;
    testFramework?: string;
    buildTool?: string;
  };
  ignorePatterns?: string[];
}

// ---------------------------------------------------------------------------
// Heuristic lookup tables
// ---------------------------------------------------------------------------

const WEB_FRAMEWORKS: Record<string, string> = {
  express: "express",
  fastify: "fastify",
  hono: "hono",
  oak: "oak",
  koa: "koa",
  nest: "nestjs",
  "@nestjs/core": "nestjs",
  next: "nextjs",
  "next.js": "nextjs",
  nuxt: "nuxtjs",
  "@nuxtjs/core": "nuxtjs",
  sveltekit: "sveltekit",
  "@sveltejs/kit": "sveltekit",
  astro: "astro",
  remix: "remix",
  "@remix-run/node": "remix",
  django: "django",
  flask: "flask",
  fastapi: "fastapi",
  actix: "actix",
};

const TEST_FRAMEWORKS: Record<string, string> = {
  jest: "jest",
  "@jest/core": "jest",
  vitest: "vitest",
  mocha: "mocha",
  jasmine: "jasmine",
  "@angular/core": "ng-test",
  pytest: "pytest",
  "deno test": SystemCommand.DENO,
};

const BUILD_TOOLS: Record<string, string> = {
  vite: "vite",
  webpack: "webpack",
  rollup: "rollup",
  esbuild: "esbuild",
  parcel: "parcel",
  tsc: "tsc",
  turbo: "turborepo",
  turborepo: "turborepo",
  nx: "nx",
  bazel: "bazel",
  "deno compile": SystemCommand.DENO,
  gradle: "gradle",
  maven: "maven",
};

const DEP_PURPOSES: Record<string, string> = {
  // web frameworks
  express: DependencyCategory.WEB_FRAMEWORK,
  fastify: DependencyCategory.WEB_FRAMEWORK,
  hono: DependencyCategory.WEB_FRAMEWORK,
  oak: DependencyCategory.WEB_FRAMEWORK,
  koa: DependencyCategory.WEB_FRAMEWORK,
  "@nestjs/core": DependencyCategory.WEB_FRAMEWORK,
  next: DependencyCategory.FULLSTACK_FRAMEWORK,
  nuxt: DependencyCategory.FULLSTACK_FRAMEWORK,
  "@sveltejs/kit": DependencyCategory.FULLSTACK_FRAMEWORK,
  astro: DependencyCategory.FULLSTACK_FRAMEWORK,
  "@remix-run/node": DependencyCategory.FULLSTACK_FRAMEWORK,
  // validation / schema
  zod: DependencyCategory.SCHEMA_VALIDATION,
  joi: DependencyCategory.SCHEMA_VALIDATION,
  yup: DependencyCategory.SCHEMA_VALIDATION,
  valibot: DependencyCategory.SCHEMA_VALIDATION,
  // test
  jest: DependencyCategory.TEST_FRAMEWORK,
  vitest: DependencyCategory.TEST_FRAMEWORK,
  mocha: DependencyCategory.TEST_FRAMEWORK,
  jasmine: DependencyCategory.TEST_FRAMEWORK,
  // build
  vite: DependencyCategory.BUILD_TOOL,
  webpack: DependencyCategory.BUILD_TOOL,
  rollup: DependencyCategory.BUILD_TOOL,
  esbuild: DependencyCategory.BUILD_TOOL,
  parcel: DependencyCategory.BUILD_TOOL,
  // DB / ORM
  prisma: DependencyCategory.ORM,
  "@prisma/client": DependencyCategory.ORM,
  typeorm: DependencyCategory.ORM,
  drizzle: DependencyCategory.ORM,
  mongoose: DependencyCategory.ORM,
  // utility
  lodash: DependencyCategory.UTILITY,
  ramda: DependencyCategory.UTILITY,
  dayjs: DependencyCategory.UTILITY,
  "date-fns": DependencyCategory.UTILITY,
  axios: DependencyCategory.UTILITY,
  "node-fetch": DependencyCategory.UTILITY,
  got: DependencyCategory.UTILITY,
  // state management
  redux: DependencyCategory.STATE_MANAGEMENT,
  "@reduxjs/toolkit": DependencyCategory.STATE_MANAGEMENT,
  zustand: DependencyCategory.STATE_MANAGEMENT,
  // DI
  inversify: DependencyCategory.UTILITY,
  tsyringe: DependencyCategory.UTILITY,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parsePurpose(name: string): string | undefined {
  // Strip scope prefix for lookup
  const bare = name.startsWith("@") ? name : name.split("/")[0];
  return DEP_PURPOSES[name] ?? DEP_PURPOSES[bare];
}

function detectFramework(allDeps: Record<string, string>): string | undefined {
  for (const key of Object.keys(allDeps)) {
    if (WEB_FRAMEWORKS[key]) return WEB_FRAMEWORKS[key];
  }
  return undefined;
}

function detectTestFramework(
  allDeps: Record<string, string>,
  scripts: Record<string, string>,
): string | undefined {
  for (const key of Object.keys(allDeps)) {
    if (TEST_FRAMEWORKS[key]) return TEST_FRAMEWORKS[key];
  }
  // Check scripts for "deno test"
  for (const cmd of Object.values(scripts)) {
    if (cmd.includes("deno test")) return SystemCommand.DENO;
  }
  return undefined;
}

function detectBuildTool(
  allDeps: Record<string, string>,
  scripts: Record<string, string>,
  tasks: Record<string, string>,
): string | undefined {
  for (const key of Object.keys(allDeps)) {
    if (BUILD_TOOLS[key]) return BUILD_TOOLS[key];
  }
  const allCommands = [...Object.values(scripts), ...Object.values(tasks)].join(" ");
  for (const [keyword, tool] of Object.entries(BUILD_TOOLS)) {
    if (allCommands.includes(keyword)) return tool;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Per-file parsers
// ---------------------------------------------------------------------------

async function parsePackageJson(
  portalPath: string,
  result: IConfigParseResult,
): Promise<void> {
  let raw: string;
  try {
    raw = await Deno.readTextFile(join(portalPath, "package.json"));
  } catch {
    return;
  }

  let pkg: PackageJsonShape;
  try {
    pkg = JSON.parse(raw) as PackageJsonShape;
  } catch {
    // Malformed JSON — skip silently
    return;
  }

  const deps = (pkg.dependencies ?? {}) as Record<string, string>;
  const devDeps = (pkg.devDependencies ?? {}) as Record<string, string>;
  const scripts = (pkg.scripts ?? {}) as Record<string, string>;
  const allDeps = { ...deps, ...devDeps };

  const keyDependencies = Object.entries(allDeps).map(([name, version]) => ({
    name,
    version: String(version),
    purpose: parsePurpose(name),
  }));

  const entry: IDependencyInfo = {
    packageManager: "npm",
    configFile: "package.json",
    keyDependencies,
  };

  result.dependencies = [...(result.dependencies ?? []), entry];

  const framework = detectFramework(allDeps);
  const testFramework = detectTestFramework(allDeps, scripts);
  const buildTool = detectBuildTool(allDeps, scripts, {});

  result.techStack = result.techStack ?? {};
  if (framework) result.techStack.framework = framework;
  if (testFramework) result.techStack.testFramework = testFramework;
  if (buildTool) result.techStack.buildTool = buildTool;
  if (!result.techStack.primaryLanguage) result.techStack.primaryLanguage = LANG_JAVASCRIPT;
}

async function parseDenoJson(
  portalPath: string,
  filename: string,
  result: IConfigParseResult,
): Promise<void> {
  let raw: string;
  try {
    raw = await Deno.readTextFile(join(portalPath, filename));
  } catch {
    return;
  }

  let cfg: DenoJsonShape;
  try {
    cfg = JSON.parse(raw) as DenoJsonShape;
  } catch {
    return;
  }

  const imports = (cfg.imports ?? {}) as Record<string, string>;
  const tasks = (cfg.tasks ?? {}) as Record<string, string>;

  // Filter to meaningful external deps (skip @std/ builtins for key deps listing)
  const keyDependencies = Object.entries(imports)
    .filter(([, specifier]) => !specifier.startsWith("jsr:@std/"))
    .map(([name, version]) => ({
      name: name.replace(/^@/, "").split("/")[1] ?? name,
      version: String(version),
      purpose: parsePurpose(name),
    }));

  // Also include all imports as deps for detection
  const allDepsForDetection: Record<string, string> = {};
  for (const [name] of Object.entries(imports)) {
    const bare = name.replace(/^@/, "").split("/")[0];
    allDepsForDetection[bare] = name;
  }

  const entry: IDependencyInfo = {
    packageManager: SystemCommand.DENO,
    configFile: filename,
    keyDependencies,
  };

  result.dependencies = [...(result.dependencies ?? []), entry];

  const framework = detectFramework(allDepsForDetection);
  const testFramework = detectTestFramework(allDepsForDetection, tasks);
  const buildTool = detectBuildTool(allDepsForDetection, {}, tasks);

  result.techStack = result.techStack ?? {};
  if (framework) result.techStack.framework = framework;
  if (testFramework) result.techStack.testFramework = testFramework;
  if (buildTool) result.techStack.buildTool = buildTool;
  result.techStack.primaryLanguage = LANG_TYPESCRIPT;
}

async function parseTsConfig(
  portalPath: string,
  filename: string,
  result: IConfigParseResult,
): Promise<void> {
  let raw: string;
  try {
    raw = await Deno.readTextFile(join(portalPath, filename));
  } catch {
    return;
  }

  try {
    JSON.parse(raw); // validate parseable — ignore content for now
  } catch {
    return;
  }

  // Record that a tsconfig was present
  const entry: IDependencyInfo = {
    packageManager: "other",
    configFile: filename,
    keyDependencies: [],
  };

  result.dependencies = [...(result.dependencies ?? []), entry];
  result.techStack = result.techStack ?? {};
  if (!result.techStack.primaryLanguage) result.techStack.primaryLanguage = LANG_TYPESCRIPT;
}

async function parseGitignore(
  portalPath: string,
  result: IConfigParseResult,
): Promise<void> {
  let raw: string;
  try {
    raw = await Deno.readTextFile(join(portalPath, ".gitignore"));
  } catch {
    return;
  }

  const patterns = raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));

  result.ignorePatterns = [...(result.ignorePatterns ?? []), ...patterns];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse recognised config files in the portal root to extract dependency
 * information, tech-stack identifiers, and gitignore patterns.
 *
 * @param portalPath - Absolute path to the portal root directory.
 * @param fileList   - List of relative file paths discovered by DirectoryAnalyzer.
 * @returns          Partial portal knowledge: dependencies, techStack, ignorePatterns.
 */
export async function parseConfigFiles(
  portalPath: string,
  fileList: string[],
): Promise<IConfigParseResult> {
  const result: IConfigParseResult = {};

  const fileSet = new Set(fileList);

  if (fileSet.has("package.json")) {
    await parsePackageJson(portalPath, result);
  }

  for (const name of ["deno.json", "deno.jsonc"]) {
    if (fileSet.has(name)) {
      await parseDenoJson(portalPath, name, result);
    }
  }

  for (const name of ["tsconfig.json", "jsconfig.json"]) {
    if (fileSet.has(name)) {
      await parseTsConfig(portalPath, name, result);
    }
  }

  if (fileSet.has(".gitignore")) {
    await parseGitignore(portalPath, result);
  }

  return result;
}
