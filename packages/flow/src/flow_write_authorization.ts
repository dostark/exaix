/**
 * @module FlowWriteAuthorization
 * @path packages/flow/src/flow_write_authorization.ts
 * @description Retains audited writes by flow trace and physical execution root for later cumulative Git audits.
 * @architectural-layer Flows
 * @dependencies [@exaix/session]
 * @related-files [packages/flow/src/agent_composer_adapter.ts, packages/flow/src/step_handlers/session_delegate_cycle_step_handler.ts]
 */
import { checkScope } from "@exaix/session/scope_checker.ts";

export interface IFlowWriteAuthorization {
  get(traceId: string, executionRoot: string): Promise<Set<string>>;
  record(
    traceId: string,
    executionRoot: string,
    paths: readonly string[],
    resolvePath: (path: string) => Promise<string>,
  ): Promise<void>;
}

/** Keeps volatile audit bookkeeping. Existing cycle and strategy events record the underlying writes and review. */
export class FlowWriteAuthorization implements IFlowWriteAuthorization {
  private readonly entries = new Map<string, Set<string>>();

  constructor(private readonly maxEntries: number) {}

  async get(traceId: string, executionRoot: string): Promise<Set<string>> {
    const key = JSON.stringify([traceId, await Deno.realPath(executionRoot)]);
    const paths = this.entries.get(key) ?? new Set<string>();
    this.entries.delete(key);
    if (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest) this.entries.delete(oldest);
    }
    this.entries.set(key, paths);
    return paths;
  }

  /** Accept only reconciled, reviewed paths, with physical confinement checked before adding any path. */
  async record(
    traceId: string,
    executionRoot: string,
    paths: readonly string[],
    resolvePath: (path: string) => Promise<string>,
  ): Promise<void> {
    const realRoot = await Deno.realPath(executionRoot);
    const scope = checkScope([...paths], [...paths], realRoot);
    if (scope.violations.length) throw new Error("Reviewed cycle paths escape the execution root");
    await Promise.all(scope.accepted.map(resolvePath));
    const authorized = await this.get(traceId, realRoot);
    for (const path of scope.accepted) authorized.add(path);
  }
}
