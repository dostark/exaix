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
 *
 *   The pin rule reads the pinned values from the authoring layers at the pin's selector.
 *   A cell may therefore change what a scenario pinned. An authoring entry more specific
 *   than the pin may not contradict it, which is an authoring error at load time. An
 *   operator entry at least as specific as the pin is refused, because it aims straight at
 *   the value the scenario froze. A broader entry has the pinned fields removed, so the
 *   pinned value is the only value left and no layer order can defeat the pin.
 * @architectural-layer Test
 * @dependencies [@std/path, @std/fs, @exaix/schemas]
 * @related-files [tests/scenario_framework/runner/matrix_expander.ts, packages/ai/src/bindings/binding_layers.ts]
 */

import { join, resolve } from "@std/path";
import { ensureDir } from "@std/fs";
import {
  BINDING_OVERLAY_SCHEMA_VERSION,
  BindingOverlaySchema,
  BindOneOffSchema,
  type IBindingSpec,
  type IRunBindingsFile,
  RunBindingsFileSchema,
} from "@exaix/schemas";
import type { IScenario } from "../schema/scenario_schema.ts";
import type { JSONValue } from "@exaix/core";
import type { Opt, Reason } from "@exaix/core/types";
import { SENTINEL_COMPAT_FIXTURE_PORT } from "./sentinels.ts";
import {
  BindingIncompatibleError,
  LAYER_CLI,
  LAYER_RUN,
  readRegularOverlayFile,
  selectorsCanOverlap,
  selectorSpecificity,
} from "@exaix/ai";
import type { BindingLayer, PinnableBindingField, PinReason } from "@exaix/schemas";
import type { IScenarioPin } from "../schema/scenario_schema.ts";

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
  /** One row per pinned field the pin rule removed from an operator entry. */
  pins: IPinKeptRecord[];
}

/** One validated overlay document: the shape `exactl request --overlay` reads. */
export interface IBindingOverlayDocument {
  schema: 1;
  bindings?: Record<string, IBindingSpec>;
  catalog?: NonNullable<IScenario["catalog"]>;
}

/** One operator entry the pin rule inspects. `spec` is the live object its document holds.
 *  Removing a field here therefore removes it from what the daemon receives. */
interface IOperatorEntry {
  selector: string;
  spec: IBindingSpec;
  source: string;
  layer: BindingLayer;
}

/** One pinned field the pin rule removed from an operator entry. */
export interface IPinKeptRecord {
  /** The pin's own selector. */
  selector: string;
  reason: PinReason;
  note: string;
  field: PinnableBindingField;
  /** The value the authoring layers set for the pinned field. */
  value: string;
  /** The operator entry the field was stripped from. */
  source: string;
  skipped_selector: string;
  skipped_layer: BindingLayer;
}

/** One authoring-layer entry, in scenario-then-cell order. */
interface IAuthoringEntry {
  selector: string;
  spec: IBindingSpec;
  /** Who wrote the entry, for the refusal message. */
  source: string;
  /** True for an `exactl request` step's own binding. It reaches one request, so it never sets the pinned value. */
  stepLayer: boolean;
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

/** Subdirectory of the run's output directory that holds one overlay directory per invocation. */
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

/** Replace the fixture-port sentinel in a raw overlay's service endpoints.
 *  It runs before schema validation, because the strict endpoint URL schema rejects the sentinel. */
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

/** Replace the fixture-port sentinel in the cell layer's service endpoints.
 *  A preset is loaded before the port exists, so its endpoint may still hold the sentinel. */
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
  // The shared reader refuses a symlink, a non-regular file and an oversized one before parsing.
  const content = await readRegularOverlayFile(sourcePath);
  try {
    return JSON.parse(content);
  } catch {
    throw new Error(`overlay_invalid: ${sourcePath} is not valid JSON`);
  }
}

/** Step ids that may name an overlay file: no path separator and no dot-only name. */
const OVERLAY_STEP_ID_PATTERN = /^(?!\.+$)[A-Za-z0-9._-]+$/;

