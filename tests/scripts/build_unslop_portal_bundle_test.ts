/**
 * @module BuildUnslopPortalBundleTest
 * @path tests/scripts/build_unslop_portal_bundle_test.ts
 * @description Tests the packaging wrapper that copies the engine bundle, compiles both portal catalogs, and writes the provenance manifest.
 * @architectural-layer Test
 * @dependencies [@std/assert, @std/path, @exaix/core]
 * @related-files [scripts/build_unslop_portal_bundle.ts, packages/core/src/types/constants.ts]
 */

import { assert, assertEquals, assertRejects } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { classifyPath, type ICatalog } from "@dostark/unslop-ts";
import {
  buildUnslopPortalAssets,
  type IEngineBundler,
  UnslopPackagingError,
} from "../../scripts/build_unslop_portal_bundle.ts";
import {
  UNSLOP_PLUGIN_NAME,
  UNSLOP_PORTAL_CATALOG_FILENAME,
  UNSLOP_PORTAL_DENO_CATALOG_FILENAME,
  UNSLOP_PORTAL_ENGINE_FILENAME,
  UNSLOP_PORTAL_MANIFEST_FILENAME,
  UNSLOP_PORTAL_POLICY_VERSION,
  UNSLOP_PORTAL_TEST_GLOBS,
} from "@exaix/core";

const REPO_ROOT = fromFileUrl(new URL("../../", import.meta.url));
const ENGINE_ROOT = join(REPO_ROOT, "unslop-ts");

const TS_ACTIVE_RULES: readonly string[] = [
  "unslop/decorative-comment",
  "unslop/dynamic-import",
  "unslop/ephemeral-comment",
  "unslop/ephemeral-filename",
  "unslop/import-inside-statement",
  "unslop/import-placement",
  "unslop/inline-type-import",
  "unslop/long-comment",
  "unslop/magic-union-type",
  "unslop/max-class-size",
  "unslop/max-cyclomatic-complexity",
  "unslop/max-params",
  "unslop/no-boolean-assert",
  "unslop/no-chained-type-assertions",
  "unslop/no-conditional-empty-object-spread",
  "unslop/no-constant-substring-assert",
  "unslop/no-explicit-unknown",
  "unslop/no-object-parameters",
  "unslop/no-pass-through-type-alias",
  "unslop/no-repeated-assert-call",
  "unslop/no-runtime-typeof",
  "unslop/no-typeof-escape",
  "unslop/no-unsafe-dictionary",
  "unslop/promise-response-alias",
  "unslop/promise-response-return",
  "unslop/re-export-imported",
  "unslop/require-safety-comment",
  "unslop/test-inline-multiline-fixture",
  "unslop/ts-suppression-pragmas",
];

const DENO_ONLY_RULES: readonly string[] = [
  "unslop/ignore-needs-reason",
  "unslop/no-forbidden-lint-ignore",
];

const OFF_RULES: readonly string[] = [
  "unslop/exported-interface-naming",
  "unslop/exported-interface-placement",
  "unslop/import-boundaries",
  "unslop/no-interface-rename-on-import",
  "unslop/require-module-header",
  "unslop/require-optional-wrapper",
];

const SEED_SOURCE = "export const seed = 1 as unknown as string;\n";
const SEED_RULE = "unslop/no-chained-type-assertions";

interface IEngineModule {
  readonly createDenoPlugin: (
    name: string,
    catalog: unknown,
    options: { rulePacks: readonly unknown[]; selection?: string },
  ) => Deno.lint.Plugin;
  readonly parseCatalog: (input: unknown, options: { scriptRuleSchemas: null; registry: unknown }) => unknown;
  readonly createRuleRegistry: (name: string, packs: readonly unknown[]) => unknown;
  readonly compileConfig: (input: unknown, descriptor: unknown) => { catalog: unknown };
  readonly TYPESCRIPT_RULE_PACK: { name: string };
  readonly DENO_RULE_PACK: { name: string };
}

interface IManifestFile {
  readonly sha256: string;
  readonly bytes: number;
}

interface IManifest {
  readonly format_version: number;
  readonly policy_version: number;
  readonly deno_version: string;
  readonly engine: { readonly git_sha: string; readonly package_version: string };
  readonly files: Readonly<Record<string, IManifestFile>>;
}

const prebuiltBundler: IEngineBundler = {
  run: () => Promise.resolve(),
};

async function ensureEngineDist(): Promise<void> {
  const engine = join(ENGINE_ROOT, "dist", UNSLOP_PORTAL_ENGINE_FILENAME);
  try {
    await Deno.stat(engine);
  } catch {
    await buildUnslopPortalAssets({
      root: REPO_ROOT,
      out: await Deno.makeTempDir({ prefix: "unslop-packaging-warmup-" }),
    });
  }
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await Deno.readTextFile(path)) as T;
}

