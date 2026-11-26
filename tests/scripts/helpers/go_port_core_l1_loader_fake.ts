/**
 * @module GoPortCoreL1LoaderFake
 * @path tests/scripts/helpers/go_port_core_l1_loader_fake.ts
 * @description Provides fake loader runners that answer from the authored specs without the pinned loaders.
 * @architectural-layer Test
 */
import type {
  IBlueprintObservation,
  IBlueprintSpec,
  IContextObservation,
  IContextSpec,
  TBlueprintRunner,
  TContextRunner,
} from "../../../scripts/go_port/core_l1_loader_reference.ts";

const NO_TOKENS = 0;

/** Reports an absent file for a missing spec and an unexpected error for any other. */
export const fakeBlueprintRunner: TBlueprintRunner = (
  _snapshot: string,
  specs: readonly IBlueprintSpec[],
): Promise<readonly IBlueprintObservation[]> =>
  Promise.resolve(
    specs.map((spec): IBlueprintObservation =>
      spec.present
        ? { outcome: "error", error: { kind: "unexpected", message: spec.id, paths: [] }, warnings: [] }
        : { outcome: "absent", warnings: [] }
    ),
  );

/** Reports that every requested file was included. */
export const fakeContextRunner: TContextRunner = (
  _snapshot: string,
  specs: readonly IContextSpec[],
): Promise<readonly IContextObservation[]> =>
  Promise.resolve(specs.map((spec): IContextObservation => ({
    content: "",
    warnings: [],
    totalTokens: NO_TOKENS,
    includedFiles: [...spec.requested],
    skippedFiles: [],
    truncatedFiles: [],
  })));
