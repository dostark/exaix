# @exaix/lint-policy

All Exaix lint policy. It configures the generic engine in `packages/lint-rules` and holds the
style checkers that still run as standalone scripts.

## Layout

- `catalog.json` — the validated rule catalog: severity, scope, options, tags, and exclusions.
- `plugin.ts` — the `deno lint` plugin entry, loaded through `deno.json` `lint.plugins`.
- `rule_ceilings.json` — the per-package counts that hold each parked rule at a measured ceiling.
- `src/checkers/` — `check_code_style.ts` and `check_magic_values.ts`, run by `deno task check:style` and `deno task check:magic`.
- `src/rule_pack/` — `EXAIX_RULE_PACK`: the plugin rules that encode Exaix conventions. The first rule is
  `exaix/exported-interface-naming`.
- `src/rule_packs.ts` — the rule packs and the registry that `plugin.ts` and the style checker share.
- `src/repo_layout.ts` — the repository path tokens the checkers read from the catalog.
- `docs/style_rules.md` — the rule reference, generated from the catalog by `deno task docs:style-rules`.
- `docs/style_guide.md` — the Exaix additions to the generic style guide in `packages/lint-rules/docs/`.
- `tests/` — the tests for the checkers and the catalog.

## Tasks

- `deno task lint` — runs the plugin with every enabled rule.
- `deno task check:style` and `deno task check:magic` — run the two checkers.
- `deno task docs:style-rules` — regenerates the rule reference.

## Related

- [packages/lint-rules](../lint-rules/README.md) — the generic lint engine.
- [CODE_STYLE.md](../../CODE_STYLE.md) — the other Exaix style rules.