async function sha256(path: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await Deno.readFile(path));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function loadEngine(enginePath: string): Promise<IEngineModule> {
  // The packaged engine is generated JavaScript. The test loads it after the build.
  // deno-lint-ignore exaix/dynamic-import exaix/import-inside-statement -- The generated bundle path exists only after the build.
  return await import(`file://${enginePath}`) as IEngineModule;
}

async function withTempOut(body: (out: string) => Promise<void>): Promise<void> {
  const out = await Deno.makeTempDir({ prefix: "unslop-packaging-" });
  try {
    await body(out);
  } finally {
    await Deno.remove(out, { recursive: true });
  }
}

function activeRuleIds(catalog: ICatalog): string[] {
  return Object.entries(catalog.rules)
    .filter(([, entry]) => entry.severity !== "off")
    .map(([id]) => id)
    .sort();
}

Deno.test("bundle-api-and-seed", async () => {
  await withTempOut(async (out) => {
    const report = await buildUnslopPortalAssets({ root: REPO_ROOT, out });
    assertEquals(report.engineInvocations, 1);
    assertEquals(
      report.files.slice().sort(),
      [
        UNSLOP_PORTAL_CATALOG_FILENAME,
        UNSLOP_PORTAL_DENO_CATALOG_FILENAME,
        UNSLOP_PORTAL_ENGINE_FILENAME,
      ].sort(),
    );

    const manifest = await readJson<IManifest>(join(out, UNSLOP_PORTAL_MANIFEST_FILENAME));
    assertEquals(manifest.format_version, 1);
    assertEquals(manifest.policy_version, UNSLOP_PORTAL_POLICY_VERSION);
    assertEquals(manifest.deno_version, Deno.version.deno);
    assert(/^[0-9a-f]{40}$/.test(manifest.engine.git_sha), "engine git sha is a full object id");
    const enginePackage = await readJson<{ version: string }>(join(ENGINE_ROOT, "deno.json"));
    assertEquals(manifest.engine.package_version, enginePackage.version);

    for (const name of report.files) {
      const info = manifest.files[name];
      assert(info !== undefined, `manifest lists ${name}`);
      assertEquals(await sha256(join(out, name)), info.sha256, `${name} hash matches manifest`);
      assertEquals((await Deno.stat(join(out, name))).size, info.bytes, `${name} byte length matches`);
    }
    assertEquals(
      await sha256(join(out, UNSLOP_PORTAL_ENGINE_FILENAME)),
      await sha256(
        join(ENGINE_ROOT, "dist", UNSLOP_PORTAL_ENGINE_FILENAME),
      ),
    );

    const engine = await loadEngine(join(out, UNSLOP_PORTAL_ENGINE_FILENAME));
    assertEquals(typeof engine.createDenoPlugin, "function");
    assertEquals(typeof engine.parseCatalog, "function");
    assertEquals(typeof engine.createRuleRegistry, "function");
    assertEquals(typeof engine.compileConfig, "function");
    assertEquals(engine.TYPESCRIPT_RULE_PACK.name, "typescript");
    assertEquals(engine.DENO_RULE_PACK.name, "deno");

    const catalog = engine.parseCatalog(
      await readJson(join(out, UNSLOP_PORTAL_CATALOG_FILENAME)),
      {
        scriptRuleSchemas: null,
        registry: engine.createRuleRegistry(UNSLOP_PLUGIN_NAME, [engine.TYPESCRIPT_RULE_PACK]),
      },
    );
    const plugin = engine.createDenoPlugin(UNSLOP_PLUGIN_NAME, catalog, {
      rulePacks: [engine.TYPESCRIPT_RULE_PACK],
      selection: "",
    });
    const diagnostics = Deno.lint.runPlugin(plugin, "seed.ts", SEED_SOURCE);
    // The runtime diagnostic carries the rule id. The public type omits it.
    const ids = diagnostics.map((diagnostic) => (diagnostic as Deno.lint.Diagnostic & { readonly id: string }).id);
    assert(ids.includes(SEED_RULE), `the packaged policy reports ${SEED_RULE}: ${ids.join(", ")}`);
  });
});

