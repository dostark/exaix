/**
 * @module PackageDependencyGraphTest
 * @path tests/scripts/package_dependency_graph_test.ts
 * @description Verifies package dependency graph analysis and candidate source module detection used by package migration tooling.
 */

import { assertEquals } from "@std/assert";
import { toFileUrl } from "@std/path";
import {
  buildPackageGraph,
  findCandidateSrcModules,
  resolveAliasPath,
  selectPackageRoot,
} from "../../scripts/package_dependency_graph.ts";
import type { DenoInfoJson } from "../../scripts/package_dependency_graph.ts";

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
