/**
 * @module ModelCommands
 * @path apps/exactl/src/commands/model_commands.ts
 * @description Solo curation CLI — `exactl models list/pricing` (registry-backed
 *   display of the DefaultModelRegistry floor) and `exactl config model` (curate the
 *   per-size `model_presets.<SIZE>.candidates` list + `characteristics` sub-map that the
 *   ModelResolver reads). Curated lists persist via TOML write-back to exa.config.toml —
 *   the surface the resolver reads — so the loop closes with zero DB (Phase 134, Solo).
 * @architectural-layer CLI
 * @dependencies ["@exaix/core/types", "@std/toml"]
 * @related-files ["apps/exactl/src/exactl.ts", "apps/exactl/src/init.ts", "packages/ai/src/model_resolver.ts", "packages/model-registry/src/default_model_registry.ts"]
 * @phase-134 Step 6 — Solo curation CLI; no `models refresh` surface (that is Team/Phase 135).
 */

import { parse, stringify } from "@std/toml";
import * as colors from "@std/fmt/colors";
import { Table } from "@cliffy/table";
import type { IModelRegistry, Opt, Reason } from "@exaix/core/types";
import { DEFAULT_MODEL_PRESETS } from "@exaix/schemas/config.ts";

/** A curated entry annotated with whether its provider is registered (Solo G10). */
export interface ICuratedEntryStatus {
  entry: string;
  /** True when the entry's provider is not registered in the registry (pre-curation allowance). */
  unconfigured: boolean;
}

/** Per-size view of curated candidates with configuration status. */
export interface ISizeCandidates {
  entries: ICuratedEntryStatus[];
}

/** Per-characteristic curated sub-lists (e.g. `cheapest` → provider order). */
export interface ICharacteristicMap {
  [characteristic: string]: string[];
}

/** The subset of a preset entry this command reads/writes. */
export interface IModelPresetToml {
  max_cost_per_mtok?: number;
  min_context_window?: number;
  supports_thinking?: boolean;
  candidates?: string[];
  characteristics?: ICharacteristicMap;
}

/** Per-size preset map keyed by capability tier (S/M/L/XL). */
export interface IPresetMap {
  [size: string]: IModelPresetToml;
}

/**
 * The parsed exa.config.toml as this command sees it. Only `model_presets` is typed;
 * other keys survive the parse→mutate→stringify round-trip untouched at runtime.
 */
export interface IConfigToml {
  model_presets?: IPresetMap;
}

/** Valid capability tiers for curated lists (mirrors ModelSize / DEFAULT_MODEL_PRESETS keys). */
const VALID_SIZES: readonly string[] = ["S", "M", "L", "XL"];

/** Age (ms) beyond which an overlay `verified_at` is rendered as stale in `models list`. */
const STALENESS_THRESHOLD_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

/**
 * ModelCommands provides the Solo curation surface. Display commands read the injected
 * `IModelRegistry` (the DefaultModelRegistry floor); `config model` writes curated lists
 * to exa.config.toml via TOML write-back (the resolver's read surface).
 */
export class ModelCommands {
  constructor(
    private readonly registry: IModelRegistry,
    private readonly configPath?: string,
  ) {}

  // ── Display: models list / models pricing ──────────────────────────────────

  /** `models list` — provider:model, provenance, and verified_at staleness from the floor. */
  async listModels(): Promise<void> {
    const providers = await this.registry.getAllProviders();
    const rows: string[][] = [];
    for (const provider of providers) {
      const models = await this.registry.getProviderModels(provider);
      for (const m of models) {
        const pricing = await this.registry.getModelPricing(m.provider, m.model);
        rows.push([
          `${m.provider}:${m.model}`,
          pricing.provenance,
          this.renderVerifiedAt(pricing.verifiedAt),
        ]);
      }
    }
    const table = new Table()
      .header([colors.bold("Model"), colors.bold("Provenance"), colors.bold("Verified")])
      .body(rows);
    console.log(colors.cyan(colors.bold("\nModel Registry (Solo floor)")));
    table.render();
    console.log("");
  }

