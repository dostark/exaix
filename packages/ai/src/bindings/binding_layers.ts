/**
 * @module BindingLayers
 * @path packages/ai/src/bindings/binding_layers.ts
 * @description Assembles the operator binding layers at each run start: config entries,
 *   daemon-wide overlay files beneath <root>/.exa/overlays/ (file-name order), then one
 *   run's overlay files and --bind entries from the run binding file. Catalogs merge in
 *   the same order over the built-ins. Every operator file is validated before reading
 *   (regular file, no symlink, canonical path inside the operator directory, byte
 *   ceiling, identity recheck) so an agent-writable tree can never redirect a run.
 * @architectural-layer AI
 * @dependencies [@exaix/schemas, @exaix/model-registry, @exaix/core]
 * @related-files [packages/ai/src/bindings/binding_resolver.ts, packages/ai/src/bindings/model_binding_service.ts]
 */

import { parse as parseToml } from "@std/toml";
import { join } from "@std/path";
import { buildBuiltInCatalog, mergeCatalogs } from "@exaix/model-registry";
import {
  type BindingOutcome as SharedBindingOutcome,
  BindingOverlaySchema,
  type Config,
  getDefaultModels,
  type IBindingIssue,
  type IBindingLayers,
  type IBindingStepRef,
  type IFlow,
  type IRunBindingsFile,
} from "@exaix/schemas";
import {
  BINDING_OVERLAY_MAX_BYTES,
  BINDING_OVERLAYS_DIR,
  ExecutionStrategyName,
  FlowStepExecutionMode,
  FlowStepType,
} from "@exaix/core";
import type { Opt, Reason } from "@exaix/core/types";
import { BINDING_OUTCOME_INVALID, BINDING_OUTCOME_UNBOUND, STEP_KIND_AGENT, STEP_KIND_GATE } from "./binding_types.ts";
import { type IInvalidBindingOutcome, resolveBinding, SELECTOR_DEFAULT } from "./binding_resolver.ts";

type BindingOutcome = SharedBindingOutcome;

/** One LLM-calling step's audit resolution: the winning binding and any resolution issues.
 *  Provider construction and validation are intentionally not performed. */
export interface IStepAuditResolution {
  stepId: string;
  agentRole: string;
  stepType: string;
  outcome: BindingOutcome | IInvalidBindingOutcome;
  issues: IBindingIssue[];
}

export const LAYER_FLOW = "flow";
export const LAYER_CONFIG = "config";
export const LAYER_OVERLAY = "overlay";
export const LAYER_RUN = "run";
export const LAYER_CLI = "cli";

/** Raised by the layer loader for any operator file that fails validation. */
export class OverlayLoadError extends Error {
  constructor(detail: string) {
    super(`overlay_invalid: ${detail}`);
    this.name = "OverlayLoadError";
  }
}

/** Project the current config.ai selection to a catalog canonical model, when unique. */
export function projectConfigDefaultModel(config: Config, catalog: IBindingLayers["catalog"]): string | undefined {
  const ai = config.ai;
  if (!ai?.provider) return undefined;
  const direct = `${ai.provider}/${ai.model ?? ""}`;
  if (ai.model && catalog.models[direct]) return direct;
  const defaultName = getDefaultModels()[ai.provider];
  const defaultCanonical = `${ai.provider}/${defaultName ?? ""}`;
  return catalog.models[defaultCanonical] ? defaultCanonical : undefined;
}

/** Absolute operator runtime directory (<root>/.exa/overlays/). */
function operatorDir(config: Config): string {
  return join(config.system.root, config.paths.runtime, BINDING_OVERLAYS_DIR);
}

/** Reject a runtime directory that resolves inside (or beneath) the Workspace or Portals
 *  trees, both lexically and physically (symlink-resolved). */
async function assertOperatorRuntimeOutsideWorkspace(config: Config): Promise<void> {
  const runtime = join(config.system.root, config.paths.runtime);
  const workspace = join(config.system.root, config.paths.workspace);
  const portals = join(config.system.root, config.paths.portals);

  const beneath = (candidate: string): boolean => {
    const normalized = join(runtime);
    const root = join(candidate);
    return normalized === root || normalized.startsWith(root + "/");
  };
  if (beneath(workspace) || beneath(portals)) {
    throw new OverlayLoadError("runtime directory resolves inside Workspace or Portals");
  }

  let realRuntime: string | undefined;
  try {
    realRuntime = await Deno.realPath(runtime);
  } catch {
    return; // Missing runtime dir means no symlink boundary applies.
  }
  for (const candidate of [workspace, portals]) {
    let realCandidate: string | undefined;
    try {
      realCandidate = await Deno.realPath(candidate);
    } catch {
      continue;
    }
    if (realCandidate && (realRuntime === realCandidate || realRuntime.startsWith(realCandidate + "/"))) {
      throw new OverlayLoadError("runtime directory symlink resolves inside Workspace or Portals");
    }
  }
}

