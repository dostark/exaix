/**
 * @module PortalKnowledgeSchemaTest
 * @path tests/schemas/portal_knowledge_test.ts
 * @description Tests for the IPortalKnowledge Zod schema and inferred types,
 * ensuring robust validation of portal codebase knowledge output.
 */

import { assertEquals } from "@std/assert";
import {
  ArchitectureLayerSchema,
  CodeConventionSchema,
  DependencyInfoSchema,
  FileSignificanceSchema,
  MonorepoPackageSchema,
  PortalKnowledgeSchema,
  SymbolEntrySchema,
} from "@exaix/schemas/portal_knowledge.ts";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const validFileSignificance = {
  path: "src/main.ts",
  role: "entrypoint" as const,
  description: "Application entry point",
  lineCount: 42,
};

const validArchitectureLayer = {
  name: "services",
  paths: ["src/services/"],
  responsibility: "Core business logic",
  keyFiles: ["src/services/request.ts"],
};

const validCodeConvention = {
  name: "Service naming",
  description: "Service files end with _service.ts suffix",
  examples: ["src/services/request_service.ts", "src/services/plan_service.ts"],
  category: "naming" as const,
  evidenceCount: 12,
  confidence: "high" as const,
};

const validDependencyInfo = {
  packageManager: "deno" as const,
  configFile: "deno.json",
  keyDependencies: [
    { name: "zod", version: "^3.22.4", purpose: "schema validation" },
  ],
};

const validSymbolEntry = {
  name: "RequestService",
  kind: "class" as const,
  file: "src/services/request.ts",
  signature: "export class RequestService",
  doc: "Core request management service",
  pageRankScore: 0.85,
};

const validMonorepoPackage = {
  name: "api",
  path: "packages/api",
  primaryLanguage: "typescript",
  framework: "hono",
  layers: [validArchitectureLayer],
  conventions: [validCodeConvention],
};

const validPortalKnowledge = {
  portal: "my-project",
  gatheredAt: new Date().toISOString(),
  version: 1,
  architectureOverview: "# Architecture\n\nA layered TypeScript application.",
  layers: [validArchitectureLayer],
  keyFiles: [validFileSignificance],
  conventions: [validCodeConvention],
  dependencies: [validDependencyInfo],
  symbolMap: [validSymbolEntry],
  techStack: {
    primaryLanguage: "typescript",
    framework: "hono",
    testFramework: "deno test",
    buildTool: "deno",
  },
  stats: {
    totalFiles: 120,
    totalDirectories: 15,
    totalLinesOfCode: 8000,
    extensionDistribution: { ".ts": 100, ".md": 20 },
  },
  metadata: {
    durationMs: 3200,
    mode: "standard" as const,
    filesScanned: 120,
    filesRead: 20,
  },
};

// ---------------------------------------------------------------------------
// FileSignificanceSchema
// ---------------------------------------------------------------------------

Deno.test("[FileSignificanceSchema] validates all role enum values", () => {
  const roles = [
    "entrypoint",
    "config",
    "schema",
    "test-helper",
    "core-service",
    "routing",
    "types",
    "migration",
    "build",
  ] as const;
  for (const role of roles) {
    const result = FileSignificanceSchema.safeParse({ ...validFileSignificance, role });
    assertEquals(result.success, true, `role "${role}" should be valid`);
  }
});

Deno.test("[FileSignificanceSchema] rejects unknown role", () => {
  const result = FileSignificanceSchema.safeParse({ ...validFileSignificance, role: "unknown-role" });
  assertEquals(result.success, false);
});

Deno.test("[FileSignificanceSchema] lineCount is optional", () => {
  const { lineCount: _lc, ...withoutLineCount } = validFileSignificance;
  const result = FileSignificanceSchema.safeParse(withoutLineCount);
  assertEquals(result.success, true);
});

// ---------------------------------------------------------------------------
// ArchitectureLayerSchema
// ---------------------------------------------------------------------------

Deno.test("[ArchitectureLayerSchema] validates complete layer", () => {
  const result = ArchitectureLayerSchema.safeParse(validArchitectureLayer);
  assertEquals(result.success, true);
});

Deno.test("[ArchitectureLayerSchema] rejects missing name", () => {
  const { name: _n, ...withoutName } = validArchitectureLayer;
  const result = ArchitectureLayerSchema.safeParse(withoutName);
  assertEquals(result.success, false);
});