  /** `models pricing` — per-Mtok input/output prices with provenance from the floor. */
  async showPricing(): Promise<void> {
    const providers = await this.registry.getAllProviders();
    const rows: string[][] = [];
    for (const provider of providers) {
      const models = await this.registry.getProviderModels(provider);
      for (const m of models) {
        const pricing = await this.registry.getModelPricing(m.provider, m.model);
        rows.push([
          `${m.provider}:${m.model}`,
          this.renderPrice(pricing.inputPerMtok),
          this.renderPrice(pricing.outputPerMtok),
          pricing.provenance,
        ]);
      }
    }
    const table = new Table()
      .header([
        colors.bold("Model"),
        colors.bold("Input $/Mtok"),
        colors.bold("Output $/Mtok"),
        colors.bold("Provenance"),
      ])
      .body(rows);
    console.log(colors.cyan(colors.bold("\nModel Pricing (Solo floor)")));
    table.render();
    console.log("");
  }

  // ── Curation: config model ──────────────────────────────────────────────────

  /**
   * `config model --size <S> <entries…>` — validate and write a curated candidate list.
   * Solo semantics (G10): each entry's provider must parse; an unregistered provider is
   * allowed (flagged `unconfigured` on read); an ambiguous bare name is rejected. The
   * whole write is atomic — any rejection leaves the file untouched (no partial state).
   */
  async setCandidates(size: string, entries: string[]): Promise<void> {
    this.assertValidSize(size);
    await this.validateEntries(entries); // throws before any write on ambiguity
    const deduped = this.dedup(entries);
    await this.mutateConfig((cfg) => {
      const preset = this.ensurePreset(cfg, size);
      preset.candidates = deduped;
    });
  }

  /**
   * `config model --size <S> --characteristic <name> <entries…>` — write a
   * characteristic sub-list (intra-pool reorder hint the resolver honours).
   */
  async setCharacteristic(size: string, name: string, entries: string[]): Promise<void> {
    this.assertValidSize(size);
    await this.validateEntries(entries);
    const deduped = this.dedup(entries);
    await this.mutateConfig((cfg) => {
      const preset = this.ensurePreset(cfg, size);
      preset.characteristics = { ...(preset.characteristics ?? {}), [name]: deduped };
    });
  }

  /** `config model --size <S> --clear` — reset the curated list to empty (idempotent). */
  async clearCandidates(size: string): Promise<void> {
    this.assertValidSize(size);
    await this.mutateConfig((cfg) => {
      const preset = this.ensurePreset(cfg, size);
      preset.candidates = [];
    });
  }

  /**
   * `config model --list` — the curated lists per size, each entry annotated with
   * whether its provider is registered (`unconfigured`).
   */
  async listCandidates(): Promise<Record<string, ISizeCandidates>> {
    const cfg = this.readConfig();
    const registered = new Set(await this.registry.getAllProviders());
    const result: Record<string, ISizeCandidates> = {};
    const presets = cfg.model_presets ?? {};
    for (const [size, preset] of Object.entries(presets)) {
      const candidates = preset.candidates ?? [];
      result[size] = {
        entries: candidates.map((entry) => ({
          entry,
          unconfigured: !registered.has(this.providerOf(entry)),
        })),
      };
    }
    return result;
  }

  // ── Validation helpers ───────────────────────────────────────────────────────

  private assertValidSize(size: string): void {
    if (!VALID_SIZES.includes(size)) {
      throw new Error(`Invalid model size "${size}". Expected one of: ${VALID_SIZES.join(", ")}.`);
    }
  }