/** The step overlay path for one step id, refused when the id could leave the bindings directory. */
function stepOverlayPath(bindingsDir: string, stepId: string): string {
  const path = join(bindingsDir, `${STEP_OVERLAY_PREFIX}${stepId}.json`);
  if (!OVERLAY_STEP_ID_PATTERN.test(stepId) || !isInside(path, bindingsDir)) {
    throw new Error(`overlay_invalid: step id "${stepId}" cannot name an overlay file`);
  }
  return path;
}

/** Write one overlay document and return the digest of the bytes written. */
async function writeOverlay(path: string, document: object): Promise<string> {
  const text = `${JSON.stringify(document, null, 2)}\n`;
  await Deno.writeTextFile(path, text);
  return await hashText(text);
}

/** Parse `--bind selector=field=value[,field=value]` specs, the grammar `exactl request --bind` accepts. */
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

/** The authoring layers in order: the scenario layer, the cell layer, then each request step's own layer. */
function authoringEntries(input: IPlanScenarioBindingsInput): IAuthoringEntry[] {
  const entries: IAuthoringEntry[] = [];
  for (const [selector, spec] of Object.entries(input.scenario.bindings ?? {})) {
    entries.push({ selector, spec, source: `the scenario binding at "${selector}"`, stepLayer: false });
  }
  for (const [selector, spec] of Object.entries(input.cell?.bindings ?? {})) {
    entries.push({ selector, spec, source: `the cell binding at "${selector}"`, stepLayer: false });
  }
  for (const step of input.scenario.steps) {
    for (const [selector, spec] of Object.entries(step.bindings ?? {})) {
      entries.push({ selector, spec, source: `the binding of step ${step.id} at "${selector}"`, stepLayer: true });
    }
  }
  return entries;
}

/** The value an authoring layer sets for one pinned field at the pin's selector.
 *  A later entry wins, so the cell layer may change what the scenario layer set. */
function pinnedAuthoringValue(
  entries: readonly IAuthoringEntry[],
  pinSelector: string,
  field: PinnableBindingField,
): IBindingSpec[PinnableBindingField] | undefined {
  let value: IBindingSpec[PinnableBindingField] | undefined;
  for (const entry of entries) {
    if (entry.stepLayer || entry.selector !== pinSelector) continue;
    const candidate = entry.spec[field];
    if (candidate !== undefined) value = candidate;
  }
  return value;
}

/** The refusal a pin raises. Every pin fact goes in `detail`, because `IBindingIssue`
 *  carries no field, reason, note or source parameter of its own. */
function pinnedRefusal(
  input: IPlanScenarioBindingsInput,
  pin: IScenarioPin,
  offending: {
    selector: string;
    field: PinnableBindingField;
    reason: PinReason;
    note: string;
    value: string;
    source: string;
  },
): BindingIncompatibleError {
  return new BindingIncompatibleError([{
    code: "pinned",
    selector: offending.selector,
    flowId: input.scenario.id,
    detail: `the scenario pins field "${offending.field}" to "${offending.value}" at ` +
      `selector "${pin.selector}" (${offending.reason}). Note: ${offending.note}. ` +
      `${offending.source} attempted to change it`,
  }]);
}

/** Apply every scenario pin to the authoring and operator entries, before any overlay is written. */
function enforcePins(input: IPlanScenarioBindingsInput, operatorEntries: IOperatorEntry[]): IPinKeptRecord[] {
  return (input.scenario.pin ?? []).flatMap((pin) => enforcePin(input, pin, operatorEntries));
}

/** The value each pinned field holds at the pin's selector in the scenario and cell layers. */
function pinnedValues(entries: readonly IAuthoringEntry[], pin: IScenarioPin): Map<PinnableBindingField, string> {
  const values = new Map<PinnableBindingField, string>();
  for (const field of pin.fields) {
    const value = pinnedAuthoringValue(entries, pin.selector, field);
    if (value === undefined) {
      throw new Error(
        `pin_invalid: the pin at selector "${pin.selector}" names field "${field}", ` +
          `but no scenario or cell binding sets that field at that selector`,
      );
    }
    values.set(field, String(value));
  }
  return values;
}

/** True when an authoring entry can override the pin's value for some step it protects.
 *  A step entry at the pin's own selector counts, because it would replace the value for that request. */
