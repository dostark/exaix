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
  "deno test": "deno",
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
  "deno compile": "deno",
  gradle: "gradle",
  maven: "maven",
};

const DEP_PURPOSES: Record<string, string> = {
  // web frameworks
  express: "web framework",
  fastify: "web framework",
  hono: "web framework",
  oak: "web framework",
  koa: "web framework",
  "@nestjs/core": "web framework",
  next: "fullstack framework",
  nuxt: "fullstack framework",
  "@sveltejs/kit": "fullstack framework",
  astro: "static site / fullstack framework",
  "@remix-run/node": "fullstack framework",
  // validation / schema
  zod: "schema validation",
  joi: "schema validation",
  yup: "schema validation",
  valibot: "schema validation",
  // test
  jest: "test framework",
  vitest: "test framework",
  mocha: "test framework",
  jasmine: "test framework",
  // build
  vite: "build tool",
  webpack: "build tool",
  rollup: "build tool",
  esbuild: "build tool",
  parcel: "build tool",
  // DB / ORM
  prisma: "ORM",
  "@prisma/client": "ORM",
  typeorm: "ORM",
  drizzle: "ORM",
  mongoose: "ODM / MongoDB",
  // utility
  lodash: "utility library",
  ramda: "functional utility",
  dayjs: "date utility",
  "date-fns": "date utility",
  axios: "HTTP client",
  "node-fetch": "HTTP client",
  got: "HTTP client",
  // state management
  redux: "state management",
  "@reduxjs/toolkit": "state management",
  zustand: "state management",
  // DI
  inversify: "dependency injection",
  tsyringe: "dependency injection",
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
    if (cmd.includes("deno test")) return "deno";
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
  if (!result.techStack.primaryLanguage) result.techStack.primaryLanguage = "javascript";
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
    packageManager: "deno",
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
  result.techStack.primaryLanguage = "typescript";
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
  if (!result.techStack.primaryLanguage) result.techStack.primaryLanguage = "typescript";
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
