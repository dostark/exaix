/**
 * @module NetPolicy
 * @path packages/core/src/security/net_policy.ts
 * @description Daemon self-enforcement of the `[system].allow_net` outbound policy
 *   (Phase 124 full-alignment). The launcher's `--allow-net` flag is the primary
 *   enforcement, but direct-run paths (`deno task dev`) and the compiled `exaix`
 *   binary freeze their flags at build time and cannot read `allow_net` at runtime.
 *   This pure check lets the daemon verify, at startup, that the net access it was
 *   actually granted does not exceed what `allow_net` permits — closing the gap
 *   where `allow_net=[]` ("block all outbound") was silently ignored by those paths.
 *
 *   Limitation: Deno reports net permission at the blanket level, not per-host, so
 *   a host-allowlist policy (non-empty `allow_net`) cannot be process-verified here
 *   — that remains enforced by the launcher's `--allow-net=<hosts>` flag. The one
 *   policy this check CAN enforce universally is the strict block (`allow_net=[]`):
 *   if the process holds net access while the config says block, that is a
 *   violation regardless of launch path.
 * @architectural-layer Shared
 * @related-files ["apps/daemon/main.ts", "packages/core/src/types/constants.ts"]
 */

/** Inputs to the net-policy evaluation. */
export interface INetPolicyInput {
  /** The configured `[system].allow_net` value (undefined = default hosts; [] = block). */
  readonly allowNet: readonly string[] | undefined;
  /** Whether the running process was actually granted (blanket) net access. */
  readonly grantedNet: boolean;
}

/** Result of evaluating the net policy against the granted permissions. */
export interface INetPolicyResult {
  /** True when the granted net access exceeds what `allow_net` permits. */
  readonly violated: boolean;
  /** Human-readable explanation when `violated` is true. */
  readonly reason?: string;
}

/** Flags a violation only when `allow_net=[]` (strict block) but net was granted anyway;
 *  other policies are enforced by the launcher's `--allow-net` flag. */
export function evaluateNetPolicy(input: INetPolicyInput): INetPolicyResult {
  const isStrictBlock = input.allowNet !== undefined && input.allowNet.length === 0;
  if (isStrictBlock && input.grantedNet) {
    return {
      violated: true,
      reason: "[system].allow_net is [] (outbound blocked) but the daemon process holds network access — " +
        "it was launched without the narrowing --allow-net flag (e.g. a compiled binary or `deno task dev`). " +
        "Relaunch via `exactl daemon start` / the dogfood launcher, or rebuild the binary with the narrowed flag.",
    };
  }
  return { violated: false };
}
