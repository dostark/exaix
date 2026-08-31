/**
 * @module PresetMapper
 * @path packages/flow/src/preset_mapper.ts
 * @description Utility for mapping dynamicModel preset strings (small/medium/large/xl)
 *   to ModelSize literal types for ModelResolver resolution.
 * @architectural-layer Flow
 * @dependencies [@exaix/schemas]
 * @related-files [packages/flow/src/flow_runner.ts, packages/ai/src/model_resolver.ts]
 */

import type { ModelSize } from "@exaix/schemas";

export function mapPresetToSize(preset: string): ModelSize | undefined {
  switch (preset) {
    case "small":
      return "S";
    case "medium":
      return "M";
    case "large":
      return "L";
    case "xl":
      return "XL";
    default:
      return undefined;
  }
}
