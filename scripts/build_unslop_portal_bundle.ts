#!/usr/bin/env -S deno run -A
/**
 * @module BuildUnslopPortalBundle
 * @path scripts/build_unslop_portal_bundle.ts
 * @description Packages the engine bundle, compiles the two portal catalogs, and writes the provenance manifest.
 * @architectural-layer Tooling
 * @dependencies [@std/flags, @std/path, @dostark/unslop-ts, @exaix/core]
 * @related-files [packages/core/src/types/constants.ts, unslop-ts/scripts/bundle.ts]
 * @public Exports are the unit-test surface of this module.
 *
 * Usage:
 *   deno run -A scripts/build_unslop_portal_bundle.ts [--out <dir>]
 *
 * The wrapper invokes the shipped engine `bundle` task exactly once.
 * It verifies the engine checksum and copies the library bytes.
 * It compiles the TypeScript and TypeScript+Deno portal catalogs.
 * Every catalog is validated with the packaged registry before any write.
 * The manifest is written last, so a failed build leaves no complete asset set.
 * The default output is `<repo>/lint`, which the source repository ignores.
 */

import { parse } from "@std/flags";
import { fromFileUrl, join, resolve } from "@std/path";
import {
  compileConfig,
  createRuleRegistry,
  DENO_RULE_PACK,
  type ICatalog,
  type IProjectDescriptor,
  type IRulePack,
  type JsonValue,
  parseCatalog,
  TYPESCRIPT_RULE_PACK,
} from "@dostark/unslop-ts";
import {
  UNSLOP_PLUGIN_NAME,
  UNSLOP_PORTAL_ASSET_DIR,
  UNSLOP_PORTAL_CATALOG_FILENAME,
  UNSLOP_PORTAL_DENO_CATALOG_FILENAME,
  UNSLOP_PORTAL_ENGINE_FILENAME,
  UNSLOP_PORTAL_MANIFEST_FILENAME,
  UNSLOP_PORTAL_MANIFEST_FORMAT_VERSION,
  UNSLOP_PORTAL_POLICY_VERSION,
  UNSLOP_PORTAL_TEST_GLOBS,
} from "@exaix/core";

const REPO_ROOT = fromFileUrl(new URL("../", import.meta.url));
const ENGINE_DIR = "unslop-ts";
const ENGINE_TASK = "bundle";
const MANIFEST_INDENT = 2;
const JSON_NEWLINE = "\n";

/** A failed packaging run. The message never contains portal-controlled text. */
export class UnslopPackagingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnslopPackagingError";
  }
}

/** Runs the shipped engine bundler once for one engine checkout. */
export interface IEngineBundler {
  run(engineRoot: string): Promise<void>;
}

/** One packaged file hash and size. */
export interface IUnslopAssetHash {
  readonly sha256: string;
  readonly bytes: number;
}

/** The packaged provenance manifest. */
export interface IUnslopPortalAssetManifest {
  readonly format_version: number;
  readonly policy_version: number;
  readonly deno_version: string;
  readonly engine: {
    readonly git_sha: string;
    readonly package_version: string;
  };
  readonly files: Readonly<Record<string, IUnslopAssetHash>>;
}

/** Inputs of one packaging run. */
export interface IBuildUnslopPortalAssetsOptions {
  readonly root: string;
  readonly out: string;
  readonly bundler?: IEngineBundler;
}

/** The result of one packaging run. */
export interface IBuildUnslopPortalAssetsReport {
  readonly out: string;
  readonly files: readonly string[];
  readonly engineInvocations: number;
  readonly manifest: IUnslopPortalAssetManifest;
}

/** The authored version 2 input the packaging owns. It is not a portal file. */
const PORTAL_POLICY_INPUT: JsonValue = {
  version: 2,
  plugin: UNSLOP_PLUGIN_NAME,
  extends: ["unslop:strict"],
  docsBase: "",
  paths: {
    test: [...UNSLOP_PORTAL_TEST_GLOBS],
    fixture: [],
    ignore: [],
  },
  rules: {},
};

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}

