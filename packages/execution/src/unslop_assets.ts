/**
 * @module UnslopAssets
 * @path packages/execution/src/unslop_assets.ts
 * @description Loads bounded verified lint assets and immutable original-base catalog policy.
 * @architectural-layer Services
 * @dependencies [@std/path, @exaix/core, @exaix/git, @exaix/schemas]
 * @related-files [packages/execution/src/unslop_check_runner.ts, packages/execution/tests/unslop_check_runner_test.ts]
 */

import { join } from "@std/path";
import {
  UNSLOP_DENO_PACK,
  UNSLOP_PORTAL_ASSET_DIR,
  UNSLOP_PORTAL_CATALOG_FILENAME,
  UNSLOP_PORTAL_DENO_CATALOG_FILENAME,
  UNSLOP_PORTAL_ENGINE_FILENAME,
  UNSLOP_PORTAL_MANIFEST_FILENAME,
  UNSLOP_TS_PACK,
} from "@exaix/core";
import { decodeUtf8, readBlobAtCommit } from "@exaix/git";
import { UnslopErrorClass } from "@exaix/schemas";
import type { IUnslopCheckContext, IUnslopCheckRunnerOptions } from "./unslop_check_types.ts";
import { UnslopCheckError } from "./unslop_check_error.ts";
import { readUnslopFile } from "./unslop_source_snapshot.ts";
import { assertUnslopTrustedRoot } from "./unslop_trust.ts";

const SUPPORTED_MANIFEST_FORMAT = 1;
const SUPPORTED_POLICY_VERSION = 1;

/** One packaged manifest entry. */
interface IManifestEntry {
  readonly sha256: string;
  readonly bytes: number;
}

/** The packaged provenance manifest. */
interface IAssetManifest {
  readonly format_version: number;
  readonly policy_version: number;
  readonly files: Readonly<Record<string, IManifestEntry>>;
}

/** Trusted assets of one invocation. */
export interface IUnslopAssets {
  readonly engineBytes: Uint8Array;
  readonly catalogBytes: Uint8Array;
  readonly ruleIds: ReadonlySet<string>;
  readonly packs: readonly string[];
}

