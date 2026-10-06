/**
 * @module SkillFolderPublisher
 * @path packages/core/src/skills/skill_folder_publisher.ts
 * @description Guarded publication of skill folders into writable roots. Each mutation
 *   builds a complete staging directory, records a durable intent file, then swaps with
 *   same-filesystem renames while holding an OS advisory lock shared by every loader and
 *   service process. Recovery after a process crash either finishes the intended
 *   revision, restores the verified backup or removes an incomplete create.
 * @architectural-layer Core
 * @dependencies [@std/path, ./skill_snapshot.ts, ./skill_types.ts, @exaix/tool-runtime]
 * @related-files [packages/core/src/skills/skills.ts, packages/core/src/skills/skill_folder_loader.ts]
 */

import { join } from "@std/path";
import type { IPathSecurityOps } from "@exaix/tool-runtime";
import { SkillMutationErrorCode, SkillPublicationOperation } from "../types/enums.ts";
import { computeSkillContentSha256 } from "./skill_snapshot.ts";
import { type ISkillRevisionSnapshot, SkillMutationError } from "./skill_types.ts";

const STATE_DIR = ".exa-skill-state";
const LOCK_FILE = "lock";
const STAGING_DIR = "staging";
const BACKUP_DIR = "backup";
const INTENT_DIR = "intents";
const SKILL_FILE = "SKILL.md";
const SIDECAR_FILE = "exaix.yaml";
const REFERENCES_DIR = "references";
const DEFAULT_LOCK_TIMEOUT_MS = 5_000;

/** Durable record of one in-flight publication, written before any rename. */
interface IPublicationIntent {
  operation: SkillPublicationOperation;
  name: string;
  destination: string;
  staging: string | null;
  backup: string | null;
  intended_sha256: string | null;
}

export type SkillLockMode = "shared" | "exclusive";