Deno.test("exact-policy-and-test-scopes", async () => {
  await ensureEngineDist();
  await withTempOut(async (out) => {
    await buildUnslopPortalAssets({ root: REPO_ROOT, out, bundler: prebuiltBundler });
    const tsCatalog = await readJson<ICatalog>(join(out, UNSLOP_PORTAL_CATALOG_FILENAME));
    const denoCatalog = await readJson<ICatalog>(join(out, UNSLOP_PORTAL_DENO_CATALOG_FILENAME));

    assertEquals(activeRuleIds(tsCatalog), [...TS_ACTIVE_RULES]);
    assertEquals(activeRuleIds(denoCatalog), [...TS_ACTIVE_RULES, ...DENO_ONLY_RULES].sort());

    for (const id of OFF_RULES) {
      const entry = tsCatalog.rules[id];
      assert(entry !== undefined, `${id} is packaged`);
      assertEquals(entry.severity, "off", `${id} is opt-in and off`);
      assert((entry.reason ?? "").length > 0, `${id} carries a compiler reason`);
      assertEquals(entry.optIn, true, `${id} is marked opt-in`);
    }
    assertEquals(tsCatalog.rules["unslop/no-forbidden-lint-ignore"], undefined);
    assertEquals(denoCatalog.rules["unslop/require-deno-shebang"].severity, "off");
    assertEquals(denoCatalog.rules["unslop/no-forbidden-lint-ignore"].severity, "error");

    for (const catalog of [tsCatalog, denoCatalog]) {
      assertEquals(catalog.version, "1");
      assertEquals(catalog.scopes.test, [...UNSLOP_PORTAL_TEST_GLOBS]);
      assertEquals(catalog.scopes.fixture, []);
      assertEquals(catalog.ignore, undefined);
      assertEquals(catalog.layout, undefined);
      assertEquals(catalog.wholeTree, undefined);
      for (const entry of Object.values(catalog.rules)) {
        assertEquals(entry.scope, "all");
        assertEquals(entry.engine, "plugin");
      }
    }

    const scopes = tsCatalog.scopes;
    assertEquals(classifyPath("seed_test.ts", scopes), "test");
    assertEquals(classifyPath("tests/nested/seed.ts", scopes), "test");
    assertEquals(classifyPath("packages/demo/src/seed.ts", scopes), "prod");
  });
});

Deno.test("packaging-failure-and-determinism", async () => {
  await ensureEngineDist();
  await withTempOut(async (first) => {
    await withTempOut(async (second) => {
      await buildUnslopPortalAssets({ root: REPO_ROOT, out: first, bundler: prebuiltBundler });
      await buildUnslopPortalAssets({ root: REPO_ROOT, out: second, bundler: prebuiltBundler });
      for (const name of [UNSLOP_PORTAL_CATALOG_FILENAME, UNSLOP_PORTAL_DENO_CATALOG_FILENAME]) {
        assertEquals(await Deno.readTextFile(join(first, name)), await Deno.readTextFile(join(second, name)));
      }
      assertEquals(
        await Deno.readTextFile(join(first, UNSLOP_PORTAL_MANIFEST_FILENAME)),
        await Deno.readTextFile(join(second, UNSLOP_PORTAL_MANIFEST_FILENAME)),
      );
    });
  });

  const failing: IEngineBundler = {
    run: () => Promise.reject(new Error("bundle failed")),
  };
  await withTempOut(async (out) => {
    await assertRejects(
      () => buildUnslopPortalAssets({ root: REPO_ROOT, out, bundler: failing }),
      UnslopPackagingError,
      "engine bundle failed",
    );
    await assertRejects(
      () => Deno.stat(join(out, UNSLOP_PORTAL_MANIFEST_FILENAME)),
      Deno.errors.NotFound,
    );
  });

  await withTempOut(async (out) => {
    await assertRejects(
      () => buildUnslopPortalAssets({ root: out, out, bundler: prebuiltBundler }),
      UnslopPackagingError,
    );
    await assertRejects(
      () => Deno.stat(join(out, UNSLOP_PORTAL_MANIFEST_FILENAME)),
      Deno.errors.NotFound,
    );
  });

  const corrupt = await Deno.makeTempDir({ prefix: "unslop-engine-corrupt-" });
  try {
    const engineRoot = join(corrupt, "unslop-ts");
    await Deno.mkdir(join(engineRoot, "dist"), { recursive: true });
    await Deno.mkdir(join(engineRoot, "src", "bundle"), { recursive: true });
    await Deno.mkdir(join(engineRoot, "scripts"), { recursive: true });
    await Deno.writeTextFile(join(engineRoot, "scripts", "bundle.ts"), "// fixture\n");
    await Deno.writeTextFile(join(engineRoot, "src", "bundle", "engine.ts"), "// fixture\n");
    await Deno.writeTextFile(join(engineRoot, "deno.json"), JSON.stringify({ version: "0.0.0" }));
    const engineFile = join(engineRoot, "dist", UNSLOP_PORTAL_ENGINE_FILENAME);
    await Deno.writeTextFile(engineFile, "// engine fixture\n");
    await Deno.writeTextFile(`${engineFile}.sha256`, `${"0".repeat(64)}  ${UNSLOP_PORTAL_ENGINE_FILENAME}\n`);
    await withTempOut(async (out) => {
      await assertRejects(
        () => buildUnslopPortalAssets({ root: corrupt, out, bundler: prebuiltBundler }),
        UnslopPackagingError,
        "checksum",
      );
      await assertRejects(
        () => Deno.stat(join(out, UNSLOP_PORTAL_MANIFEST_FILENAME)),
        Deno.errors.NotFound,
      );
    });
  } finally {
    await Deno.remove(corrupt, { recursive: true });
  }
});
