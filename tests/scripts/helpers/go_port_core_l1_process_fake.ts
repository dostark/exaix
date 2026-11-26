/**
 * @module GoPortCoreL1ProcessFake
 * @path tests/scripts/helpers/go_port_core_l1_process_fake.ts
 * @description Returns a deterministic process observation without starting a child.
 * @architectural-layer Test
 */
import type {
  IProcessObservation,
  IProcessSpec,
  TProcessRunner,
} from "../../../scripts/go_port/core_l1_process_reference.ts";

/** A fake runner that echoes the spec and bounds each stream to the requested size. */
export const fakeProcessRunner: TProcessRunner = (
  _snapshot: string,
  spec: IProcessSpec,
): Promise<IProcessObservation> =>
  Promise.resolve({
    id: spec.id,
    argv: spec.args,
    cwd: spec.cwd,
    environment_keys: [...spec.environment.map((entry) => entry.key)].sort(),
    stdout: "O".repeat(spec.maxOutputBytes),
    stderr: "E".repeat(spec.maxOutputBytes),
    exit_code: 3,
    category: "failed",
  });