/** Reads a skill directory back into a snapshot without caps, for verifying folders this module wrote. */
async function readFolderSnapshot(dir: string): Promise<ISkillRevisionSnapshot> {
  const skillMd = await Deno.readTextFile(join(dir, SKILL_FILE));
  let sidecar: string | null = null;
  try {
    sidecar = await Deno.readTextFile(join(dir, SIDECAR_FILE));
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
  const references: Array<{ path: string; content: string }> = [];
  try {
    for await (const entry of Deno.readDir(join(dir, REFERENCES_DIR))) {
      references.push({
        path: `${REFERENCES_DIR}/${entry.name}`,
        content: await Deno.readTextFile(join(dir, REFERENCES_DIR, entry.name)),
      });
    }
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
  return { skill_md: skillMd, exaix_yaml: sidecar, references };
}

async function writeSynced(path: string, text: string): Promise<void> {
  const file = await Deno.open(path, { create: true, write: true, truncate: true });
  try {
    await file.write(new TextEncoder().encode(text));
    await file.sync();
  } finally {
    file.close();
  }
}

async function syncDir(path: string): Promise<void> {
  const dir = await Deno.open(path, { read: true });
  try {
    await dir.sync();
  } finally {
    dir.close();
  }
}

async function removeIfPresent(path: string | null): Promise<void> {
  if (path === null) return;
  await Deno.remove(path, { recursive: true }).catch((error: Error) => {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  });
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await Deno.lstat(path);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}

function unavailable(message: string): SkillMutationError {
  return new SkillMutationError(SkillMutationErrorCode.PUBLICATION_UNAVAILABLE, message);
}

export class SkillFolderPublisher {
  constructor(
    private readonly pathSecurity: IPathSecurityOps,
    private readonly lockTimeoutMs: number = DEFAULT_LOCK_TIMEOUT_MS,
  ) {}

  /** Creates the reserved state directories and the stable lock file for one writable root. */
  async ensureState(root: string): Promise<void> {
    const state = join(root, STATE_DIR);
    await Deno.mkdir(root, { recursive: true });
    await Deno.mkdir(state, { recursive: true });
    const info = await Deno.lstat(state);
    if (info.isSymlink || !info.isDirectory) throw unavailable("skill state directory is not a plain directory");
    for (const child of [STAGING_DIR, BACKUP_DIR, INTENT_DIR]) {
      await Deno.mkdir(join(state, child), { recursive: true });
    }
    const lock = join(state, LOCK_FILE);
    if (await pathExists(lock)) {
      if ((await Deno.lstat(lock)).isSymlink) throw unavailable("skill lock file is a symlink");
    } else {
      await writeSynced(lock, "");
    }
  }

  /** Runs `fn` while holding the lock of every root, acquired in canonical path order. */
  async withLocks<T>(roots: readonly string[], mode: SkillLockMode, fn: () => Promise<T>): Promise<T> {
    const held: Deno.FsFile[] = [];
    try {
      for (const root of [...new Set(roots)].sort()) {
        const file = await Deno.open(join(root, STATE_DIR, LOCK_FILE), { read: true, write: true });
        try {
          await this.acquire(file, mode);
        } catch (error) {
          file.close();
          throw error;
        }
        held.push(file);
      }
      return await fn();
    } finally {
      for (const file of held.reverse()) {
        await file.unlock().catch(() => {});
        file.close();
      }
    }
  }

  private async acquire(file: Deno.FsFile, mode: SkillLockMode): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(unavailable("timed out waiting for the skill root lock")), this.lockTimeoutMs);
    });
    try {
      await Promise.race([file.lock(mode === "exclusive"), timeout]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  /** Publishes a new folder. The caller holds the exclusive locks and has verified the name is free. */
  async create(root: string, name: string, snapshot: ISkillRevisionSnapshot): Promise<void> {
    const destination = join(root, name);
    await this.confine(root, destination);
    if (await pathExists(destination)) {
      throw new SkillMutationError(SkillMutationErrorCode.NAME_CONFLICT, `skill "${name}" already exists`);
    }
    const operationId = crypto.randomUUID();
    const staging = await this.stage(root, operationId, snapshot);
    const intent: IPublicationIntent = {
      operation: SkillPublicationOperation.CREATE,
      name,
      destination,
      staging,
      backup: null,
      intended_sha256: await computeSkillContentSha256(snapshot),
    };
    await this.writeIntent(root, operationId, intent);
    await this.confine(root, destination);
    await Deno.rename(staging, destination);
    await syncDir(root);
    await this.clearIntent(root, operationId);
  }

  /** Replaces an existing folder, keeping a hidden backup until the new folder is in place. */
  async replace(root: string, name: string, snapshot: ISkillRevisionSnapshot): Promise<void> {
    const destination = join(root, name);
    await this.confine(root, destination);
    await this.requirePlainDirectory(destination, name);
    const operationId = crypto.randomUUID();
    const staging = await this.stage(root, operationId, snapshot);
    const backup = join(root, STATE_DIR, BACKUP_DIR, operationId);
    const intent: IPublicationIntent = {
      operation: SkillPublicationOperation.UPDATE,
      name,
      destination,
      staging,
      backup,
      intended_sha256: await computeSkillContentSha256(snapshot),
    };
    await this.writeIntent(root, operationId, intent);
    await this.confine(root, destination);
    await Deno.rename(destination, backup);
    await Deno.rename(staging, destination);
    await syncDir(root);
    await removeIfPresent(backup);
    await this.clearIntent(root, operationId);
  }

  /** Removes a complete folder through the same intent and backup protocol. */
  async remove(root: string, name: string): Promise<void> {
    const destination = join(root, name);
    await this.confine(root, destination);
    await this.requirePlainDirectory(destination, name);
    const operationId = crypto.randomUUID();
    const backup = join(root, STATE_DIR, BACKUP_DIR, operationId);
    await this.writeIntent(root, operationId, {
      operation: SkillPublicationOperation.DELETE,
      name,
      destination,
      staging: null,
      backup,
      intended_sha256: null,
    });
    await this.confine(root, destination);
    await Deno.rename(destination, backup);
    await syncDir(root);
    await removeIfPresent(backup);
    await this.clearIntent(root, operationId);
  }

  /** Finishes or rolls back interrupted publications. Returns the number of intents resolved. */
  async recover(root: string): Promise<number> {
    const intents = join(root, STATE_DIR, INTENT_DIR);
    let resolved = 0;
    for await (const entry of Deno.readDir(intents)) {
      const intent = JSON.parse(await Deno.readTextFile(join(intents, entry.name))) as IPublicationIntent;
      await this.resolveIntent(intent);
      await Deno.remove(join(intents, entry.name));
      resolved += 1;
    }
    return resolved;
  }

  private async resolveIntent(intent: IPublicationIntent): Promise<void> {
    const destinationVerifies = await this.destinationHasDigest(intent);
    if (intent.operation === SkillPublicationOperation.DELETE) {
      await removeIfPresent(intent.backup);
      return;
    }
    if (destinationVerifies) {
      await removeIfPresent(intent.staging);
      await removeIfPresent(intent.backup);
      return;
    }
    await removeIfPresent(intent.staging);
    if (intent.backup !== null && await pathExists(intent.backup)) {
      await removeIfPresent(intent.destination);
      await Deno.rename(intent.backup, intent.destination);
      return;
    }
    if (intent.operation === SkillPublicationOperation.CREATE) await removeIfPresent(intent.destination);
  }

  private async destinationHasDigest(intent: IPublicationIntent): Promise<boolean> {
    if (intent.intended_sha256 === null || !(await pathExists(intent.destination))) return false;
    try {
      return await computeSkillContentSha256(await readFolderSnapshot(intent.destination)) === intent.intended_sha256;
    } catch {
      return false;
    }
  }

  private async stage(root: string, operationId: string, snapshot: ISkillRevisionSnapshot): Promise<string> {
    const staging = join(root, STATE_DIR, STAGING_DIR, operationId);
    await Deno.mkdir(staging, { recursive: true });
    await writeSynced(join(staging, SKILL_FILE), snapshot.skill_md);
    if (snapshot.exaix_yaml !== null) await writeSynced(join(staging, SIDECAR_FILE), snapshot.exaix_yaml);
    if (snapshot.references.length > 0) {
      await Deno.mkdir(join(staging, REFERENCES_DIR));
      for (const reference of snapshot.references) {
        await writeSynced(join(staging, reference.path), reference.content);
      }
    }
    await syncDir(staging);
    return staging;
  }

  private async writeIntent(root: string, operationId: string, intent: IPublicationIntent): Promise<void> {
    await writeSynced(join(root, STATE_DIR, INTENT_DIR, `${operationId}.json`), JSON.stringify(intent));
    await syncDir(join(root, STATE_DIR, INTENT_DIR));
  }

  private async clearIntent(root: string, operationId: string): Promise<void> {
    await Deno.remove(join(root, STATE_DIR, INTENT_DIR, `${operationId}.json`));
    await syncDir(join(root, STATE_DIR, INTENT_DIR));
  }

  private async confine(root: string, path: string): Promise<void> {
    try {
      const realRoot = await Deno.realPath(root);
      await this.pathSecurity.resolveWithinRoots(path, [realRoot], realRoot);
    } catch {
      throw new SkillMutationError(SkillMutationErrorCode.ROOT_UNAVAILABLE, "skill path escapes the admitted root");
    }
  }

  private async requirePlainDirectory(path: string, name: string): Promise<void> {
    try {
      const info = await Deno.lstat(path);
      if (info.isSymlink || !info.isDirectory) {
        throw new SkillMutationError(SkillMutationErrorCode.ROOT_UNAVAILABLE, `skill "${name}" is not a plain folder`);
      }
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        throw new SkillMutationError(SkillMutationErrorCode.NOT_FOUND, `skill "${name}" does not exist`);
      }
      throw error;
    }
  }
}