function sha256Hex(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return crypto.subtle.digest("SHA-256", copy).then((digest) =>
    [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")
  );
}

async function readEngineChecksum(engineFile: string): Promise<string> {
  const checksumFile = `${engineFile}.sha256`;
  let text: string;
  try {
    text = await Deno.readTextFile(checksumFile);
  } catch {
    throw new UnslopPackagingError(`engine checksum file is missing: ${checksumFile}`);
  }
  const value = text.trim().split(/\s+/)[0] ?? "";
  if (!/^[0-9a-f]{64}$/.test(value)) {
    throw new UnslopPackagingError("engine checksum file is malformed");
  }
  return value;
}

async function verifyEngineChecksum(engineFile: string, bytes: Uint8Array): Promise<string> {
  const expected = await readEngineChecksum(engineFile);
  const actual = await sha256Hex(bytes);
  if (actual !== expected) {
    throw new UnslopPackagingError(
      `engine checksum mismatch: expected ${expected} but the built bundle is ${actual}`,
    );
  }
  return actual;
}

async function readEngineGitSha(engineRoot: string): Promise<string> {
  const result = await new Deno.Command("git", {
    args: ["-C", engineRoot, "rev-parse", "HEAD"],
    stdout: "piped",
    stderr: "piped",
  }).output();
  const sha = new TextDecoder().decode(result.stdout).trim();
  if (!result.success || !/^[0-9a-f]{40,64}$/.test(sha)) {
    throw new UnslopPackagingError("the engine checkout has no readable Git commit");
  }
  return sha;
}

async function readEnginePackageVersion(engineRoot: string): Promise<string> {
  let parsed: { version?: unknown };
  try {
    parsed = JSON.parse(await Deno.readTextFile(join(engineRoot, "deno.json")));
  } catch {
    throw new UnslopPackagingError("the engine package metadata is missing or unreadable");
  }
  if (typeof parsed.version !== "string" || parsed.version.length === 0) {
    throw new UnslopPackagingError("the engine package metadata has no version");
  }
  return parsed.version;
}

async function requireEngineSource(engineRoot: string): Promise<void> {
  for (const relative of ["scripts/bundle.ts", "src/bundle/engine.ts"]) {
    try {
      await Deno.stat(join(engineRoot, relative));
    } catch {
      throw new UnslopPackagingError(
        `engine source not found at ${join(engineRoot, relative)}; run from an initialized source checkout`,
      );
    }
  }
}

const denoTaskBundler: IEngineBundler = {
  async run(engineRoot: string): Promise<void> {
    const result = await new Deno.Command(Deno.execPath(), {
      args: ["task", "--cwd", engineRoot, ENGINE_TASK],
      stdout: "piped",
      stderr: "piped",
    }).output();
    if (!result.success) {
      const stderr = new TextDecoder().decode(result.stderr).trim();
      throw new Error(stderr.length > 0 ? stderr : "the engine bundle task exited nonzero");
    }
  },
};

function portalDescriptor(packs: readonly IRulePack[], out: string): IProjectDescriptor {
  const rootUrl = new URL(`file://${out.endsWith("/") ? out : `${out}/`}`);
  return {
    pluginName: UNSLOP_PLUGIN_NAME,
    rootUrl,
    configUrl: new URL(UNSLOP_PORTAL_CATALOG_FILENAME, rootUrl),
    lintConfigUrl: new URL("deno.json", rootUrl),
    pluginUrl: new URL("plugin.ts", rootUrl),
    packs,
    scriptRules: {},
    wholeTreeHosts: {},
  };
}

function projectCatalog(catalog: ICatalog): ICatalog {
  const rules: ICatalog["rules"] = {};
  for (const id of Object.keys(catalog.rules).sort()) {
    const entry = catalog.rules[id];
    if (entry.engine === "plugin") rules[id] = entry;
  }
  const usedTags = new Set(Object.values(rules).flatMap((entry) => entry.tags));
  const tagVocabulary: ICatalog["tagVocabulary"] = {};
  for (const tag of Object.keys(catalog.tagVocabulary).sort()) {
    if (usedTags.has(tag)) tagVocabulary[tag] = catalog.tagVocabulary[tag];
  }
  return {
    version: catalog.version,
    scopes: { test: [...catalog.scopes.test], fixture: [...catalog.scopes.fixture] },
    tagVocabulary,
    rules,
  };
}

function compilePortalCatalog(packs: readonly IRulePack[], out: string): ICatalog {
  let compiled: ICatalog;
  try {
    compiled = compileConfig(PORTAL_POLICY_INPUT, portalDescriptor(packs, out)).catalog;
  } catch (error) {
    throw new UnslopPackagingError(`catalog compilation failed: ${messageOf(error)}`);
  }
  const projected = projectCatalog(compiled);
  try {
    return parseCatalog(
      projected as JsonValue,
      { scriptRuleSchemas: null, registry: createRuleRegistry(UNSLOP_PLUGIN_NAME, packs) },
    );
  } catch (error) {
    throw new UnslopPackagingError(`catalog validation failed: ${messageOf(error)}`);
  }
}

function catalogBytes(catalog: ICatalog): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(catalog, null, MANIFEST_INDENT) + JSON_NEWLINE);
}