// ---------------------------------------------------------------------------
// CodeConventionSchema
// ---------------------------------------------------------------------------

Deno.test("[CodeConventionSchema] validates all category enum values", () => {
  const categories = [
    "naming",
    "structure",
    "testing",
    "imports",
    "error-handling",
    "typing",
    "other",
  ] as const;
  for (const category of categories) {
    const result = CodeConventionSchema.safeParse({ ...validCodeConvention, category });
    assertEquals(result.success, true, `category "${category}" should be valid`);
  }
});

Deno.test("[CodeConventionSchema] validates confidence enum values", () => {
  const levels = ["low", "medium", "high"] as const;
  for (const confidence of levels) {
    const result = CodeConventionSchema.safeParse({ ...validCodeConvention, confidence });
    assertEquals(result.success, true, `confidence "${confidence}" should be valid`);
  }
});

Deno.test("[CodeConventionSchema] rejects invalid category", () => {
  const result = CodeConventionSchema.safeParse({ ...validCodeConvention, category: "bad-category" });
  assertEquals(result.success, false);
});

Deno.test("[CodeConventionSchema] rejects non-positive evidenceCount", () => {
  const result = CodeConventionSchema.safeParse({ ...validCodeConvention, evidenceCount: 0 });
  assertEquals(result.success, false);
});

Deno.test("[CodeConventionSchema] rejects negative evidenceCount", () => {
  const result = CodeConventionSchema.safeParse({ ...validCodeConvention, evidenceCount: -1 });
  assertEquals(result.success, false);
});

// ---------------------------------------------------------------------------
// DependencyInfoSchema
// ---------------------------------------------------------------------------

Deno.test("[DependencyInfoSchema] validates packageManager enum values", () => {
  const managers = ["npm", "deno", "pip", "cargo", "go", "maven", "other"] as const;
  for (const packageManager of managers) {
    const result = DependencyInfoSchema.safeParse({ ...validDependencyInfo, packageManager });
    assertEquals(result.success, true, `packageManager "${packageManager}" should be valid`);
  }
});

Deno.test("[DependencyInfoSchema] rejects unknown packageManager", () => {
  const result = DependencyInfoSchema.safeParse({ ...validDependencyInfo, packageManager: "yarn" });
  assertEquals(result.success, false);
});

Deno.test("[DependencyInfoSchema] keyDependency version and purpose are optional", () => {
  const result = DependencyInfoSchema.safeParse({
    ...validDependencyInfo,
    keyDependencies: [{ name: "zod" }],
  });
  assertEquals(result.success, true);
});

// ---------------------------------------------------------------------------
// SymbolEntrySchema
// ---------------------------------------------------------------------------

Deno.test("[SymbolEntrySchema] validates all kind enum values", () => {
  const kinds = ["function", "class", "interface", "const", "type", "enum"] as const;
  for (const kind of kinds) {
    const result = SymbolEntrySchema.safeParse({ ...validSymbolEntry, kind });
    assertEquals(result.success, true, `kind "${kind}" should be valid`);
  }
});

Deno.test("[SymbolEntrySchema] doc and pageRankScore are optional", () => {
  const { doc: _d, pageRankScore: _p, ...minimal } = validSymbolEntry;
  const result = SymbolEntrySchema.safeParse(minimal);
  assertEquals(result.success, true);
});

// ---------------------------------------------------------------------------
// MonorepoPackageSchema
// ---------------------------------------------------------------------------

Deno.test("[MonorepoPackageSchema] validates complete package", () => {
  const result = MonorepoPackageSchema.safeParse(validMonorepoPackage);
  assertEquals(result.success, true);
});

Deno.test("[MonorepoPackageSchema] framework is optional", () => {
  const { framework: _f, ...withoutFramework } = validMonorepoPackage;
  const result = MonorepoPackageSchema.safeParse(withoutFramework);
  assertEquals(result.success, true);
});

// ---------------------------------------------------------------------------
// PortalKnowledgeSchema — valid complete object
// ---------------------------------------------------------------------------

Deno.test("[PortalKnowledgeSchema] validates complete valid knowledge object", () => {
  const result = PortalKnowledgeSchema.safeParse(validPortalKnowledge);
  assertEquals(result.success, true);
});