/** Validate one operator file: regular file, no symlink, inside the operator dir, size. */
async function validateOperatorFile(
  path: string,
  operatorRealPath: string,
  describe: string,
): Promise<void> {
  let info;
  try {
    info = await Deno.lstat(path);
  } catch {
    throw new OverlayLoadError(`${describe} is not a regular file`);
  }
  if (!info.isFile || info.isSymlink) {
    throw new OverlayLoadError(`${describe} is not a regular file`);
  }
  if (info.size > BINDING_OVERLAY_MAX_BYTES) {
    throw new OverlayLoadError(`${describe} exceeds the byte ceiling`);
  }
  let realPath: string;
  try {
    realPath = await Deno.realPath(path);
  } catch {
    throw new OverlayLoadError(`${describe} cannot be resolved`);
  }
  if (realPath === operatorRealPath || !realPath.startsWith(operatorRealPath + "/")) {
    throw new OverlayLoadError(`${describe} is outside the operator directory`);
  }
}

/** Read a JSON or TOML operator file, rejecting swaps by re-checking identity. */
async function readOperatorOverlay(
  path: string,
  operatorRealPath: string,
  describe: string,
): Promise<
  { entries: Array<IBindingLayers["entries"][number]>; catalog: Partial<IBindingLayers["catalog"]>; sha256: string }
> {
  await validateOperatorFile(path, operatorRealPath, describe);

  let raw: string;
  try {
    raw = await Deno.readTextFile(path);
  } catch {
    throw new OverlayLoadError(`${describe} cannot be read`);
  }

  // Re-check identity after the read to reject a file swapped mid-read.
  const recheck = await Deno.lstat(path);
  if (!recheck.isFile || recheck.size !== new TextEncoder().encode(raw).length) {
    throw new OverlayLoadError(`${describe} changed during read`);
  }

  let parsed;
  try {
    parsed = path.endsWith(".toml") ? parseToml(raw) : JSON.parse(raw);
  } catch {
    throw new OverlayLoadError(`${describe} is not valid JSON or TOML`);
  }
  let overlay;
  try {
    overlay = BindingOverlaySchema.parse(parsed);
  } catch {
    throw new OverlayLoadError(`${describe} has an unknown field or invalid shape`);
  }
  const sha256 = await hashText(raw);
  const entries: Array<IBindingLayers["entries"][number]> = Object.entries(overlay.bindings ?? {}).map((
    [selector, spec],
  ) => ({
    layer: LAYER_OVERLAY,
    selector,
    spec,
  }));
  return { entries, catalog: overlay.catalog ?? {}, sha256 };
}