function sha256Hex(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return crypto.subtle.digest("SHA-256", copy).then((digest) =>
    [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")
  );
}

/** Loads and verifies the packaged engine, catalog and manifest. */
export async function loadUnslopAssets(
  context: IUnslopCheckContext,
  options: IUnslopCheckRunnerOptions,
): Promise<IUnslopAssets | { error_class: UnslopErrorClass }> {
  const packs = context.check.packs ?? [UNSLOP_TS_PACK];
  const catalogName = packs.includes(UNSLOP_DENO_PACK)
    ? UNSLOP_PORTAL_DENO_CATALOG_FILENAME
    : UNSLOP_PORTAL_CATALOG_FILENAME;
  const assetDir = await trustedAssetDirectory(context, options);
  let manifest: IAssetManifest;
  try {
    const bytes = await readUnslopFile(
      join(assetDir, UNSLOP_PORTAL_MANIFEST_FILENAME),
      options.settings.catalog_max_bytes,
    );
    if (bytes === null) return { error_class: UnslopErrorClass.ASSET_INVALID };
    manifest = JSON.parse(new TextDecoder().decode(bytes));
  } catch (error) {
    if (error instanceof UnslopCheckError) throw error;
    return { error_class: UnslopErrorClass.ASSET_INVALID };
  }
  if (manifest.format_version !== SUPPORTED_MANIFEST_FORMAT || manifest.policy_version !== SUPPORTED_POLICY_VERSION) {
    return { error_class: UnslopErrorClass.ASSET_INVALID };
  }
  const engineEntry = manifest.files[UNSLOP_PORTAL_ENGINE_FILENAME];
  const catalogEntry = manifest.files[catalogName];
  if (engineEntry === undefined) return { error_class: UnslopErrorClass.ENGINE_MISSING };
  if (catalogEntry === undefined) return { error_class: UnslopErrorClass.ASSET_INVALID };

  try {
    await Deno.stat(join(assetDir, UNSLOP_PORTAL_ENGINE_FILENAME));
  } catch {
    return { error_class: UnslopErrorClass.ENGINE_MISSING };
  }
  const engineBytes = await readVerifiedAsset(assetDir, UNSLOP_PORTAL_ENGINE_FILENAME, engineEntry, options);
  if (engineBytes === null) return { error_class: UnslopErrorClass.ASSET_INVALID };
  const packagedCatalog = await readVerifiedAsset(assetDir, catalogName, catalogEntry, options);
  if (packagedCatalog === null) return { error_class: UnslopErrorClass.ASSET_INVALID };
  const packagedRuleIds = parseCatalogRuleIds(packagedCatalog);
  if (packagedRuleIds === null) return { error_class: UnslopErrorClass.CATALOG_INVALID };
  const replacement = await readReplacementCatalog(context, packagedRuleIds, options);
  if (replacement === false) return { error_class: UnslopErrorClass.CATALOG_INVALID };
  if (replacement === undefined) {
    return { engineBytes, catalogBytes: packagedCatalog, ruleIds: packagedRuleIds, packs };
  }
  return { engineBytes, catalogBytes: replacement.bytes, ruleIds: replacement.ruleIds, packs };
}

/** Reads and validates an optional replacement catalog from the immutable base commit. */
async function readReplacementCatalog(
  context: IUnslopCheckContext,
  packagedRuleIds: ReadonlySet<string>,
  options: IUnslopCheckRunnerOptions,
): Promise<{ bytes: Uint8Array; ruleIds: ReadonlySet<string> } | false | undefined> {
  const path = context.check.catalog;
  if (path === undefined) return undefined;
  const blob = await readBlobAtCommit(context.git, context.baseSha, path, {
    maxBytes: options.settings.catalog_max_bytes,
    timeoutMs: context.timeoutMs,
  });
  if (!blob.ok) return false;
  const text = decodeUtf8(blob.value.bytes);
  if (text === null) return false;
  const ruleIds = parseReplacementCatalog(text, packagedRuleIds);
  if (ruleIds === null) return false;
  return { bytes: blob.value.bytes, ruleIds };
}

/** Reads one asset and compares its bytes and hash with the manifest. */
async function readVerifiedAsset(
  dir: string,
  name: string,
  entry: IManifestEntry,
  options: IUnslopCheckRunnerOptions,
): Promise<Uint8Array | null> {
  let bytes: Uint8Array;
  try {
    const path = await options.pathResolver.validatePath(join(dir, name), [dir]);
    const limit = name === UNSLOP_PORTAL_ENGINE_FILENAME
      ? options.settings.json_max_bytes
      : options.settings.catalog_max_bytes;
    if (entry.bytes > limit) throw new UnslopCheckError(UnslopErrorClass.LIMIT_EXCEEDED);
    const read = await readUnslopFile(path, entry.bytes);
    if (read === null) return null;
    bytes = read;
  } catch (error) {
    if (error instanceof UnslopCheckError) throw error;
    return null;
  }
  if (bytes.byteLength !== entry.bytes) return null;
  return (await sha256Hex(bytes)) === entry.sha256 ? bytes : null;
}

/** Extracts the selected catalog rule ids. Null means invalid catalog JSON. */
function parseCatalogRuleIds(bytes: Uint8Array): ReadonlySet<string> | null {
  const text = decodeUtf8(bytes);
  if (text === null) return null;
  let document: unknown;
  try {
    document = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof document !== "object" || document === null) return null;
  const rules = (document as Record<string, unknown>).rules;
  if (typeof rules !== "object" || rules === null) return null;
  return new Set(Object.keys(rules));
}

/** Validates a legacy replacement catalog structurally. Null means the document is rejected. */
function parseReplacementCatalog(
  text: string,
  packagedRuleIds: ReadonlySet<string>,
): ReadonlySet<string> | null {
  let document: unknown;
  try {
    document = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof document !== "object" || document === null) return null;
  const record = document as Record<string, unknown>;
  if ("layout" in record || "wholeTree" in record) return null;
  if (typeof record.rules !== "object" || record.rules === null) return null;
  const rules = record.rules as Record<string, unknown>;
  const ruleIds = new Set<string>();
  for (const [id, entry] of Object.entries(rules)) {
    if (!packagedRuleIds.has(id)) return null;
    if (typeof entry !== "object" || entry === null) return null;
    if ((entry as Record<string, unknown>).engine !== "plugin") return null;
    ruleIds.add(id);
  }
  return ruleIds.size > 0 ? ruleIds : null;
}

/** Resolves the trusted asset directory before reading any policy bytes. */
async function trustedAssetDirectory(
  context: IUnslopCheckContext,
  options: IUnslopCheckRunnerOptions,
): Promise<string> {
  const trustedRoot = join(options.systemRoot, UNSLOP_PORTAL_ASSET_DIR);
  try {
    const assetDir = await options.pathResolver.validatePath(
      join(options.systemRoot, options.settings.asset_dir),
      [trustedRoot],
    );
    await assertUnslopTrustedRoot(assetDir, context, options);
    if ((await Deno.lstat(assetDir)).isSymlink) throw new UnslopCheckError(UnslopErrorClass.ASSET_INVALID);
    return assetDir;
  } catch (error) {
    if (error instanceof UnslopCheckError) throw error;
    throw new UnslopCheckError(UnslopErrorClass.ASSET_INVALID);
  }
}
