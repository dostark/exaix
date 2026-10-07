/**
 * @module SkillFolderLoader
 * @path packages/core/src/skills/skill_folder_loader.ts
 * @description Reads Agent Skills folders from ordered, admitted roots. Every descendant
 *   is confined (no symlinks, real path inside the root), size-capped before parsing and
 *   verified by file identity. Parsing reuses the pure snapshot parser and is cached by
 *   verified content digest only, so an edit is visible on the next call. The first root
 *   that defines a name wins, even when its entry is invalid or inactive.
 * @architectural-layer Core
 * @dependencies [./skill_snapshot.ts, ./skill_types.ts, ../events, @exaix/tool-runtime]
 * @related-files [packages/core/src/skills/skill_revision_store.ts, packages/core/src/skills/skill_types.ts]
 * @visible
 */

import { join } from "@std/path";
import { parse as parseYaml } from "@std/yaml";
import { SkillSidecarSchema } from "@exaix/schemas/skill_folder.ts";
import type { IRuntimeSkill } from "@exaix/schemas/runtime_skill.ts";
import { DomainEventType } from "../events/domain_event_types.ts";
import type { IEventRegistry } from "../events/event_registry.ts";
import {
  DEFAULT_SKILL_FALLBACK_MAX_KEYWORDS,
  DEFAULT_SKILL_FALLBACK_MIN_WORD_CHARS,
  DEFAULT_SKILL_MAIN_MAX_BYTES,
  DEFAULT_SKILL_REFERENCE_MAX_BYTES,
  DEFAULT_SKILL_REFERENCE_MAX_CHARS,
  DEFAULT_SKILL_REFERENCE_MAX_COUNT,
  DEFAULT_SKILL_REFERENCE_TOTAL_MAX_BYTES,
  DEFAULT_SKILL_SIDECAR_MAX_BYTES,
  DEFAULT_SKILL_SNAPSHOT_MAX_BYTES,
} from "../types/constants.ts";
import { SkillDiagnosticReason, SkillDiagnosticSeverity, SkillRootKind, SkillStatus } from "../types/enums.ts";
import {
  analyzeReferenceLinks,
  buildRootContext,
  canonicalizeSkillText,
  computeSkillContentSha256,
  parseSkillSnapshot,
} from "./skill_snapshot.ts";
import type {
  ILoadedSkill,
  IResolvedSkillRoot,
  ISkillDiagnostic,
  ISkillFolderLimits,
  ISkillFolderLoaderDeps,
  ISkillOperationContext,
  ISkillRevisionSnapshot,
} from "./skill_types.ts";

/** Event source id registered by the loader. */
const SKILL_FOLDER_LOADER_SOURCE_ID = "skill-folder-loader";

const SKILL_FILE = "SKILL.md";
const SIDECAR_FILE = "exaix.yaml";
const REFERENCES_DIR = "references";
const IGNORED_ROOT_ENTRIES: readonly string[] = ["README.md", ".exa-skill-state"];
const EXECUTABLE_DIRS: readonly string[] = ["scripts", "assets"];
const LEGACY_SUFFIXES: readonly string[] = [".json", ".skill.md"];
const SKILL_NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SKILL_NAME_MAX_LENGTH = 64;
const REFERENCE_FILE_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*\.md$/;
const MAX_VERIFY_ATTEMPTS = 2;

export const DEFAULT_SKILL_FOLDER_LIMITS: ISkillFolderLimits = {
  mainMaxBytes: DEFAULT_SKILL_MAIN_MAX_BYTES,
  sidecarMaxBytes: DEFAULT_SKILL_SIDECAR_MAX_BYTES,
  referenceMaxBytes: DEFAULT_SKILL_REFERENCE_MAX_BYTES,
  referenceMaxChars: DEFAULT_SKILL_REFERENCE_MAX_CHARS,
  referenceMaxCount: DEFAULT_SKILL_REFERENCE_MAX_COUNT,
  referenceTotalMaxBytes: DEFAULT_SKILL_REFERENCE_TOTAL_MAX_BYTES,
  snapshotMaxBytes: DEFAULT_SKILL_SNAPSHOT_MAX_BYTES,
  fallbackMinWordChars: DEFAULT_SKILL_FALLBACK_MIN_WORD_CHARS,
  fallbackMaxKeywords: DEFAULT_SKILL_FALLBACK_MAX_KEYWORDS,
};

