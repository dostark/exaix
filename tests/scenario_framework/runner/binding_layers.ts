/**
 * @module ScenarioBindingLayers
 * @path tests/scenario_framework/runner/binding_layers.ts
 * @description Phase 203 — builds the binding overlay files one scenario run hands to every
 *   `exactl request` step. The runner writes a scenario-layer overlay, then the selected
 *   matrix cell's overlay, normalizes each operator `--overlay` to JSON, and writes the
 *   operator `--bind` entries as one final overlay. Every
 *   file is a `BindingOverlaySchema` document, because `exactl request` parses each `--overlay`
 *   argument with `BindingOverlaySchema.parse` and reads JSON only.
 *
 *   The files live under the run's output directory, outside the sandbox: the agent under test
 *   must not be able to rewrite the bindings that govern it. A caller that points the directory
 *   inside the sandbox is refused with `overlay_invalid`.
 *
 *   Layer order comes from the `--overlay` argument order the caller passes, because every run
 *   overlay carries the same daemon layer. See `packages/ai/src/bindings/binding_layers.ts` for
 *   the same-selector collapse that realizes that order.
 * @architectural-layer Test
 * @dependencies [@std/path, @std/fs, @exaix/schemas]
 * @related-files [tests/scenario_framework/runner/matrix_expander.ts, packages/ai/src/bindings/binding_layers.ts]
 */

import { join, resolve } from "@std/path";
import { ensureDir } from "@std/fs";
import { BindingOverlaySchema, BindOneOffSchema, type IBindingSpec, type IResolvedBinding } from "@exaix/schemas";
import type { IScenario } from "../schema/scenario_schema.ts";
import type { JSONValue } from "@exaix/core";
import type { Opt, Reason } from "@exaix/core/types";
import { SENTINEL_COMPAT_FIXTURE_PORT } from "./sentinels.ts";

/** Which binding layer produced an overlay file. */
export type ScenarioOverlayRole = "scenario" | "cell" | "step" | "operator";

/** One overlay file the runner wrote, with the digest of the bytes now on disk. */
export interface IScenarioOverlayFile {
  role: ScenarioOverlayRole;
  path: string;
  sha256: string;
  /** Set only for a `step` overlay: the step whose own `bindings:` it carries. */
  stepId?: string;
}

/** The runner-side binding plan for one scenario run. */
export interface IScenarioBindingPlan {
  overlays: IScenarioOverlayFile[];
  /** Resolved judge bindings by judge step id. The Step-1 subset resolves none. */
  judgeBindings: Map<string, IResolvedBinding>;
}

/** A cell catalog as the scenario schema types it: every table is optional. */
type CellCatalog = NonNullable<IScenario["catalog"]>;

/** The cell layer's contribution: the selected matrix cell's own binding data. */
export interface ICellBindingLayer {
  bindings?: IScenario["bindings"];
  catalog?: CellCatalog;
}

/** Everything `planScenarioBindings` needs. No judge layer exists in the Step-1 subset. */
export interface IPlanScenarioBindingsInput {
  scenario: IScenario;
  /** The selected matrix cell, when the run resolved one. Sits above the scenario layer. */
  cell?: ICellBindingLayer;
  /** Operator `--overlay` file paths, in the order given on the command line. */
  operatorOverlays: readonly string[];
  /** Operator `--bind` specs, in the order given on the command line. */
  operatorBinds: readonly string[];
  /** Run output directory the runner owns. Overlays are written beneath it. */
  outputDir: string;
  /** Sandbox root. A bindings directory inside it is refused. */
  sandboxRoot: string;
  /** Replaces `__COMPAT_FIXTURE_PORT__` in catalog endpoints, when a fixture is in play. */
  compatFixturePort?: number;
}

/** Subdirectory of the run's output directory that holds this run's overlay files. */
export const SCENARIO_BINDINGS_SUBDIR = "bindings";

/** Scenario-layer overlay file name. Sorts before every operator file. */
const SCENARIO_OVERLAY_NAME = "10-scenario.json";

/** Cell-layer overlay file name. Sorts between the scenario and step layers. */
const CELL_OVERLAY_NAME = "20-cell.json";

/** Step-layer overlay file name prefix. One file per `exactl request` step that binds. */
const STEP_OVERLAY_PREFIX = "25-step-";

/** Operator `--bind` entries land after every operator overlay file. */
const OPERATOR_BIND_OVERLAY_NAME = "40-operator-bind.json";