  /**
   * Validate each entry (Solo G10). A curated entry is a **provider name** — the form
   * the resolver's tryResolveCurated reads (it looks each entry up via
   * ProviderRegistry.getProviderMetadata). A registered provider passes; an unknown
   * entry that also matches a model name owned by >1 provider is ambiguous (the user
   * likely typed a model instead of a provider) and is rejected with the qualifying
   * options; any other unknown entry is allowed and later flagged `unconfigured`.
   */
  private async validateEntries(entries: string[]): Promise<void> {
    const registered = new Set(await this.registry.getAllProviders());
    for (const entry of entries) {
      const provider = this.providerOf(entry);
      if (registered.has(provider)) continue; // known provider — usable
      const matches = await this.matchesForBareName(entry);
      if (matches.length > 1) {
        throw new Error(
          `Ambiguous model name "${entry}". Did you mean one of: ${matches.join(", ")}? ` +
            `Curate a provider name (e.g. anthropic), not a model.`,
        );
      }
    }
  }

  /** All `provider:model` pairs in the floor whose model equals the bare name. */
  private async matchesForBareName(bareName: string): Promise<string[]> {
    const providers = await this.registry.getAllProviders();
    const matches: string[] = [];
    for (const provider of providers) {
      const models = await this.registry.getProviderModels(provider);
      for (const m of models) {
        if (m.model === bareName) matches.push(`${m.provider}:${m.model}`);
      }
    }
    return matches;
  }

  private providerOf(entry: string): string {
    const idx = entry.indexOf(":");
    return idx > 0 ? entry.slice(0, idx) : entry;
  }

  private dedup(entries: string[]): string[] {
    return [...new Set(entries)];
  }

  // ── TOML write-back ──────────────────────────────────────────────────────────

  private requireConfigPath(): string {
    if (!this.configPath) {
      throw new Error("No config path available for model curation (config model requires a config file).");
    }
    return this.configPath;
  }

  /**
   * Parse the config file. The raw parse result (the library's map type) is what we
   * hand back to `stringify` on write so untyped keys survive the round-trip; the
   * `IConfigToml` view narrows only the `model_presets` slice we read/mutate.
   */
  private readRawConfig(): ReturnType<typeof parse> {
    const path = this.requireConfigPath();
    return parse(Deno.readTextFileSync(path));
  }

  private readConfig(): IConfigToml {
    return this.readRawConfig() as IConfigToml;
  }

  private async mutateConfig(mutate: (cfg: IConfigToml) => void): Promise<void> {
    const path = this.requireConfigPath();
    const raw = this.readRawConfig();
    mutate(raw as IConfigToml);
    await Deno.writeTextFile(path, stringify(raw));
  }

  /**
   * Return the preset object for `size`, creating it seeded with the schema-required
   * base fields (from DEFAULT_MODEL_PRESETS) when absent — so a curated write never
   * leaves `model_presets.<size>` missing max_cost_per_mtok / min_context_window /
   * supports_thinking, which would make the config fail ConfigService validation.
   */
  private ensurePreset(cfg: IConfigToml, size: string): IModelPresetToml {
    cfg.model_presets ??= {};
    if (!cfg.model_presets[size]) {
      const base = DEFAULT_MODEL_PRESETS[size];
      cfg.model_presets[size] = base
        ? {
          max_cost_per_mtok: base.max_cost_per_mtok,
          min_context_window: base.min_context_window,
          supports_thinking: base.supports_thinking,
        }
        : {};
    }
    return cfg.model_presets[size];
  }

  // ── Rendering helpers ─────────────────────────────────────────────────────────

  private renderVerifiedAt(verifiedAt?: Opt<number, Reason.OptionalInput>): string {
    if (verifiedAt === undefined) return "-";
    const age = Date.now() - verifiedAt;
    const date = new Date(verifiedAt).toISOString().slice(0, 10);
    return age > STALENESS_THRESHOLD_MS ? `${date} (stale)` : date;
  }

  private renderPrice(price?: Opt<number, Reason.OptionalInput>): string {
    return price === undefined ? "-" : `$${price}`;
  }
}
