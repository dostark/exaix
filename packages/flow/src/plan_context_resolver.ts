/**
 * @module PlanContextResolver
 * @path packages/flow/src/plan_context_resolver.ts
 * @description Resolves a request's `plan_context_ref` to its Phase-173 PlanContext
 *   sandbox copy beneath the portal-configured `executionRoot`, proving containment and
 *   rejecting traversal, absolute paths, and symlink escapes (Phase 174 Step 2 GAP-1).
 * @architectural-layer Flows
 * @dependencies [@std/path, @exaix/schemas]
 * @related-files [packages/flow/src/step_handlers/session_delegate_cycle_step_handler.ts, scripts/plan_to_requests.ts]
 */

import { join, resolve, SEPARATOR } from "@std/path";
import { PlanContextRefSchema } from "@exaix/schemas/request.ts";

export interface IPlanContextResolveInput {
  readonly executionRoot: string;
  readonly planContextRef: string;
}

export interface IPlanContextResolveResult {
  readonly absolutePath: string;
  readonly content: string;
}

export interface IPlanContextResolver {
  resolve(input: IPlanContextResolveInput): Promise<IPlanContextResolveResult>;
}

/** True when `physical` (a resolved real path) sits at-or-inside `realRoot`. */
function isInsideRoot(physical: string, realRoot: string): boolean {
  return physical === realRoot || physical.startsWith(realRoot + SEPARATOR);
}

/** For a path that does not exist yet, resolves the nearest existing ancestor and
 *  re-appends the remainder, so a symlinked ancestor directory is still caught. */
async function resolvePhysicalPath(target: string): Promise<string> {
  try {
    return await Deno.realPath(target);
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
    const parent = join(target, "..");
    if (parent === target) throw error;
    const realParent = await resolvePhysicalPath(parent);
    return join(realParent, target.slice(target.lastIndexOf(SEPARATOR) + 1));
  }
}

export class PlanContextResolver implements IPlanContextResolver {
  async resolve({ executionRoot, planContextRef }: IPlanContextResolveInput): Promise<IPlanContextResolveResult> {
    if (!PlanContextRefSchema.safeParse(planContextRef).success) {
      throw new Error(`Invalid plan_context_ref "${planContextRef}": must be .exa/PlanContext/<slug>.md`);
    }

    const realRoot = await Deno.realPath(resolve(executionRoot)).catch(() => {
      throw new Error(`executionRoot does not exist: ${executionRoot}`);
    });
    const candidate = resolve(realRoot, planContextRef);
    if (!isInsideRoot(candidate, realRoot)) {
      throw new Error(`plan_context_ref "${planContextRef}" escapes the configured execution root`);
    }

    const physical = await resolvePhysicalPath(candidate);
    if (!isInsideRoot(physical, realRoot)) {
      throw new Error(`plan_context_ref "${planContextRef}" resolves outside the configured execution root`);
    }

    const content = await Deno.readTextFile(candidate);
    return { absolutePath: candidate, content };
  }
}