function authoringEntryCompetes(entry: IAuthoringEntry, pin: IScenarioPin): boolean {
  if (!selectorsCanOverlap(entry.selector, pin.selector)) return false;
  if (entry.selector === pin.selector) return entry.stepLayer;
  return selectorSpecificity(entry.selector) > selectorSpecificity(pin.selector);
}

/** Apply one scenario pin. A contradicting authoring entry fails at load.
 *  An overlapping operator entry fails when it is at least as specific.
 *  A broader overlapping operator entry loses the pinned field instead. */
function enforcePin(
  input: IPlanScenarioBindingsInput,
  pin: IScenarioPin,
  operatorEntries: IOperatorEntry[],
): IPinKeptRecord[] {
  const authoring = authoringEntries(input);
  const values = pinnedValues(authoring, pin);

  for (const entry of authoring) {
    if (!authoringEntryCompetes(entry, pin)) continue;
    for (const field of pin.fields) {
      const value = entry.spec[field];
      if (value === undefined || String(value) === values.get(field)) continue;
      throw pinnedRefusal(input, pin, {
        selector: entry.selector,
        field,
        reason: pin.reason,
        note: pin.note,
        value: values.get(field)!,
        source: entry.source,
      });
    }
  }

  const kept: IPinKeptRecord[] = [];
  for (const entry of operatorEntries) {
    if (!selectorsCanOverlap(entry.selector, pin.selector)) continue;
    for (const field of pin.fields) {
      const value = entry.spec[field];
      if (value === undefined || String(value) === values.get(field)) continue;
      if (selectorSpecificity(entry.selector) >= selectorSpecificity(pin.selector)) {
        throw pinnedRefusal(input, pin, {
          selector: entry.selector,
          field,
          reason: pin.reason,
          note: pin.note,
          value: values.get(field)!,
          source: entry.source,
        });
      }
      // Remove the field from the shared spec, so the written document cannot carry it.
      delete entry.spec[field];
      kept.push({
        selector: pin.selector,
        reason: pin.reason,
        note: pin.note,
        field,
        value: values.get(field)!,
        source: entry.source,
        skipped_selector: entry.selector,
        skipped_layer: entry.layer,
      });
    }
  }
  return kept;
}

/** Plan one scenario run's binding overlays: scenario, cell, step, operator overlays, then `--bind`.
 *  Each file is returned with its digest, so the evidence records what the daemon received. */
