/**
 * @module CatalogParity
 * @path tests/eval/catalog_parity.ts
 * @architectural-layer Test
 * @description Generic parity harness for subsystem evaluation packs.
 *   Provides assertCatalogCovered() to verify every catalog entry has at least
 *   one eval scenario tagged with its entity id, minus an exclusion list.
 * @dependencies []
 * @related-files [tests/eval/tool_eval_parity_test.ts, tests/eval/catalog_parity_harness_test.ts]
 */

export interface ICatalogParityOptions {
  catalogIds: string[];
  scenarioCatalog: Array<{ id: string; tags: string[] }>;
  subsystemTag: string;
  exclusions: string[];
}

export function assertCatalogCovered(options: ICatalogParityOptions): string[] {
  const { catalogIds, scenarioCatalog, subsystemTag, exclusions } = options;

  const coveredIds = new Set<string>();
  for (const scenario of scenarioCatalog) {
    if (!scenario.tags.some((t) => t === subsystemTag)) continue;
    for (const tag of scenario.tags) {
      if (tag.startsWith("entity:")) {
        coveredIds.add(tag.slice("entity:".length));
      }
    }
  }

  return catalogIds.filter(
    (id) => !coveredIds.has(id) && !exclusions.includes(id),
  );
}
