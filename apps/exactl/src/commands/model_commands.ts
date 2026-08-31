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
import type { IBenchmarkReader, IModelRegistry, Opt, Reason } from "@exaix/core/types";
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

/** Options for `models list`; `--benchmark` adds an optional advisory score column. */
export interface IListModelsOptions {
  benchmark?: string;
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
 * Only `model_presets` is typed; other keys survive the parse→mutate→stringify round-trip.
 */
export interface IConfigToml {
  model_presets?: IPresetMap;
  /** The Team live-registry block; only `enabled` is read by the CLI. */
  model_registry?: { enabled?: boolean };
}

/** Valid capability tiers for curated lists (mirrors ModelSize / DEFAULT_MODEL_PRESETS keys). */
const VALID_SIZES: readonly string[] = ["S", "M", "L", "XL"];

/** Age (ms) beyond which an overlay `verified_at` is rendered as stale in `models list`. */
const STALENESS_THRESHOLD_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

/** Display commands read the injected `IModelRegistry` floor; `config model` writes
 *  curated lists to exa.config.toml via TOML write-back. */
export class ModelCommands {
  constructor(
    private readonly registry: IModelRegistry,
    private readonly configPath?: Opt<string, Reason.OptionalInput>,
    private readonly benchmarkReader?: Opt<IBenchmarkReader, Reason.OptionalDependency>,
  ) {}

  // Display: models list / models pricing

  /** `models list [--benchmark <name>]` shows provider:model, provenance, and verified_at
   *  staleness; `--benchmark` adds an advisory score column, "-" when unscored. */
  async listModels(options?: Opt<IListModelsOptions, Reason.OptionalInput>): Promise<void> {
    const providers = await this.registry.getAllProviders();
    const rows: string[][] = [];
    for (const provider of providers) {
      const models = await this.registry.getProviderModels(provider);
      for (const m of models) {
        const pricing = await this.registry.getModelPricing(m.provider, m.model);
        const row = [
          `${m.provider}:${m.model}`,
          pricing.provenance,
          this.renderVerifiedAt(pricing.verifiedAt),
        ];
        if (options?.benchmark) {
          row.push(await this.renderBenchmarkScore(m.provider, m.model, options.benchmark));
        }
        rows.push(row);
      }
    }
    const headers = [colors.bold("Model"), colors.bold("Provenance"), colors.bold("Verified")];
    if (options?.benchmark) {
      headers.push(colors.bold(`Benchmark (${options.benchmark})`));
    }
    const table = new Table().header(headers).body(rows);
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

  // Team: models refresh

  /** `models refresh` (Team surface). Refresh runs inside the daemon's
   *  RegistryRefreshScheduler; the CLI holds only the Solo floor, so this reads
   *  `model_registry.enabled` to decide whether to refuse or guide. */
  // deno-lint-ignore require-await -- async so the guard's synchronous throw rejects the promise
  async refreshModels(): Promise<void> {
    const cfg = this.readConfig();
    if (cfg.model_registry?.enabled !== true) {
      throw new Error(
        "models refresh requires the Team live registry: set `model_registry.enabled = true` " +
          "in exa.config.toml and run a Team daemon (EXAIX_EDITION=team). It is a no-op in Solo.",
      );
    }
    console.log(
      colors.cyan(
        "The Team daemon refreshes the model catalog on its configured cron " +
          "(`model_registry.catalog_refresh_cron`). To refresh immediately, set " +
          "`model_registry.refresh_on_start = true` and restart the daemon.",
      ),
    );
  }

  // Curation: config model

  /** `config model --size <S> <entries…>` validates and writes a curated candidate list.
   *  An unregistered provider is allowed (flagged `unconfigured`); an ambiguous bare name
   *  is rejected. The write is atomic — any rejection leaves the file untouched. */
  async setCandidates(size: string, entries: string[]): Promise<void> {
    this.assertValidSize(size);
    await this.validateEntries(entries); // throws before any write on ambiguity
    const deduped = this.dedup(entries);
    await this.mutateConfig((cfg) => {
      const preset = this.ensurePreset(cfg, size);
      preset.candidates = deduped;
    });
  }

  /** `config model --size <S> --characteristic <name> <entries…>` writes a characteristic sub-list (intra-pool reorder hint the resolver honours). */
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

  /** `config model --list` returns the curated lists per size, each entry annotated with whether its provider is registered (`unconfigured`). */
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

  // Validation helpers

  private assertValidSize(size: string): void {
    if (!VALID_SIZES.includes(size)) {
      throw new Error(`Invalid model size "${size}". Expected one of: ${VALID_SIZES.join(", ")}.`);
    }
  }

  /** A curated entry is a provider name, not a model name; an unknown entry ambiguous across >1 provider is rejected, any other unknown entry is allowed and later flagged `unconfigured`. */
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

  // TOML write-back

  private requireConfigPath(): string {
    if (!this.configPath) {
      throw new Error("No config path available for model curation (config model requires a config file).");
    }
    return this.configPath;
  }

  /** Returns the raw parse result (not narrowed) — handed back to `stringify` on write
   *  so untyped keys survive the round-trip. */
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

  /** Creates the preset for `size`, seeded from DEFAULT_MODEL_PRESETS when absent, so a
   *  curated write never leaves required fields missing (ConfigService would fail validation). */
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

  // Rendering helpers

  private renderVerifiedAt(verifiedAt?: Opt<number, Reason.OptionalInput>): string {
    if (verifiedAt === undefined) return "-";
    const age = Date.now() - verifiedAt;
    const date = new Date(verifiedAt).toISOString().slice(0, 10);
    return age > STALENESS_THRESHOLD_MS ? `${date} (stale)` : date;
  }

  private renderPrice(price?: Opt<number, Reason.OptionalInput>): string {
    return price === undefined ? "-" : `$${price}`;
  }

  /** "-" when no reader is wired (Solo) or the model is unscored on `benchmark`. */
  private async renderBenchmarkScore(provider: string, model: string, benchmark: string): Promise<string> {
    if (!this.benchmarkReader) return "-";
    const score = await this.benchmarkReader.getBenchmark(provider, model, benchmark);
    return score === undefined ? "-" : score.toFixed(3);
  }
}