function countCodePoints(text: string): number {
  let count = 0;
  for (const _ of text) count++;
  return count;
}

/** A load failure with the diagnostic reason it maps to. */
class SkillLoadError extends Error {
  constructor(readonly reason: SkillDiagnosticReason, message: string) {
    super(message);
    this.name = "SkillLoadError";
  }
}

interface IFileIdentity {
  size: number;
  ino: number | null;
  dev: number | null;
  mtime: number | null;
}

interface IEntryOutcome {
  /** Set only for an active, valid entry. */
  loaded: ILoadedSkill | null;
  /** Set for any valid entry regardless of lifecycle status, for review and lifecycle reads. */
  parsed: ILoadedSkill | null;
  diagnostic: ISkillDiagnostic | null;
}

interface ICollection {
  winners: Map<string, IEntryOutcome>;
  diagnostics: ISkillDiagnostic[];
}

export class SkillFolderLoader {
  private readonly roots: readonly IResolvedSkillRoot[];
  private readonly deps: ISkillFolderLoaderDeps;
  private readonly registry: IEventRegistry;
  private readonly limits: ISkillFolderLimits;
  private readonly parseCache = new Map<string, IRuntimeSkill>();
  private readonly reportedFailures = new Set<string>();
  private readonly reportedShadows = new Map<string, string>();
  private reportedGeneration: string | null = null;

  constructor(deps: ISkillFolderLoaderDeps, limits: Partial<ISkillFolderLimits> = {}) {
    this.deps = deps;
    this.roots = deps.roots;
    this.registry = deps.eventRegistry;
    this.limits = { ...DEFAULT_SKILL_FOLDER_LIMITS, ...limits };
    this.registry.registerPublisher(SKILL_FOLDER_LOADER_SOURCE_ID, [
      DomainEventType.SkillsLoadFailed,
      DomainEventType.SkillsShadowed,
    ]);
  }

  /** Active, valid skills, ordered by name. */
  async list(ctx: ISkillOperationContext): Promise<ILoadedSkill[]> {
    const collection = await this.collect(ctx, null);
    return [...collection.winners.values()]
      .flatMap((outcome) => outcome.loaded ? [outcome.loaded] : [])
      .sort((a, b) => a.skill.name.localeCompare(b.skill.name));
  }

  /** Every valid skill whatever its status, first-root-wins, ordered by name. For review and lifecycle reads. */
  async listAll(ctx: ISkillOperationContext): Promise<ILoadedSkill[]> {
    const collection = await this.collect(ctx, null);
    return [...collection.winners.values()]
      .flatMap((outcome) => outcome.parsed ? [outcome.parsed] : [])
      .sort((a, b) => a.skill.name.localeCompare(b.skill.name));
  }

  /** One valid skill by name whatever its status, or null. */
  async getAny(name: string, ctx: ISkillOperationContext): Promise<ILoadedSkill | null> {
    const collection = await this.collect(ctx, name);
    return collection.winners.get(name)?.parsed ?? null;
  }

  /** One active, valid skill by name, or null. A masking invalid or inactive entry yields null. */
  async get(name: string, ctx: ISkillOperationContext): Promise<ILoadedSkill | null> {
    const collection = await this.collect(ctx, name);
    return collection.winners.get(name)?.loaded ?? null;
  }

  /** Invalid, inactive, masked and missing-root outcomes, without bodies or host paths. */
  async diagnostics(ctx: ISkillOperationContext): Promise<ISkillDiagnostic[]> {
    return (await this.collect(ctx, null)).diagnostics;
  }