Deno.test("[PortalKnowledgeSchema] accepts optional headCommitSha and fullAnalysis", () => {
  const result = PortalKnowledgeSchema.safeParse({
    ...validPortalKnowledge,
    headCommitSha: "0123456789abcdef0123456789abcdef01234567",
    fullAnalysis: true,
  });
  assertEquals(result.success, true);
});

Deno.test("[PortalKnowledgeSchema] rejects missing required fields", () => {
  const { portal: _p, ...withoutPortal } = validPortalKnowledge;
  const result = PortalKnowledgeSchema.safeParse(withoutPortal);
  assertEquals(result.success, false);
});

Deno.test("[PortalKnowledgeSchema] validates version as positive integer", () => {
  const resultOk = PortalKnowledgeSchema.safeParse({ ...validPortalKnowledge, version: 1 });
  assertEquals(resultOk.success, true);

  const resultZero = PortalKnowledgeSchema.safeParse({ ...validPortalKnowledge, version: 0 });
  assertEquals(resultZero.success, false);

  const resultFloat = PortalKnowledgeSchema.safeParse({ ...validPortalKnowledge, version: 1.5 });
  assertEquals(resultFloat.success, false);
});

Deno.test("[PortalKnowledgeSchema] validates gatheredAt as ISO string", () => {
  const resultOk = PortalKnowledgeSchema.safeParse({
    ...validPortalKnowledge,
    gatheredAt: "2026-03-13T10:00:00.000Z",
  });
  assertEquals(resultOk.success, true);

  const resultBad = PortalKnowledgeSchema.safeParse({
    ...validPortalKnowledge,
    gatheredAt: "not-a-date",
  });
  assertEquals(resultBad.success, false);
});

Deno.test("[PortalKnowledgeSchema] validates metadata mode enum values", () => {
  const modes = ["quick", "standard", "deep"] as const;
  for (const mode of modes) {
    const result = PortalKnowledgeSchema.safeParse({
      ...validPortalKnowledge,
      metadata: { ...validPortalKnowledge.metadata, mode },
    });
    assertEquals(result.success, true, `mode "${mode}" should be valid`);
  }
});

Deno.test("[PortalKnowledgeSchema] rejects invalid metadata mode", () => {
  const result = PortalKnowledgeSchema.safeParse({
    ...validPortalKnowledge,
    metadata: { ...validPortalKnowledge.metadata, mode: "turbo" },
  });
  assertEquals(result.success, false);
});

Deno.test("[PortalKnowledgeSchema] validates stats extensionDistribution as Record", () => {
  const result = PortalKnowledgeSchema.safeParse({
    ...validPortalKnowledge,
    stats: {
      ...validPortalKnowledge.stats,
      extensionDistribution: { ".ts": 50, ".js": 10, ".json": 5 },
    },
  });
  assertEquals(result.success, true);
});

Deno.test("[PortalKnowledgeSchema] packages field is optional", () => {
  const { packages: _p, ...withoutPackages } = { ...validPortalKnowledge, packages: [validMonorepoPackage] };
  const result = PortalKnowledgeSchema.safeParse(withoutPackages);
  assertEquals(result.success, true);
});

Deno.test("[PortalKnowledgeSchema] accepts packages array when provided", () => {
  const result = PortalKnowledgeSchema.safeParse({
    ...validPortalKnowledge,
    packages: [validMonorepoPackage],
  });
  assertEquals(result.success, true);
});

Deno.test("[PortalKnowledgeSchema] symbolMap defaults to empty array when absent", () => {
  const { symbolMap: _sm, ...withoutSymbolMap } = validPortalKnowledge;
  const result = PortalKnowledgeSchema.safeParse(withoutSymbolMap);
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.data.symbolMap, []);
  }
});

Deno.test("[PortalKnowledgeSchema] techStack optional fields are optional", () => {
  const result = PortalKnowledgeSchema.safeParse({
    ...validPortalKnowledge,
    techStack: { primaryLanguage: "typescript" },
  });
  assertEquals(result.success, true);
});

Deno.test("[PortalKnowledgeSchema] stats totalLinesOfCode is optional", () => {
  const result = PortalKnowledgeSchema.safeParse({
    ...validPortalKnowledge,
    stats: {
      totalFiles: 10,
      totalDirectories: 2,
      extensionDistribution: { ".ts": 10 },
    },
  });
  assertEquals(result.success, true);
});
