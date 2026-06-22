/**
 * @module OptionalMarker
 * @path packages/core/src/types/optional_marker.ts
 * @description Marker type + reason dictionary for parameters whose optionality
 * is by design. Every Opt<T, R> usage must include a codified
 * reason proving the decision was reviewed, not mechanical.
 * @architectural-layer Core
 * @related-files [scripts/check_optional_params.ts]
 */

/**
 * Codified reasons why a parameter is intentionally optional.
 *
 * Every Opt usage must include one of these enum values as
 * the second type argument. There is no catch-all — if none of these categories
 * fits, a new category must be added (proving the decision was deliberately
 * reviewed, not mechanically bypassed).
 */
export enum Reason {
  /** Test factory — caller overrides only fields they care about. */
  TestOverride = "test_override",
  /** Test stub — provides default mock content. */
  TestStub = "test_stub",
  /** Recursive helper — initial call omits, recursive calls populate. */
  RecursiveOmit = "recursive_omit",
  /** Coercion utility — well-known default fallback. */
  CoercionDefault = "coercion_default",
  /** Factory function — applies built-in presets when omitted. */
  FactoryPreset = "factory_preset",
  /** Parameter has a sensible constant default for common cases. */
  SensibleDefault = "sensible_default",
  /** TUI rendering default — sensible visual default. */
  UiDefault = "ui_default",
  /** Abstract/interface method — contract does not require it. */
  AbstractBoundary = "abstract_boundary",
  /** Optional DI dependency — only needed on some code paths. */
  OptionalDependency = "optional_dependency",
  /** Trace/request ID absent in some execution contexts. */
  TraceAbsent = "trace_absent",
  /** Caller may not need cancellation/abort signal. */
  CancellationOptional = "cancellation_optional",
  /** Optional query filter — omitted when no filtering needed. */
  QueryFilter = "query_filter",
  /** Optional data input — enriches output but not required for basic flow. */
  OptionalInput = "optional_input",
  /** Optional execution tuning parameter — falls back to global config. */
  ExecutionConfig = "execution_config",
  /** Optional context — enriches logging/events but safely absent. */
  OptionalContext = "optional_context",
}

/**
 * Wrapper type that marks a parameter as intentionally optional/undefined-
 * accepting, with a codified reason proving the decision was deliberate.
 *
 * `T | undefined` at runtime. The second type parameter forces every usage to
 * embed a reason from Reason, preventing mechanical bypasses.
 *
 * The optional-params checker (scripts/check_optional_params.ts) detects this
 * wrapper and suppresses UNUSED/REDUNDANT violations. It also flags usages
 * where the marker is applied to a non-optional parameter (no `?`, no default)
 * as MARKED_NOT_OPTIONAL.
 *
 * Usage:
 *   function foo(param?: Opt<string, Reason.AbstractBoundary>)
 *   function bar(param: Opt<number, Reason.SensibleDefault> = 10)
 *   function baz(db: Opt<IDatabaseService, Reason.OptionalDependency>)
 */
export type Opt<T, R extends Reason> = T | undefined;