  private async collect(ctx: ISkillOperationContext, onlyName: string | null): Promise<ICollection> {
    this.resetReportingForGeneration(ctx.configGeneration);
    const winners = new Map<string, IEntryOutcome>();
    const shadowedPaths = new Map<string, string[]>();
    const diagnostics: ISkillDiagnostic[] = [];
    for (const root of this.roots) {
      const scan = () => this.scanRoot(root, onlyName, winners, shadowedPaths, diagnostics);
      await (this.deps.readLock ? this.deps.readLock(root, scan) : scan());
    }
    for (const outcome of winners.values()) {
      if (outcome.diagnostic) diagnostics.push(outcome.diagnostic);
    }
    for (const diagnostic of diagnostics) await this.reportFailure(ctx, diagnostic);
    for (const [name, paths] of shadowedPaths) {
      const winnerPath = winners.get(name)?.loaded?.sourcePath ?? winners.get(name)?.diagnostic?.safe_path ?? name;
      for (const path of paths) {
        diagnostics.push({
          name,
          root_kind: SkillRootKind.BLUEPRINT,
          safe_path: path,
          reason: SkillDiagnosticReason.UNAVAILABLE,
          severity: SkillDiagnosticSeverity.WARNING,
        });
      }
      await this.reportShadow(ctx, name, winnerPath, paths);
    }
    return { winners, diagnostics };
  }

  private async scanRoot(
    root: IResolvedSkillRoot,
    onlyName: string | null,
    winners: Map<string, IEntryOutcome>,
    shadowedPaths: Map<string, string[]>,
    diagnostics: ISkillDiagnostic[],
  ): Promise<void> {
    let realRoot: string;
    try {
      realRoot = await Deno.realPath(root.path);
    } catch {
      diagnostics.push(this.diagnostic(null, root.kind, rootLabel(root), SkillDiagnosticReason.ROOT_MISSING));
      return;
    }
    const names: string[] = [];
    for await (const entry of Deno.readDir(realRoot)) names.push(entry.name);
    for (const entryName of names.sort()) {
      if (IGNORED_ROOT_ENTRIES.includes(entryName)) continue;
      if (onlyName !== null && entryName !== onlyName) continue;
      const entryPath = join(realRoot, entryName);
      const stat = await Deno.lstat(entryPath);
      if (stat.isSymlink) {
        diagnostics.push(
          this.diagnostic(validName(entryName) ? entryName : null, root.kind, entryName, SkillDiagnosticReason.SYMLINK),
        );
        continue;
      }
      if (stat.isFile) {
        if (LEGACY_SUFFIXES.some((suffix) => entryName.endsWith(suffix))) {
          diagnostics.push(this.diagnostic(null, root.kind, entryName, SkillDiagnosticReason.LEGACY_LAYOUT));
        }
        continue;
      }
      if (!stat.isDirectory) continue;
      if (!validName(entryName)) {
        diagnostics.push(this.diagnostic(null, root.kind, entryName, SkillDiagnosticReason.INVALID_NAME));
        continue;
      }
      if (winners.has(entryName)) {
        shadowedPaths.set(entryName, [...(shadowedPaths.get(entryName) ?? []), entryName]);
        continue;
      }
      winners.set(entryName, await this.loadEntry(root, realRoot, entryName));
    }
  }

  private async loadEntry(root: IResolvedSkillRoot, realRoot: string, name: string): Promise<IEntryOutcome> {
    try {
      const loaded = await this.loadWithRetry(root, realRoot, name);
      if (loaded.skill.status !== SkillStatus.ACTIVE) {
        return {
          loaded: null,
          parsed: loaded,
          diagnostic: this.diagnostic(
            name,
            root.kind,
            name,
            SkillDiagnosticReason.INACTIVE,
            SkillDiagnosticSeverity.WARNING,
          ),
        };
      }
      return { loaded, parsed: loaded, diagnostic: null };
    } catch (error) {
      const reason = error instanceof SkillLoadError ? error.reason : SkillDiagnosticReason.UNAVAILABLE;
      return { loaded: null, parsed: null, diagnostic: this.diagnostic(name, root.kind, name, reason) };
    }
  }

  private async loadWithRetry(root: IResolvedSkillRoot, realRoot: string, name: string): Promise<ILoadedSkill> {
    for (let attempt = 1; attempt <= MAX_VERIFY_ATTEMPTS; attempt += 1) {
      try {
        return await this.loadFolder(root, realRoot, name);
      } catch (error) {
        const retryable = error instanceof SkillLoadError && error.reason === SkillDiagnosticReason.FILESYSTEM_CHANGED;
        if (!retryable || attempt === MAX_VERIFY_ATTEMPTS) throw error;
      }
    }
    throw new SkillLoadError(SkillDiagnosticReason.FILESYSTEM_CHANGED, "unreachable");
  }