async function hashText(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Merge same-selector entries inside one layer, later entry winning per field.
 *  Every run overlay shares one layer rank, so this realizes their argument order.
 *  Distinct selectors stay separate, so ambiguous_selector still applies to them. */
function collapseSameSelectorEntries(
  entries: readonly IBindingLayers["entries"][number][],
): Array<IBindingLayers["entries"][number]> {
  const byLayerAndSelector = new Map<string, IBindingLayers["entries"][number]>();
  for (const entry of entries) {
    const key = `${entry.layer}\u0000${entry.selector}`;
    const existing = byLayerAndSelector.get(key);
    byLayerAndSelector.set(key, {
      layer: entry.layer,
      selector: entry.selector,
      spec: existing ? { ...existing.spec, ...entry.spec } : { ...entry.spec },
    });
  }
  // A Map keeps insertion order, so the first occurrence holds the entry's position.
  return [...byLayerAndSelector.values()];
}

/**
 * Assemble the operator binding layers for the current config and one run.
 * Order is config, daemon overlays, run overlays, then run --bind entries.
 * Catalogs merge over the built-ins.
 */
export async function loadBindingLayers(
  config: Config,
  run: Opt<IRunBindingsFile, Reason.OptionalContext> = undefined,
): Promise<IBindingLayers> {
  await assertOperatorRuntimeOutsideWorkspace(config);

  const mergedCatalog = mergeCatalogs(buildBuiltInCatalog(), config.catalog ?? {});
  const configEntries: Array<IBindingLayers["entries"][number]> = Object.entries(config.bindings ?? {}).map((
    [selector, spec],
  ) => ({
    layer: LAYER_CONFIG,
    selector,
    spec,
  }));

  let catalog = mergedCatalog;
  const entries: Array<IBindingLayers["entries"][number]> = [...configEntries];
  const overlayHashes: string[] = [];

  const overlaysDir = operatorDir(config);
  if (await dirExists(overlaysDir)) {
    const operatorRealPath = await Deno.realPath(overlaysDir);
    const files: string[] = [];
    for await (const entry of Deno.readDir(overlaysDir)) {
      if (!entry.name.endsWith(".json") && !entry.name.endsWith(".toml")) continue;
      files.push(entry.name);
    }
    files.sort();
    for (const name of files) {
      const loaded = await readOperatorOverlay(
        join(overlaysDir, name),
        operatorRealPath,
        `daemon overlay ${name}`,
      );
      entries.push(...loaded.entries);
      catalog = mergeCatalogs(catalog, loaded.catalog);
      overlayHashes.push(loaded.sha256);
    }
  }

  if (run) {
    for (const overlay of run.overlays) {
      const entriesFromOverlay: Array<IBindingLayers["entries"][number]> = Object.entries(
        overlay.overlay.bindings ?? {},
      ).map(([selector, spec]) => ({
        layer: LAYER_RUN,
        selector,
        spec,
      }));
      entries.push(...entriesFromOverlay);
      catalog = mergeCatalogs(catalog, overlay.overlay.catalog ?? {});
      overlayHashes.push(overlay.sha256);
    }
    for (const bind of run.binds) {
      entries.push({ layer: LAYER_CLI, selector: bind.selector, spec: bind.spec });
    }
  }

  const collapsedEntries = collapseSameSelectorEntries(entries);
  const specEntries = collapsedEntries.length > 0;
  return {
    entries: collapsedEntries,
    catalog,
    overlaySha256: overlayHashes,
    operatorLayersPresent: specEntries,
    configDefaultModel: projectConfigDefaultModel(config, catalog),
  };
}

async function dirExists(path: string): Promise<boolean> {
  try {
    const info = await Deno.stat(path);
    return info.isDirectory;
  } catch {
    return false;
  }
}

/** One LLM-calling step's audit resolution: the winning binding and any resolution issues.
 *  Provider construction and validation are intentionally not performed. */
/** Resolve every LLM-calling step of a flow for audit, mirroring the runtime resolution
 *  (pins, layer merge, environment rule, config-default fallback). Pure: no provider
 *  construction and no validation side effects. */
export async function resolveFlowForAudit(
  flow: IFlow,
  config: Config,
  probe: { hasKey(name: string): boolean; hasOptIn(name: string): boolean },
  run: Opt<IRunBindingsFile, Reason.OptionalContext> = undefined,
): Promise<{ layers: IBindingLayers; steps: IStepAuditResolution[] }> {
  const layers = await loadBindingLayers(config, run);
  const steps: IStepAuditResolution[] = [];
  for (const step of flow.steps) {
    const ref = bindingStepRef(flow, step, config.execution?.native_tools_enabled === true);
    if (!ref) continue;
    const issues: IBindingIssue[] = [];
    let outcome = resolveBinding(ref, { binding: step.binding ?? {}, pin: step.pin }, layers, probe);
    if (outcome.kind === BINDING_OUTCOME_UNBOUND && layers.operatorLayersPresent && layers.configDefaultModel) {
      outcome = resolveBinding(ref, { binding: {} }, {
        ...layers,
        entries: [...layers.entries, {
          layer: LAYER_CONFIG,
          selector: SELECTOR_DEFAULT,
          spec: { model: layers.configDefaultModel },
        }],
      }, probe);
    }
    if (outcome.kind === BINDING_OUTCOME_INVALID) issues.push(...outcome.issues);
    steps.push({
      stepId: step.id,
      agentRole: ref.agentRole,
      stepType: step.type,
      outcome,
      issues,
    });
  }
  return { layers, steps };
}

/** The binding ref for an LLM-calling step, or undefined for other step types.
 *  `nativeToolsEnabled` is the operator's `[execution].native_tools_enabled` opt-in. A DYNAMIC
 *  step or a react strategy step then runs a native tool loop. */
const STEP_KINDS = new Set<FlowStepType>([
  FlowStepType.AGENT,
  FlowStepType.GATE,
  FlowStepType.SESSION_DELEGATE_CYCLE,
]);

export function bindingStepRef(
  flow: IFlow,
  step: IFlow["steps"][number],
  nativeToolsEnabled: boolean,
): IBindingStepRef | undefined {
  if (!STEP_KINDS.has(step.type)) return undefined;
  if (step.type === FlowStepType.AGENT) {
    return {
      flowId: flow.id,
      stepId: step.id,
      agentRole: step.agent_role,
      kind: STEP_KIND_AGENT,
      strategy: step.strategy,
      nativeTools: nativeToolsEnabled &&
        (step.execution_mode === FlowStepExecutionMode.DYNAMIC || step.strategy === ExecutionStrategyName.REACT),
    };
  }
  return {
    flowId: flow.id,
    stepId: step.id,
    agentRole: step.type === FlowStepType.GATE
      ? step.evaluate?.agent_role ?? step.agent_role
      : step.delegateCycle?.review.agent_role ?? step.agent_role,
    kind: STEP_KIND_GATE,
    nativeTools: false,
  };
}
