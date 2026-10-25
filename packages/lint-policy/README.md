# @exaix/lint-policy

All Exaix lint policy. It configures the generic engine in the `unslop-ts` submodule (`@dostark/unslop-ts`) and holds the
style checkers that still run as standalone scripts.

## Layout

- `unslop.config.json` — the version 2 policy: severity, scope, options, tags, limits, and exclusions.
- `layout.json` — the repository path tokens that the checkers read.
- `src/policy_config.ts` — the pure compiler that exports `POLICY_CONFIG` and `POLICY_CATALOG`.
- `plugin.ts` — the `deno lint` plugin entry and compiled project view, loaded through `deno.json` `lint.plugins`.
- `rule_ceilings.json` — the per-package counts that hold each parked rule at a measured ceiling.
- `src/checkers/` — `check_code_style.ts` and `check_magic_values.ts`, run by `deno task check:style` and `deno task check:magic`.
- `src/rule_pack/` — `EXAIX_RULE_PACK`: the plugin rules that encode Exaix conventions. It holds
  `unslop-isolation`. Generic interface conventions live in the TypeScript pack.
- `src/rule_packs.ts` — the rule packs and the registry that `plugin.ts` and the style checker share.
- `src/repo_layout.ts` — the checkers' reader for `layout.json`.
- `docs/style_rules.md` — the rule reference, generated from the compiled policy by `deno task docs:style-rules`.
- `docs/style_guide.md` — the Exaix additions to the generic style guide in `unslop-ts/docs/`.
- `tests/` — the tests for the checkers and the catalog.

## Add an Exaix plugin rule

1. Implement `create(context, ctx)` in `src/rule_pack/<rule>.ts`, using the engine rule-pack contract.
1. Register it in `EXAIX_RULE_PACK` (`src/rule_pack/mod.ts`) under its bare rule key, with an option schema.
1. Add the `exaix/<rule key>` entry to `unslop.config.json` with its level, scope, docs, and tags.
1. Add named valid and invalid cases under `tests/`, then run `deno task docs:style-rules`.

A rule that is not specific to Exaix belongs in `unslop-ts` instead. A script checker (`engine: "script"`) is the
fallback for a rule that needs the whole repository.

## Rule ownership

The engine supplies 35 TypeScript plugin rules and four Deno plugin rules. The catalog configures all
39 with Exaix scopes, severities, exclusions, boundary zones, and opt-in conventions. `EXAIX_RULE_PACK`
holds one rule, `exaix/unslop-isolation`. The 16 catalog entries hosted by scripts comprise 14 Exaix checks and two
generic whole-tree library checks. `check:style` calls the engine's duplicate-type checker;
`check:magic` calls its duplicate-constant and repeated-literal checkers. The latter reads
`wholeTree.magicLiterals`, rather than a rule entry.

The [generic guide](../../unslop-ts/docs/style_guide.md) belongs to the engine.
[The Exaix guide](../../docs/CODE_STYLE.md) and this package's additions describe project policy.
A catalog `codeStyle` anchor replaces an engine rule's default guide link.

## Tasks

- `deno task lint` — runs the plugin with every enabled rule.
- `deno task check:style` and `deno task check:magic` — run the two checkers.
  `check:magic` keeps the configured `wholeTree.magicLiterals.checkNumbers` value unless `--no-numbers`
  or `--strings-only` is present. Either flag turns number checks off, and no flag turns them on.
- `deno task docs:style-rules` — regenerates the rule reference.
- `deno task unslop-ts:deploy` — moves the engine pointer after a compatibility check.

## Related

- [unslop-ts](../../unslop-ts/README.md) — the generic lint engine.
- `deno task unslop-ts:deploy` — moves the engine pointer after a compatibility check.
- [docs/CODE_STYLE.md](../../docs/CODE_STYLE.md) — the other Exaix style rules.

## Tasks and reports

- `deno task unslop rules list --format=json` lists the 60 resolved rules and checks.
- `deno task unslop:write rules set <id> <option>=<json> --dry-run` previews an authored edit; drop
  `--dry-run` to write it.
- `deno task lint:report --format=json <paths>` runs the real lint host and reports observed coverage.
  `--format=markdown` and `--format=sarif` select the other formats.
- `deno task lint:report:write --format=json --out=report.json <paths>` writes a no-clobber report.

The descriptor is `unslop.project.ts`. The five existing whole-tree tasks pass
the descriptor flag; `check:constant-restatement` retains only
`--allow-read` and `--allow-env`. The historical version 1 snapshot is
`tests/fixtures/catalog_v1.json`, not an active input.

Exaix uses the Deno host through `@dostark/unslop-ts/deno`. The `@dostark/unslop-ts/eslint` entry
exists for ESLint and Oxlint consumers; no Exaix runtime path imports it.

## Portal verification packaging

The daemon's `unslop` post-execution check never imports this package or the engine source. It reads
a packaged asset set from `<system root>/lint`:

| File                              | Content                                                                                   |
| --------------------------------- | ----------------------------------------------------------------------------------------- |
| `unslop_engine.js`                | the engine bundle built by the engine's own `bundle` task                                 |
| `unslop_portal_catalog.json`      | the compiled TypeScript-only portal catalog                                               |
| `unslop_portal_deno_catalog.json` | the compiled TypeScript and Deno portal catalog                                           |
| `manifest.json`                   | format and policy versions, Deno version, engine Git SHA and package version, file hashes |

`deno task unslop-ts:bundle` is the single builder. It runs the engine bundle task once, verifies the
engine's published checksum, compiles both catalogs from the strict portal policy (`unslop:strict`,
no script rules, no whole-tree hosts), validates each catalog with the packaged registry, and writes
the manifest last. A failed build therefore leaves no complete asset set behind.

Provenance: the manifest records the engine Git SHA, the engine package version and the Deno version.
A consumer verifies every file against its recorded size and SHA-256 before use. A size or checksum
mismatch raises `UnslopAssetInvalid` and never falls back to engine source or the network.

Deployment: a source checkout builds the set and copies it into `<deploy>/lint`. A redeploy from a
deployed workspace has no engine source and no builder, so it verifies the existing four files and
copies them to the new destination. It never downloads, re-initializes, or recompiles the engine. The
deployed `deno.json` drops the `unslop-ts` workspace member and every task that runs this package or
the builder.

Offline scope: the lint child runs `deno lint --deny-import` with a generated local `deno.json` and a
cleared environment that forwards only `DENO_DIR`, `DENO_NO_UPDATE_CHECK` and `XDG_CACHE_HOME`.
Remote imports are denied, so the check needs only the local asset set plus the daemon's warm Deno
cache. A cold-cache offline boot of the whole daemon is out of scope.

Recovery: a source checkout runs `deno task unslop-ts:bundle`, then redeploys. A deployed workspace
with missing or corrupt assets must redeploy from an initialized source checkout, because it cannot
repair itself.

Capped review output: the terminal `execution.verification.lint_findings` snapshot keeps at most
`verification.unslop.findings_limit` findings (default `50`). The review prints the exact total plus
the listed `file:line rule` entries, `(<n> more not listed)` when the total is larger, and
`(coverage incomplete)` when a check did not complete. A null total means unknown, never zero. A
`repaired` or `passed` run lists no findings.