  private async loadFolder(root: IResolvedSkillRoot, realRoot: string, name: string): Promise<ILoadedSkill> {
    const dir = join(realRoot, name);
    await this.confine(dir, realRoot);
    const children = await listDir(dir);
    for (const child of children) {
      if (child.isSymlink) throw new SkillLoadError(SkillDiagnosticReason.SYMLINK, `${name}/${child.name}`);
      if (child.isDirectory && EXECUTABLE_DIRS.includes(child.name)) {
        throw new SkillLoadError(SkillDiagnosticReason.EXECUTABLE_CONTENT, `${name}/${child.name}`);
      }
    }
    const names = new Set(children.map((child) => child.name));
    if (!names.has(SKILL_FILE)) {
      throw new SkillLoadError(SkillDiagnosticReason.INVALID_FRONTMATTER, "SKILL.md is missing");
    }
    const skillMd = await this.readText(
      join(dir, SKILL_FILE),
      this.limits.mainMaxBytes,
      SkillDiagnosticReason.INVALID_FRONTMATTER,
    );
    const sidecar = names.has(SIDECAR_FILE)
      ? await this.readText(join(dir, SIDECAR_FILE), this.limits.sidecarMaxBytes, SkillDiagnosticReason.INVALID_SIDECAR)
      : null;
    const references = names.has(REFERENCES_DIR) ? await this.readReferences(join(dir, REFERENCES_DIR)) : [];
    const snapshot: ISkillRevisionSnapshot = {
      skill_md: skillMd.text,
      exaix_yaml: sidecar?.text ?? null,
      references: references.map((r) => ({ path: r.path, content: r.text })),
    };
    this.enforceAggregate(skillMd.bytes + (sidecar?.bytes ?? 0), references);
    await this.verifyUnchanged(dir, [
      join(dir, SKILL_FILE),
      ...(sidecar ? [join(dir, SIDECAR_FILE)] : []),
      ...references.map((r) => join(dir, r.path)),
    ], [skillMd.identity, ...(sidecar ? [sidecar.identity] : []), ...references.map((r) => r.identity)]);

    const skill = await this.parse(snapshot, root, name);
    const { linked, unsupported } = analyzeReferenceLinks(snapshot.skill_md);
    if (unsupported.length > 0) throw new SkillLoadError(SkillDiagnosticReason.REFERENCE_INVALID, name);
    const present = new Set(snapshot.references.map((r) => r.path));
    if (linked.some((path) => !present.has(path))) {
      throw new SkillLoadError(SkillDiagnosticReason.REFERENCE_MISSING, name);
    }
    return {
      skill,
      revisionId: skill.id,
      contentSha256: skill.content_sha256,
      rootKind: root.kind,
      sourcePath: name,
      snapshot: { ...snapshot, skill_md: canonicalizeSkillText(snapshot.skill_md) },
    };
  }

  private async confine(path: string, realRoot: string): Promise<void> {
    try {
      await this.deps.pathSecurity.resolveWithinRoots(path, [realRoot], realRoot);
    } catch {
      throw new SkillLoadError(SkillDiagnosticReason.PATH_ESCAPE, "path escapes the admitted root");
    }
  }

