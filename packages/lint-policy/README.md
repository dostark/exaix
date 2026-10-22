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
- `src/rule_pack/` — `EXAIX_RULE_PACK`: the extension point for plugin rules that encode Exaix conventions. It is
  currently empty. Generic interface conventions live in the TypeScript pack.
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
currently has no rule. The 16 catalog entries hosted by scripts comprise 14 Exaix checks and two
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

- `deno task unslop rules list --format=json` lists the 59 resolved rules and checks.
- `deno task unslop:write rules set <id> <option>=<json> --dry-run` previews an authored edit; drop
  `--dry-run` to write it.
- `deno task lint:report --format=json <paths>` runs the real lint host and reports observed coverage.
  `--format=markdown` and `--format=sarif` select the other formats.
- `deno task lint:report:write --format=json --out=report.json <paths>` writes a no-clobber report.

The descriptor is `unslop.project.ts`. The five existing whole-tree tasks pass
the descriptor flag; `check:constant-restatement` retains only
`--allow-read` and `--allow-env`. The historical version 1 snapshot is
`tests/fixtures/catalog_v1.json`, not an active input.