export async function planScenarioBindings(
  input: IPlanScenarioBindingsInput,
): Promise<IScenarioBindingPlan> {
  // One directory per invocation. A repeated scenario then keeps its earlier overlay bytes.
  const bindingsDir = join(input.outputDir, SCENARIO_BINDINGS_SUBDIR, crypto.randomUUID());
  if (isInside(bindingsDir, input.sandboxRoot)) {
    throw new Error(
      `overlay_invalid: the bindings directory resolves inside the sandbox (${input.sandboxRoot})`,
    );
  }

  const overlays: IScenarioOverlayFile[] = [];
  const scenarioOverlay = buildScenarioOverlay(input);
  const cellOverlay = buildCellOverlay(input);

  // The pin rule reads and writes every operator entry in memory first. A refused override
  // must stop the run before any overlay reaches the disk, so nothing half-written is left.
  const operatorEntries: IOperatorEntry[] = [];
  const operatorOverlays: Array<{ sourcePath: string; document: IBindingOverlayDocument }> = [];
  for (const [index, sourcePath] of input.operatorOverlays.entries()) {
    const raw = await readOperatorOverlayJson(sourcePath);
    // Substitute before validation: the strict endpoint schema rejects the sentinel.
    const document = BindingOverlaySchema.parse(
      substituteFixturePortInRawOverlay(raw, input.compatFixturePort),
    );
    operatorOverlays.push({ sourcePath, document });
    for (const [selector, spec] of Object.entries(document.bindings ?? {})) {
      operatorEntries.push({ selector, spec, source: `--overlay ${sourcePath}`, layer: LAYER_RUN });
    }
    void index;
  }

  const bindSpecs = parseScenarioBindSpecs(input.operatorBinds);
  const bindings: Record<string, IBindingSpec> = {};
  // Same-selector entries merge per field, later winning, as `exactl request --bind` does.
  for (const entry of bindSpecs) bindings[entry.selector] = { ...bindings[entry.selector], ...entry.spec };
  // Parse first, then read the entries out of the parsed document. Parsing returns fresh
  // spec objects. A spec taken from the input would not be the one written.
  const bindDocument: IBindingOverlayDocument | undefined = input.operatorBinds.length > 0
    ? BindingOverlaySchema.parse({ schema: 1, bindings })
    : undefined;
  for (const [selector, spec] of Object.entries(bindDocument?.bindings ?? {})) {
    operatorEntries.push({ selector, spec, source: `--bind ${selector}`, layer: LAYER_CLI });
  }

  const pins = enforcePins(input, operatorEntries);
  // Every step overlay path is checked before the first file is written.
  for (const step of input.scenario.steps) if (step.bindings) stepOverlayPath(bindingsDir, step.id);

  if (scenarioOverlay) {
    await ensureDir(bindingsDir);
    const path = join(bindingsDir, SCENARIO_OVERLAY_NAME);
    overlays.push({ role: "scenario", path, sha256: await writeOverlay(path, scenarioOverlay) });
  }

  if (cellOverlay) {
    await ensureDir(bindingsDir);
    const path = join(bindingsDir, CELL_OVERLAY_NAME);
    overlays.push({ role: "cell", path, sha256: await writeOverlay(path, cellOverlay) });
  }

  for (const [index, operator] of operatorOverlays.entries()) {
    await ensureDir(bindingsDir);
    const path = join(bindingsDir, `30-operator-${index}.json`);
    overlays.push({ role: "operator", path, sha256: await writeOverlay(path, operator.document) });
  }

  for (const step of input.scenario.steps) {
    if (!step.bindings) continue;
    await ensureDir(bindingsDir);
    const document = BindingOverlaySchema.parse({ schema: 1, bindings: step.bindings });
    const path = stepOverlayPath(bindingsDir, step.id);
    overlays.push({ role: "step", stepId: step.id, path, sha256: await writeOverlay(path, document) });
  }

  if (bindDocument) {
    await ensureDir(bindingsDir);
    const path = join(bindingsDir, OPERATOR_BIND_OVERLAY_NAME);
    overlays.push({ role: "operator", path, sha256: await writeOverlay(path, bindDocument) });
  }

  return { overlays, pins };
}

/** The overlay files one `exactl request` step receives, lowest precedence first.
 *  The order is scenario, cell, the request's own step layer, then operator layers.
 *  A judge resolves through this list too. */
export function orderedRequestOverlays(
  plan: IScenarioBindingPlan,
  requestStepId: Opt<string, Reason.OptionalInput>,
): IScenarioOverlayFile[] {
  const globalOverlays = plan.overlays.filter((overlay) => overlay.role !== "step");
  const lowerLayers = globalOverlays.filter((overlay) => overlay.role !== "operator");
  const operatorLayers = globalOverlays.filter((overlay) => overlay.role === "operator");
  const stepOverlay = requestStepId === undefined
    ? undefined
    : plan.overlays.find((overlay) => overlay.role === "step" && overlay.stepId === requestStepId);
  return [...lowerLayers, ...(stepOverlay ? [stepOverlay] : []), ...operatorLayers];
}

/** Read a plan's overlay files back into the run-binding-file shape the layer loader reads.
 *  Judge resolution uses it, so a judge resolves against the files the daemon receives. */
export async function buildRunBindingsFile(
  overlays: readonly IScenarioOverlayFile[],
  identity: { traceId: string; requestPath: string },
): Promise<IRunBindingsFile> {
  const files: IRunBindingsFile["overlays"] = [];
  for (const overlay of overlays) {
    const raw = await Deno.readTextFile(overlay.path);
    files.push({
      source_path: overlay.path,
      sha256: overlay.sha256,
      overlay: BindingOverlaySchema.parse(JSON.parse(raw)),
    });
  }
  return RunBindingsFileSchema.parse({
    schema: BINDING_OVERLAY_SCHEMA_VERSION,
    trace_id: identity.traceId,
    request_path: identity.requestPath,
    request_sha256: await hashText(await Deno.readTextFile(identity.requestPath)),
    created_at: new Date().toISOString(),
    overlays: files,
    binds: [],
  });
}