  private async readReferences(
    refsDir: string,
  ): Promise<Array<{ path: string; text: string; bytes: number; identity: IFileIdentity }>> {
    const entries = await listDir(refsDir);
    if (entries.length > this.limits.referenceMaxCount) {
      throw new SkillLoadError(SkillDiagnosticReason.SIZE_LIMIT, "too many references");
    }
    const out: Array<{ path: string; text: string; bytes: number; identity: IFileIdentity }> = [];
    for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (entry.isSymlink) throw new SkillLoadError(SkillDiagnosticReason.SYMLINK, entry.name);
      if (!entry.isFile || !REFERENCE_FILE_PATTERN.test(entry.name)) {
        throw new SkillLoadError(SkillDiagnosticReason.REFERENCE_INVALID, entry.name);
      }
      const read = await this.readText(
        join(refsDir, entry.name),
        this.limits.referenceMaxBytes,
        SkillDiagnosticReason.REFERENCE_INVALID,
      );
      if (countCodePoints(read.text) > this.limits.referenceMaxChars) {
        throw new SkillLoadError(SkillDiagnosticReason.SIZE_LIMIT, "reference exceeds the character cap");
      }
      out.push({ path: `${REFERENCES_DIR}/${entry.name}`, ...read });
    }
    return out;
  }

  private enforceAggregate(
    fixedBytes: number,
    references: ReadonlyArray<{ bytes: number }>,
  ): void {
    const referenceBytes = references.reduce((sum, r) => sum + r.bytes, 0);
    if (
      referenceBytes > this.limits.referenceTotalMaxBytes || fixedBytes + referenceBytes > this.limits.snapshotMaxBytes
    ) {
      throw new SkillLoadError(SkillDiagnosticReason.SIZE_LIMIT, "aggregate size cap exceeded");
    }
  }

  /** Pre-read lstat size, bounded read with one-byte overflow detection, fatal UTF-8 decode. */
  private async readText(
    path: string,
    maxBytes: number,
    invalidReason: SkillDiagnosticReason,
  ): Promise<{ text: string; bytes: number; identity: IFileIdentity }> {
    const before = await Deno.lstat(path);
    if (before.isSymlink) throw new SkillLoadError(SkillDiagnosticReason.SYMLINK, "symlink");
    if (!before.isFile) throw new SkillLoadError(invalidReason, "not a regular file");
    if (before.size > maxBytes) throw new SkillLoadError(SkillDiagnosticReason.SIZE_LIMIT, "file exceeds cap");
    const file = await Deno.open(path, { read: true });
    try {
      const opened = await file.stat();
      if (!sameIdentity(identityOf(before), identityOf(opened))) {
        throw new SkillLoadError(SkillDiagnosticReason.FILESYSTEM_CHANGED, "identity changed");
      }
      const buffer = new Uint8Array(maxBytes + 1);
      let total = 0;
      while (total < buffer.length) {
        const read = await file.read(buffer.subarray(total));
        if (read === null) break;
        total += read;
      }
      if (total > maxBytes) throw new SkillLoadError(SkillDiagnosticReason.SIZE_LIMIT, "file exceeds cap");
      let text: string;
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, total));
        canonicalizeSkillText(text);
      } catch {
        throw new SkillLoadError(invalidReason, "content is not valid canonical UTF-8 text");
      }
      return { text, bytes: total, identity: identityOf(before) };
    } finally {
      file.close();
    }
  }

  private async verifyUnchanged(
    dir: string,
    paths: readonly string[],
    identities: readonly IFileIdentity[],
  ): Promise<void> {
    const after = await listDir(dir);
    if (after.some((child) => child.isSymlink)) {
      throw new SkillLoadError(SkillDiagnosticReason.FILESYSTEM_CHANGED, "descendant became a symlink");
    }
    for (let i = 0; i < paths.length; i += 1) {
      let current: IFileIdentity;
      try {
        current = identityOf(await Deno.lstat(paths[i]));
      } catch {
        throw new SkillLoadError(SkillDiagnosticReason.FILESYSTEM_CHANGED, "file disappeared");
      }
      if (!sameIdentity(identities[i], current)) {
        throw new SkillLoadError(SkillDiagnosticReason.FILESYSTEM_CHANGED, "file changed while reading");
      }
    }
  }

  private async parse(
    snapshot: ISkillRevisionSnapshot,
    root: IResolvedSkillRoot,
    name: string,
  ): Promise<IRuntimeSkill> {
    let digest: string;
    try {
      digest = await computeSkillContentSha256(snapshot);
    } catch {
      throw new SkillLoadError(SkillDiagnosticReason.INVALID_FRONTMATTER, "content is not canonical text");
    }
    const key = `${root.kind}|${root.project ?? ""}|${name}|${digest}`;
    const cached = this.parseCache.get(key);
    if (cached) return cached;
    try {
      const skill = await parseSkillSnapshot(snapshot, buildRootContext(root, name), {
        minWordChars: this.limits.fallbackMinWordChars,
        maxKeywords: this.limits.fallbackMaxKeywords,
      });
      this.parseCache.set(key, skill);
      return skill;
    } catch {
      throw new SkillLoadError(
        sidecarIsInvalid(snapshot) ? SkillDiagnosticReason.INVALID_SIDECAR : SkillDiagnosticReason.INVALID_FRONTMATTER,
        name,
      );
    }
  }

  private diagnostic(
    name: string | null,
    rootKind: SkillRootKind,
    safePath: string,
    reason: SkillDiagnosticReason,
    severity: SkillDiagnosticSeverity = reason === SkillDiagnosticReason.ROOT_MISSING
      ? SkillDiagnosticSeverity.WARNING
      : SkillDiagnosticSeverity.ERROR,
  ): ISkillDiagnostic {
    return { name, root_kind: rootKind, safe_path: safePath, reason, severity };
  }

  private resetReportingForGeneration(generation: string): void {
    if (this.reportedGeneration === generation) return;
    this.reportedGeneration = generation;
    this.reportedFailures.clear();
  }

  private async reportFailure(ctx: ISkillOperationContext, d: ISkillDiagnostic): Promise<void> {
    if (d.reason === SkillDiagnosticReason.INACTIVE) return;
    const key = `${d.root_kind}|${d.safe_path}|${d.reason}`;
    if (this.reportedFailures.has(key)) return;
    this.reportedFailures.add(key);
    await this.registry.emit(
      SKILL_FOLDER_LOADER_SOURCE_ID,
      DomainEventType.SkillsLoadFailed,
      { ...identityOf2(ctx), name: d.name, root_kind: d.root_kind, safe_path: d.safe_path, reason: d.reason },
      ctx.traceId,
    );
  }

  private async reportShadow(
    ctx: ISkillOperationContext,
    name: string,
    winnerPath: string,
    shadowed: string[],
  ): Promise<void> {
    const fingerprint = `${winnerPath}|${shadowed.join(",")}`;
    if (this.reportedShadows.get(name) === fingerprint) return;
    this.reportedShadows.set(name, fingerprint);
    await this.registry.emit(
      SKILL_FOLDER_LOADER_SOURCE_ID,
      DomainEventType.SkillsShadowed,
      { ...identityOf2(ctx), name, winner_path: winnerPath, shadowed_paths: shadowed },
      ctx.traceId,
    );
  }
}

