/**
 * @module BlueprintResolver
 * @path packages/request/src/blueprint_resolver.ts
 * @description Resolves an identity's blueprint from the configured
 * blueprintsPath, falling back to a Blueprints/Agents directory walked
 * upward from the current working directory, then to the repository root and
 * module-relative root. Extracted from RequestProcessor (god-object
 * decomposition, .copilot/skills/refactor/SKILL.md step d) since this logic
 * depends only on a blueprintsPath string and ambient process state
 * (Deno.cwd(), import.meta.url) — no RequestProcessor field beyond
 * blueprintsPath.
 * @architectural-layer Services
 * @related-files ["packages/request/src/processor.ts", "packages/core/src/blueprint/blueprint_loader.ts"]
 */
import { dirname, join } from "@std/path";
import { DEFAULT_AGENTS_PATH } from "@exaix/core";
import { DomainEventType } from "@exaix/core/events";
import type { IEventLogger } from "@exaix/core/logger";
import { IBlueprintLoader, type ILoadedBlueprint } from "@exaix/core/blueprint";

export interface IBlueprintResolverConfig {
  blueprintsPath: string;
}

export interface IBlueprintResolver {
  resolve(identityId: string, traceLogger: IEventLogger): Promise<ILoadedBlueprint | null>;
}

/** Directory checked ahead of the shipped `Blueprints/Agents/` catalog. Callers MUST validate this path via `PathResolver` before setting it — this resolver trusts it as-is. */
export const EXA_EVAL_IDENTITY_OVERLAY_DIR_ENV_VAR = "EXA_EVAL_IDENTITY_OVERLAY_DIR";

export class BlueprintResolver implements IBlueprintResolver {
  constructor(private readonly config: IBlueprintResolverConfig) {}

  async resolve(identityId: string, traceLogger: IEventLogger): Promise<ILoadedBlueprint | null> {
    const overlayDir = Deno.env.get(EXA_EVAL_IDENTITY_OVERLAY_DIR_ENV_VAR);
    if (overlayDir) {
      const overlayLoader = new IBlueprintLoader({ blueprintsPath: overlayDir });
      const overlaidBlueprint = await overlayLoader.load(identityId);
      if (overlaidBlueprint) return overlaidBlueprint;
    }

    const blueprintLoader = new IBlueprintLoader({ blueprintsPath: this.config.blueprintsPath });
    let loadedBlueprint = await blueprintLoader.load(identityId);

    if (!loadedBlueprint) {
      loadedBlueprint = await this.findInWorktree(identityId, traceLogger);
    }
    if (!loadedBlueprint) {
      loadedBlueprint = await this.findInRepoRoots(identityId, traceLogger);
    }
    return loadedBlueprint;
  }

  private async findInWorktree(
    identityId: string,
    traceLogger: IEventLogger,
  ): Promise<ILoadedBlueprint | null> {
    let dir = Deno.cwd();
    while (true) {
      const candidatePath = join(dir, "Blueprints", DEFAULT_AGENTS_PATH);
      try {
        const candidateFile = join(candidatePath, `${identityId}.md`);
        try {
          const stat = await Deno.stat(candidateFile);
          if (stat && stat.isFile) {
            const fallbackLoader = new IBlueprintLoader({ blueprintsPath: candidatePath });
            const loadedBlueprint = await fallbackLoader.load(identityId);
            if (loadedBlueprint) {
              traceLogger.info(DomainEventType.RequestBlueprintLoadedFallback, identityId, { from: candidatePath });
              return loadedBlueprint;
            }
          }
        } catch {
          // File doesn't exist
        }
      } catch {
        // ignore
      }

      const parent = dir.replace(/\/[^\/]*$/, "");
      if (!parent || parent === dir) break;
      dir = parent;
    }
    return null;
  }

  private async findInRepoRoots(
    identityId: string,
    traceLogger: IEventLogger,
  ): Promise<ILoadedBlueprint | null> {
    // Try the repository root (cwd) directly
    const repoIdentitiesPath = join(Deno.cwd(), "Blueprints", DEFAULT_AGENTS_PATH);
    const fallbackLoader = new IBlueprintLoader({ blueprintsPath: repoIdentitiesPath });
    const loadedBlueprint = await fallbackLoader.load(identityId);
    if (loadedBlueprint) {
      traceLogger.info(DomainEventType.RequestBlueprintLoadedFallback, identityId, { from: repoIdentitiesPath });
      return loadedBlueprint;
    }

    // Also try locating Blueprints relative to this module (repo root)
    try {
      const repoRoot = join(dirname(dirname(dirname(dirname(new URL(import.meta.url).pathname)))));
      const repoModuleIdentities = join(repoRoot, "Blueprints", DEFAULT_AGENTS_PATH);
      const moduleLoader = new IBlueprintLoader({ blueprintsPath: repoModuleIdentities });
      const moduleLoaded = await moduleLoader.load(identityId);
      if (moduleLoaded) {
        traceLogger.info(DomainEventType.RequestBlueprintLoadedFallback, identityId, { from: repoModuleIdentities });
        return moduleLoaded;
      }
    } catch {
      // ignore
    }
    return null;
  }
}