async function writeAsset(dir: string, name: string, bytes: Uint8Array): Promise<void> {
  const target = join(dir, name);
  const temporary = `${target}.tmp`;
  await Deno.writeFile(temporary, bytes);
  await Deno.rename(temporary, target);
}

/** Packages the engine and both portal catalogs into `out`. The manifest is written last. */
export async function buildUnslopPortalAssets(
  options: IBuildUnslopPortalAssetsOptions,
): Promise<IBuildUnslopPortalAssetsReport> {
  const root = resolve(options.root);
  const out = resolve(options.out);
  const engineRoot = join(root, ENGINE_DIR);
  if (out === root) {
    throw new UnslopPackagingError("--out must not be the repository root");
  }
  await requireEngineSource(engineRoot);
  const bundler = options.bundler ?? denoTaskBundler;
  try {
    await bundler.run(engineRoot);
  } catch (error) {
    throw new UnslopPackagingError(`engine bundle failed: ${messageOf(error)}`);
  }

  const engineFile = join(engineRoot, "dist", UNSLOP_PORTAL_ENGINE_FILENAME);
  let engineBytes: Uint8Array;
  try {
    engineBytes = await Deno.readFile(engineFile);
  } catch {
    throw new UnslopPackagingError(`engine bundle output is missing: ${engineFile}`);
  }
  const engineHash = await verifyEngineChecksum(engineFile, engineBytes);
  const engineGitSha = await readEngineGitSha(engineRoot);
  const engineVersion = await readEnginePackageVersion(engineRoot);

  const tsCatalog = compilePortalCatalog([TYPESCRIPT_RULE_PACK], out);
  const denoCatalog = compilePortalCatalog([TYPESCRIPT_RULE_PACK, DENO_RULE_PACK], out);
  const tsBytes = catalogBytes(tsCatalog);
  const denoBytes = catalogBytes(denoCatalog);

  const files: Record<string, IUnslopAssetHash> = {
    [UNSLOP_PORTAL_ENGINE_FILENAME]: { sha256: engineHash, bytes: engineBytes.byteLength },
    [UNSLOP_PORTAL_CATALOG_FILENAME]: { sha256: await sha256Hex(tsBytes), bytes: tsBytes.byteLength },
    [UNSLOP_PORTAL_DENO_CATALOG_FILENAME]: {
      sha256: await sha256Hex(denoBytes),
      bytes: denoBytes.byteLength,
    },
  };
  const manifest: IUnslopPortalAssetManifest = {
    format_version: UNSLOP_PORTAL_MANIFEST_FORMAT_VERSION,
    policy_version: UNSLOP_PORTAL_POLICY_VERSION,
    deno_version: Deno.version.deno,
    engine: { git_sha: engineGitSha, package_version: engineVersion },
    files,
  };

  await Deno.mkdir(out, { recursive: true });
  await writeAsset(out, UNSLOP_PORTAL_ENGINE_FILENAME, engineBytes);
  await writeAsset(out, UNSLOP_PORTAL_CATALOG_FILENAME, tsBytes);
  await writeAsset(out, UNSLOP_PORTAL_DENO_CATALOG_FILENAME, denoBytes);
  await writeAsset(
    out,
    UNSLOP_PORTAL_MANIFEST_FILENAME,
    new TextEncoder().encode(JSON.stringify(manifest, null, MANIFEST_INDENT) + JSON_NEWLINE),
  );

  return {
    out,
    files: [
      UNSLOP_PORTAL_ENGINE_FILENAME,
      UNSLOP_PORTAL_CATALOG_FILENAME,
      UNSLOP_PORTAL_DENO_CATALOG_FILENAME,
    ],
    engineInvocations: 1,
    manifest,
  };
}

/** Runs the packaging command line and returns its exit code. */
export async function main(argv: readonly string[]): Promise<number> {
  let flags: Record<string, unknown>;
  try {
    flags = parse([...argv], {
      string: ["out"],
      boolean: ["help"],
      alias: { h: "help" },
      default: { out: join(REPO_ROOT, UNSLOP_PORTAL_ASSET_DIR) },
    });
  } catch (error) {
    console.error(messageOf(error));
    return 2;
  }
  if (flags.help === true) {
    console.log("Usage: deno run -A scripts/build_unslop_portal_bundle.ts [--out <dir>]");
    return 0;
  }
  const out = flags.out;
  if (typeof out !== "string" || out.length === 0) {
    console.error("--out must name a directory");
    return 2;
  }
  try {
    const report = await buildUnslopPortalAssets({ root: REPO_ROOT, out });
    console.log(`wrote ${report.files.length} assets to ${report.out}`);
    return 0;
  } catch (error) {
    console.error(messageOf(error));
    return 1;
  }
}

if (import.meta.main) {
  Deno.exit(await main(Deno.args));
}