function identityOf2(ctx: ISkillOperationContext) {
  return {
    request_id: ctx.requestId,
    flow_id: ctx.flowId,
    flow_step_id: ctx.flowStepId,
    agent_role: ctx.agentRole,
    config_generation: ctx.configGeneration,
  };
}

function rootLabel(root: IResolvedSkillRoot): string {
  const trimmed = root.path.replace(/\/+$/, "");
  return trimmed.slice(trimmed.lastIndexOf("/") + 1);
}

function validName(name: string): boolean {
  return name.length <= SKILL_NAME_MAX_LENGTH && SKILL_NAME_PATTERN.test(name);
}

async function listDir(dir: string): Promise<Array<Deno.FileInfo & { name: string }>> {
  const out: Array<Deno.FileInfo & { name: string }> = [];
  for await (const entry of Deno.readDir(dir)) {
    out.push({ ...(await Deno.lstat(join(dir, entry.name))), name: entry.name });
  }
  return out;
}

function identityOf(info: Deno.FileInfo): IFileIdentity {
  return { size: info.size, ino: info.ino, dev: info.dev, mtime: info.mtime?.getTime() ?? null };
}

function sameIdentity(a: IFileIdentity, b: IFileIdentity): boolean {
  return a.size === b.size && a.ino === b.ino && a.dev === b.dev && a.mtime === b.mtime;
}

function sidecarIsInvalid(snapshot: ISkillRevisionSnapshot): boolean {
  if (snapshot.exaix_yaml === null) return false;
  try {
    SkillSidecarSchema.parse(parseYaml(canonicalizeSkillText(snapshot.exaix_yaml)));
    return false;
  } catch {
    return true;
  }
}