/** SHA-256 of a text payload, as lowercase hex. */
async function hashText(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** True when `candidate` is `root` or sits beneath it. */
function isInside(candidate: string, root: string): boolean {
  const resolvedCandidate = resolve(candidate);
  const resolvedRoot = resolve(root);
  return resolvedCandidate === resolvedRoot || resolvedCandidate.startsWith(`${resolvedRoot}/`);
}

/**
 * Replace the fixture-port sentinel in every catalog service endpoint.
 * The input is a RAW overlay object, before any schema validation.
 *
 * This runs before `BindingOverlaySchema.parse`. `CatalogServiceSchema.endpoint` is a
 * `z.string().url()`, so it rejects the sentinel. Substituting first keeps the sentinel
 * out of the strict schema and out of the daemon.
 */
function substituteFixturePortInRawOverlay(
  raw: JSONValue,
  port: Opt<number, Reason.OptionalInput>,
): JSONValue {
  if (port === undefined || !isJsonObject(raw)) return raw;
  const catalog = raw.catalog;
  if (!isJsonObject(catalog)) return raw;
  const services = catalog.services;
  if (!isJsonObject(services)) return raw;
  const substituted: { [serviceId: string]: JSONValue } = {};
  for (const [serviceId, service] of Object.entries(services)) {
    if (!isJsonObject(service)) {
      substituted[serviceId] = service;
      continue;
    }
    const endpoint = service.endpoint;
    substituted[serviceId] = typeof endpoint === "string"
      ? { ...service, endpoint: endpoint.replaceAll(SENTINEL_COMPAT_FIXTURE_PORT, String(port)) }
      : service;
  }
  return { ...raw, catalog: { ...catalog, services: substituted } };
}

/** True when a parsed JSON value is a plain object, not an array or null. */
function isJsonObject(value: JSONValue): value is { [key: string]: JSONValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Replace the fixture-port sentinel in every catalog service endpoint of the CELL layer.
 * A catalog preset is loaded before the port exists, so its endpoint may still hold the
 * sentinel. The strict endpoint schema rejects that, so substitute before validation.
 */
function substituteFixturePortInCellCatalog(
  catalog: CellCatalog,
  port: Opt<number, Reason.OptionalInput>,
): CellCatalog {
  if (port === undefined || catalog.services === undefined) return catalog;
  const services: NonNullable<CellCatalog["services"]> = {};
  for (const [serviceId, service] of Object.entries(catalog.services)) {
    services[serviceId] = service.endpoint === undefined
      ? service
      : { ...service, endpoint: service.endpoint.replaceAll(SENTINEL_COMPAT_FIXTURE_PORT, String(port)) };
  }
  return { ...catalog, services };
}

/** Read one operator overlay file and reject anything `exactl` could not parse itself. */
async function readOperatorOverlayJson(sourcePath: string): Promise<JSONValue> {
  let content: string;
  try {
    content = await Deno.readTextFile(sourcePath);
  } catch {
    throw new Error(`overlay_invalid: ${sourcePath} cannot be read`);
  }
  try {
    return JSON.parse(content);
  } catch {
    throw new Error(`overlay_invalid: ${sourcePath} is not valid JSON`);
  }
}

/** Write one overlay document and return the digest of the bytes written. */
async function writeOverlay(path: string, document: object): Promise<string> {
  const text = `${JSON.stringify(document, null, 2)}\n`;
  await Deno.writeTextFile(path, text);
  return await hashText(text);
}

/**
 * Parse `--bind selector=field=value,field=value` specs into the shared bind schema.
 * This is the same grammar `exactl request --bind` accepts.
 */
export function parseScenarioBindSpecs(raw: readonly string[]): ReturnType<typeof BindOneOffSchema.parse> {
  const entries = raw.map((spec) => {
    const separatorIndex = spec.indexOf("=");
    if (separatorIndex <= 0) {
      throw new Error(`overlay_invalid: malformed --bind "${spec}" — expected selector=field=value`);
    }
    const fields: Record<string, string> = {};
    for (const assignment of spec.slice(separatorIndex + 1).split(",")) {
      if (!assignment) continue;
      const equalsIndex = assignment.indexOf("=");
      if (equalsIndex <= 0) {
        throw new Error(`overlay_invalid: malformed --bind "${spec}" — expected field=value`);
      }
      fields[assignment.slice(0, equalsIndex)] = assignment.slice(equalsIndex + 1);
    }
    return { selector: spec.slice(0, separatorIndex), spec: fields };
  });
  return BindOneOffSchema.parse(entries);
}

/** Build the scenario-layer overlay, or undefined when the scenario declares no binding data. */
function buildScenarioOverlay(input: IPlanScenarioBindingsInput): object | undefined {
  // A scenario's catalog is already schema-validated, so no sentinel can reach this point.
  if (!input.scenario.bindings && !input.scenario.catalog) return undefined;
  return BindingOverlaySchema.parse({
    schema: 1,
    ...(input.scenario.bindings ? { bindings: input.scenario.bindings } : {}),
    ...(input.scenario.catalog ? { catalog: input.scenario.catalog } : {}),
  });
}

/** Build the cell-layer overlay, or undefined when the selected cell binds nothing. */
function buildCellOverlay(input: IPlanScenarioBindingsInput): object | undefined {
  const cell = input.cell;
  if (!cell?.bindings && !cell?.catalog) return undefined;
  return BindingOverlaySchema.parse({
    schema: 1,
    ...(cell.bindings ? { bindings: cell.bindings } : {}),
    ...(cell.catalog ? { catalog: substituteFixturePortInCellCatalog(cell.catalog, input.compatFixturePort) } : {}),
  });
}

/**
 * Plan one scenario run's binding overlays.
 *
 * Writes the overlays in layer order. The scenario overlay comes first, then the selected
 * cell's overlay. Each operator overlay follows in the order given. One overlay then holds
 * the operator `--bind` entries.
 * Returns each file with its digest, so the evidence records what the daemon received.
 */
export async function planScenarioBindings(
  input: IPlanScenarioBindingsInput,
): Promise<IScenarioBindingPlan> {
  const bindingsDir = join(input.outputDir, SCENARIO_BINDINGS_SUBDIR);
  if (isInside(bindingsDir, input.sandboxRoot)) {
    throw new Error(
      `overlay_invalid: the bindings directory resolves inside the sandbox (${input.sandboxRoot})`,
    );
  }

  const overlays: IScenarioOverlayFile[] = [];
  const scenarioOverlay = buildScenarioOverlay(input);
  if (scenarioOverlay) {
    await ensureDir(bindingsDir);
    const path = join(bindingsDir, SCENARIO_OVERLAY_NAME);
    overlays.push({ role: "scenario", path, sha256: await writeOverlay(path, scenarioOverlay) });
  }

  const cellOverlay = buildCellOverlay(input);
  if (cellOverlay) {
    await ensureDir(bindingsDir);
    const path = join(bindingsDir, CELL_OVERLAY_NAME);
    overlays.push({ role: "cell", path, sha256: await writeOverlay(path, cellOverlay) });
  }

  for (const [index, sourcePath] of input.operatorOverlays.entries()) {
    await ensureDir(bindingsDir);
    const raw = await readOperatorOverlayJson(sourcePath);
    // Substitute before validation: the strict endpoint schema rejects the sentinel.
    const normalized = BindingOverlaySchema.parse(
      substituteFixturePortInRawOverlay(raw, input.compatFixturePort),
    );
    const path = join(bindingsDir, `30-operator-${index}.json`);
    overlays.push({ role: "operator", path, sha256: await writeOverlay(path, normalized) });
  }

  for (const step of input.scenario.steps) {
    if (!step.bindings) continue;
    await ensureDir(bindingsDir);
    const document = BindingOverlaySchema.parse({ schema: 1, bindings: step.bindings });
    const path = join(bindingsDir, `${STEP_OVERLAY_PREFIX}${step.id}.json`);
    overlays.push({ role: "step", stepId: step.id, path, sha256: await writeOverlay(path, document) });
  }

  if (input.operatorBinds.length > 0) {
    await ensureDir(bindingsDir);
    const bindings: Record<string, IBindingSpec> = {};
    for (const entry of parseScenarioBindSpecs(input.operatorBinds)) {
      bindings[entry.selector] = entry.spec;
    }
    const document = BindingOverlaySchema.parse({ schema: 1, bindings });
    const path = join(bindingsDir, OPERATOR_BIND_OVERLAY_NAME);
    overlays.push({ role: "operator", path, sha256: await writeOverlay(path, document) });
  }

  return { overlays, judgeBindings: new Map<string, IResolvedBinding>() };
}
