/**
 * @module PackageDependencyGraphTest
 * @path tests/scripts/package_dependency_graph_test.ts
 * @description Verifies package dependency graph analysis, candidate source module
 * detection, and file-level boundary analysis used by package migration tooling.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { toFileUrl } from "@std/path";
import {
  buildBoundaryReport,
  buildPackageGraph,
  discoverPackageRoots,
  explainBoundary,
  findCandidateSrcModules,
  renderBoundaryReport,
  resolveAliasPath,
  runDenoInfo,
  selectPackageRoot,
} from "../../scripts/package_dependency_graph.ts";
import type { BoundaryReport, DenoInfoJson } from "../../scripts/package_dependency_graph.ts";

Deno.test("selectPackageRoot chooses the deepest matching workspace root", () => {
  const roots = ["src", "packages/core", "packages/core/src"];
  assertEquals(selectPackageRoot("packages/core/src/constants.ts", roots), "packages/core/src");
  assertEquals(selectPackageRoot("packages/core/mod.ts", roots), "packages/core");
  assertEquals(selectPackageRoot("src/main.ts", roots), "src");
});

Deno.test("buildPackageGraph assembles package edges from deno info output", () => {
  const repo = Deno.cwd();
  const info: DenoInfoJson = {
    version: 1,
    roots: [toFileUrl(`${repo}/src/main.ts`).href],
    modules: [
      {
        specifier: toFileUrl(`${repo}/src/main.ts`).href,
        dependencies: [
          {
            specifier: toFileUrl(`${repo}/packages/core/mod.ts`).href,
            code: { specifier: toFileUrl(`${repo}/packages/core/mod.ts`).href },
          },
          {
            specifier: "https://deno.land/std@0.221.0/fs/mod.ts",
            code: { specifier: "https://deno.land/std@0.221.0/fs/mod.ts" },
          },
        ],
      },
      {
        specifier: toFileUrl(`${repo}/packages/core/mod.ts`).href,
        dependencies: [
          {
            specifier: toFileUrl(`${repo}/packages/core/src/constants.ts`).href,
            code: { specifier: toFileUrl(`${repo}/packages/core/src/constants.ts`).href },
          },
        ],
      },
      {
        specifier: toFileUrl(`${repo}/packages/core/src/constants.ts`).href,
      },
    ],
  };

  const graph = buildPackageGraph(info, ["src", "packages/core"]);

  assertEquals(graph.packages.map((pkg) => pkg.name).sort(), ["@exaix", "packages/core"]);
  assertEquals(graph.edges, [{ from: "@exaix", to: "packages/core" }]);
  assertEquals(graph.externalPackages, ["https://deno.land/std@0.221.0/fs/mod.ts"]);
});

Deno.test("findCandidateSrcModules identifies src modules that import @exaix/core", () => {
  const repo = Deno.cwd();
  const info: DenoInfoJson = {
    version: 1,
    roots: [toFileUrl(`${repo}/src/main.ts`).href],
    modules: [
      {
        specifier: toFileUrl(`${repo}/packages/core/mod.ts`).href,
      },
      {
        specifier: toFileUrl(`${repo}/src/shared/types/json.ts`).href,
        dependencies: [
          {
            specifier: "@exaix/core",
            code: { specifier: "@exaix/core" },
          },
        ],
      },
      {
        specifier: toFileUrl(`${repo}/src/shared/types/json_shim.ts`).href,
        dependencies: [
          {
            specifier: toFileUrl(`${repo}/src/shared/types/json.ts`).href,
            code: { specifier: toFileUrl(`${repo}/src/shared/types/json.ts`).href },
          },
        ],
      },
    ],
  };

  const report = findCandidateSrcModules(info, ["src", "packages/core"], "packages/core", {
    importAliases: { "@exaix/core": "packages/core/mod.ts" },
  });
  assertEquals(report?.targetRoot, "packages/core");
  assertEquals(report?.directSrcModules, ["src/shared/types/json.ts"]);
  assertEquals(report?.transitiveSrcModules, ["src/shared/types/json_shim.ts"]);
  assertEquals(report?.allSrcModules, ["src/shared/types/json.ts", "src/shared/types/json_shim.ts"]);
});

Deno.test("buildPackageGraph prefers canonical package aliases when import aliases are available", () => {
  const repo = Deno.cwd();
  const info: DenoInfoJson = {
    version: 1,
    roots: [toFileUrl(`${repo}/src/main.ts`).href],
    modules: [
      {
        specifier: toFileUrl(`${repo}/src/main.ts`).href,
        dependencies: [
          {
            specifier: "@exaix/core",
            code: { specifier: "@exaix/core" },
          },
        ],
      },
      {
        specifier: toFileUrl(`${repo}/packages/core/mod.ts`).href,
      },
    ],
  };

  const graph = buildPackageGraph(info, ["src", "packages/core"], {
    importAliases: {
      "@exaix/core": "packages/core/mod.ts",
    },
  });

  assertEquals(graph.packages.map((pkg) => pkg.name).sort(), ["@exaix", "@exaix/core"]);
  assertEquals(graph.edges, [{ from: "@exaix", to: "@exaix/core" }]);
});

Deno.test("findCandidateSrcModules accepts canonical package alias names", () => {
  const repo = Deno.cwd();
  const info: DenoInfoJson = {
    version: 1,
    roots: [toFileUrl(`${repo}/src/main.ts`).href],
    modules: [
      {
        specifier: toFileUrl(`${repo}/packages/core/mod.ts`).href,
      },
      {
        specifier: toFileUrl(`${repo}/src/shared/types/json.ts`).href,
        dependencies: [
          {
            specifier: "@exaix/core",
            code: { specifier: "@exaix/core" },
          },
        ],
      },
    ],
  };

  const report = findCandidateSrcModules(info, ["src", "packages/core"], "@exaix/core", {
    importAliases: { "@exaix/core": "packages/core/mod.ts" },
  });

  assertEquals(report?.targetRoot, "packages/core");
  assertEquals(report?.directSrcModules, ["src/shared/types/json.ts"]);
});

Deno.test("resolveAliasPath preserves exact file aliases", () => {
  assertEquals(
    resolveAliasPath("@exaix/core", {
      "@exaix/core": "packages/core/mod.ts",
    }),
    "packages/core/mod.ts",
  );
});

Deno.test("buildPackageGraph ignores repo-local modules outside declared package roots", () => {
  const repo = Deno.cwd();
  const info: DenoInfoJson = {
    version: 1,
    roots: [toFileUrl(`${repo}/packages/schemas/mod.ts`).href],
    modules: [
      {
        specifier: toFileUrl(`${repo}/packages/schemas/src/portal_permissions.ts`).href,
        dependencies: [
          {
            specifier: toFileUrl(`${repo}/tests/helpers/constants.ts`).href,
            code: { specifier: toFileUrl(`${repo}/tests/helpers/constants.ts`).href },
          },
        ],
      },
      {
        specifier: toFileUrl(`${repo}/tests/helpers/constants.ts`).href,
      },
    ],
  };

  const graph = buildPackageGraph(info, ["src", "packages/schemas"], {
    importAliases: {
      "@exaix/schemas": "packages/schemas/mod.ts",
    },
  });

  assertEquals(graph.packages.map((pkg) => pkg.name).sort(), ["@exaix", "@exaix/schemas"]);
  assertEquals(graph.edges, []);
});

Deno.test("buildPackageGraph ignores type-only cross-package dependencies", () => {
  const repo = Deno.cwd();
  const info: DenoInfoJson = {
    version: 1,
    roots: [toFileUrl(`${repo}/packages/core/mod.ts`).href],
    modules: [
      {
        specifier: toFileUrl(`${repo}/packages/core/src/types/i_config_service.ts`).href,
        dependencies: [
          {
            specifier: "@exaix/schemas/config.ts",
          },
        ],
      },
      {
        specifier: toFileUrl(`${repo}/packages/schemas/src/config.ts`).href,
      },
    ],
  };

  const graph = buildPackageGraph(info, ["src", "packages/core", "packages/schemas"], {
    importAliases: {
      "@exaix/core": "packages/core/mod.ts",
      "@exaix/schemas": "packages/schemas/mod.ts",
      "@exaix/schemas/": "packages/schemas/src/",
    },
  });

  assertEquals(graph.edges, []);
});

Deno.test("package dependency graph reports @exaix/git runtime dependency only on @exaix/core", async () => {
  const info = await runDenoInfo("packages/git/mod.ts");
  const discovery = await discoverPackageRoots();
  const graph = buildPackageGraph(info, discovery.roots, {
    importAliases: discovery.importAliases,
  });
  const gitEdges = graph.edges.filter((edge) => edge.from === "@exaix/git");

  assertEquals(graph.packages.some((pkg) => pkg.name === "@exaix/git"), true);
  assertEquals(gitEdges, [{ from: "@exaix/git", to: "@exaix/core" }]);
});

// ---------------------------------------------------------------------------
// buildBoundaryReport — unit tests with synthetic DenoInfoJson fixtures
// ---------------------------------------------------------------------------

Deno.test("buildBoundaryReport: file with only package deps is extractable", () => {
  const repo = Deno.cwd();
  const info: DenoInfoJson = {
    version: 1,
    roots: [toFileUrl(`${repo}/src/mcp/tool.ts`).href],
    modules: [
      {
        specifier: toFileUrl(`${repo}/src/mcp/tool.ts`).href,
        dependencies: [
          { specifier: "@exaix/core", code: { specifier: "@exaix/core" } },
          { specifier: "@exaix/schemas", code: { specifier: "@exaix/schemas" } },
        ],
      },
      { specifier: toFileUrl(`${repo}/packages/core/mod.ts`).href },
      { specifier: toFileUrl(`${repo}/packages/schemas/mod.ts`).href },
    ],
  };
  const roots = ["src", "packages/core", "packages/schemas"];
  const options = {
    importAliases: {
      "@exaix/core": "packages/core/mod.ts",
      "@exaix/schemas": "packages/schemas/mod.ts",
    },
  };

  const report = buildBoundaryReport(info, "src/mcp/tool.ts", roots, options);

  assertEquals(report.extractable, true);
  assertEquals(report.srcDepsCount, 0);
  assertEquals(report.transitiveGroups, []);
  assertEquals(
    report.directGroups.map((g) => g.packageName).sort(),
    ["@exaix/core", "@exaix/schemas"],
  );
});

Deno.test("buildBoundaryReport: direct src/ dep makes file not extractable", () => {
  const repo = Deno.cwd();
  const info: DenoInfoJson = {
    version: 1,
    roots: [toFileUrl(`${repo}/packages/mcp/server/handlers/run_command_tool.ts`).href],
    modules: [
      {
        specifier: toFileUrl(`${repo}/packages/mcp/server/handlers/run_command_tool.ts`).href,
        dependencies: [
          { specifier: "@exaix/mcp", code: { specifier: "@exaix/mcp" } },
          {
            specifier: toFileUrl(`${repo}/packages/git/src/git_service.ts`).href,
            code: { specifier: toFileUrl(`${repo}/packages/git/src/git_service.ts`).href },
          },
        ],
      },
      { specifier: toFileUrl(`${repo}/packages/mcp/mod.ts`).href },
      { specifier: toFileUrl(`${repo}/packages/git/src/git_service.ts`).href },
    ],
  };
  const roots = ["src", "packages/mcp"];
  const options = { importAliases: { "@exaix/mcp": "packages/mcp/mod.ts" } };

  const report = buildBoundaryReport(
    info,
    "packages/mcp/server/handlers/run_command_tool.ts",
    roots,
    options,
  );

  assertEquals(report.extractable, false);
  assertEquals(report.srcDepsCount, 1);
  const srcGroup = report.directGroups.find((g) => g.packageName === "@exaix (src/)");
  assertEquals(srcGroup?.modules, ["packages/git/src/git_service.ts"]);
});

Deno.test("buildBoundaryReport: transitive src/ dep is not extractable and split from direct", () => {
  const repo = Deno.cwd();
  const info: DenoInfoJson = {
    version: 1,
    roots: [toFileUrl(`${repo}/packages/mcp/server/handlers/search.ts`).href],
    modules: [
      {
        specifier: toFileUrl(`${repo}/packages/mcp/server/handlers/search.ts`).href,
        dependencies: [
          {
            specifier: toFileUrl(`${repo}/packages/mcp/server/handlers/base.ts`).href,
            code: { specifier: toFileUrl(`${repo}/packages/mcp/server/handlers/base.ts`).href },
          },
        ],
      },
      {
        specifier: toFileUrl(`${repo}/packages/mcp/server/handlers/base.ts`).href,
        dependencies: [
          {
            specifier: toFileUrl(`${repo}/src/services/portal/portal_service.ts`).href,
            code: { specifier: toFileUrl(`${repo}/src/services/portal/portal_service.ts`).href },
          },
        ],
      },
      { specifier: toFileUrl(`${repo}/src/services/portal/portal_service.ts`).href },
    ],
  };
  const roots = ["src"];

  const report = buildBoundaryReport(info, "packages/mcp/server/handlers/search.ts", roots);

  assertEquals(report.extractable, false);
  assertEquals(report.srcDepsCount, 2);
  const directNames = report.directGroups.map((g) => g.packageName);
  const transitiveNames = report.transitiveGroups.map((g) => g.packageName);
  assertEquals(directNames, ["@exaix (src/)"]);
  assertEquals(transitiveNames, ["@exaix (src/)"]);
  assertEquals(report.directGroups[0]!.modules, ["packages/mcp/server/handlers/base.ts"]);
  assertEquals(report.transitiveGroups[0]!.modules, ["src/services/portal/portal_service.ts"]);
});

Deno.test("buildBoundaryReport: external specifiers appear in externalDirect", () => {
  const repo = Deno.cwd();
  const info: DenoInfoJson = {
    version: 1,
    roots: [toFileUrl(`${repo}/src/util.ts`).href],
    modules: [
      {
        specifier: toFileUrl(`${repo}/src/util.ts`).href,
        dependencies: [
          { specifier: "jsr:@std/assert@^1.0.0", code: { specifier: "jsr:@std/assert@^1.0.0" } },
        ],
      },
    ],
  };
  const roots = ["src"];

  const report = buildBoundaryReport(info, "src/util.ts", roots);

  assertEquals(report.extractable, true);
  assertEquals(report.externalDirect, ["jsr:@std/assert@^1.0.0"]);
  assertEquals(report.directGroups, []);
});

Deno.test("buildBoundaryReport: file with no deps is extractable", () => {
  const repo = Deno.cwd();
  const info: DenoInfoJson = {
    version: 1,
    roots: [toFileUrl(`${repo}/packages/core/src/constants.ts`).href],
    modules: [
      {
        specifier: toFileUrl(`${repo}/packages/core/src/constants.ts`).href,
      },
    ],
  };

  const report = buildBoundaryReport(info, "packages/core/src/constants.ts", ["src", "packages/core"]);

  assertEquals(report.extractable, true);
  assertEquals(report.srcDepsCount, 0);
  assertEquals(report.directGroups, []);
  assertEquals(report.transitiveGroups, []);
  assertEquals(report.externalDirect, []);
});

// ---------------------------------------------------------------------------
// renderBoundaryReport — output format tests
// ---------------------------------------------------------------------------

Deno.test("renderBoundaryReport: extractable file shows EXTRACTABLE verdict", () => {
  const report: BoundaryReport = {
    targetPath: "packages/mcp/src/tool_result_converter.ts",
    directGroups: [{ packageName: "@exaix/core", modules: ["packages/core/mod.ts"] }],
    transitiveGroups: [],
    externalDirect: [],
    extractable: true,
    srcDepsCount: 0,
  };

  const text = renderBoundaryReport(report);
  assertStringIncludes(text, "EXTRACTABLE");
  assertEquals(text.includes("NOT extractable"), false);
  assertStringIncludes(text, "packages/mcp/src/tool_result_converter.ts");
});

Deno.test("renderBoundaryReport: non-extractable file shows src/ blockers", () => {
  const report: BoundaryReport = {
    targetPath: "packages/mcp/server/handlers/run_command_tool.ts",
    directGroups: [
      { packageName: "@exaix (src/)", modules: ["packages/git/src/git_service.ts"] },
      { packageName: "@exaix/mcp", modules: ["packages/mcp/mod.ts"] },
    ],
    transitiveGroups: [],
    externalDirect: [],
    extractable: false,
    srcDepsCount: 1,
  };

  const text = renderBoundaryReport(report);
  assertStringIncludes(text, "NOT extractable");
  assertStringIncludes(text, "packages/git/src/git_service.ts");
  assertEquals(text.includes("EXTRACTABLE"), false);
});

Deno.test("renderBoundaryReport: external deps appear truncated after 5", () => {
  const report: BoundaryReport = {
    targetPath: "src/util.ts",
    directGroups: [],
    transitiveGroups: [],
    externalDirect: ["jsr:@std/a", "jsr:@std/b", "jsr:@std/c", "jsr:@std/d", "jsr:@std/e", "jsr:@std/f"],
    extractable: true,
    srcDepsCount: 0,
  };

  const text = renderBoundaryReport(report);
  assertStringIncludes(text, "and 1 more");
});

// ---------------------------------------------------------------------------
// explainBoundary — integration test against live repo files
// ---------------------------------------------------------------------------

Deno.test("explainBoundary: src/mcp handler shim still reports current src blockers", async () => {
  const discovery = await discoverPackageRoots();
  const report = await explainBoundary(
    "packages/mcp/server/handlers/run_command_tool.ts",
    discovery.roots,
    { importAliases: discovery.importAliases },
  );

  assertEquals(report.extractable, false);
  assertStringIncludes(report.targetPath, "run_command_tool");
  assertEquals(report.srcDepsCount > 0, true);
  assertEquals(
    report.transitiveGroups.some(
      (group) =>
        group.packageName === "@exaix (src/)" &&
        group.modules.includes("src/api/sse_handler.ts"),
    ),
    true,
  );
});

Deno.test("explainBoundary: packages/mcp/src/tool_result_converter.ts is extractable", async () => {
  const discovery = await discoverPackageRoots();
  const report = await explainBoundary(
    "packages/mcp/src/tool_result_converter.ts",
    discovery.roots,
    { importAliases: discovery.importAliases },
  );

  assertEquals(report.extractable, true);
  assertEquals(report.srcDepsCount, 0);
});
