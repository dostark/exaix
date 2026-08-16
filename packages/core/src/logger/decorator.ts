/**
 * @module LoggingDecorator
 * @path packages/core/src/logger/decorator.ts
 * @description Method decorator family for automated execution logging: `LogMethod` (async),
 *   `LogSyncMethod` (sync), `LogGeneratorMethod` (async generator) — each wraps a method and
 *   emits started/completed/failed lifecycle events through the supplied `EventLogger`, with
 *   `action` constrained to real `DomainEventType` members and an optional `payloadMapper` to
 *   shape the success payload.
 * @architectural-layer Core
 * @related-files [packages/core/src/logger/event_logger.ts, packages/core/src/events/domain_event_types.ts]
 */
import type { EventLogger } from "./event_logger.ts";
import { DEFAULT_UNKNOWN_LABEL } from "../types/constants.ts";
import { type JSONValue, toSafeJson } from "../types/json.ts";
import type { TDomainEventType } from "@exaix/core/events";
import type { Opt, Reason } from "@exaix/core/types";

type SafeJsonInput = string | number | boolean | null | undefined | SafeJsonInput[] | { [key: string]: SafeJsonInput };

/** Every `Log*Method` decorator variant shares this generic-function-type shape,
 *  parameterized so `LogMethod`/`LogSyncMethod`/`LogGeneratorMethod` below can each
 *  return the concrete instantiation for their own target/return shape. */
type AsyncMethodDecorator<This, Args extends unknown[], Return> = (
  target: (this: This, ...args: Args) => Promise<Return>,
  context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Promise<Return>>,
) => ((this: This, ...args: Args) => Promise<Return>) | void;

/** `LogSyncMethod`'s decorator shape — target/replacement return `Return` directly,
 *  not `Promise<Return>`; the wrapper never `await`s the target call. */
type SyncMethodDecorator<This, Args extends unknown[], Return> = (
  target: (this: This, ...args: Args) => Return,
  context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Return>,
) => ((this: This, ...args: Args) => Return) | void;

/** `LogGeneratorMethod`'s decorator shape — target/replacement return
 *  `AsyncGenerator<Yield>`; the wrapper brackets iteration, not invocation (see the
 *  module-level note on `LogGeneratorMethod` below). */
type AsyncGeneratorMethodDecorator<This, Args extends unknown[], Yield> = (
  target: (this: This, ...args: Args) => AsyncGenerator<Yield>,
  context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => AsyncGenerator<Yield>>,
) => ((this: This, ...args: Args) => AsyncGenerator<Yield>) | void;

/** Named payload shape for a decorated method's lifecycle events — replaces the previous ad
 *  hoc `{ args }` / `{ duration }` / `{ error, duration }` literals when the caller supplies
 *  a `payloadMapper`; falls back to this generic shape when omitted. */
export interface IMethodLogPayload {
  duration_ms?: number;
  error?: string;
  error_type?: string;
  [extra: string]: JSONValue;
}

/** Shapes a decorated call's success payload from its arguments and result. Only applied to
 *  the `completed` event — `started`/`failed` always use the generic default shape, so a
 *  caller cannot accidentally hide the failure detail behind a success-only mapper. */
export type PayloadMapper<Args extends unknown[], Return> = (
  args: Args,
  result?: Return,
) => IMethodLogPayload;

export interface ILogMethodOptions<Args extends unknown[], Return> {
  /** Existing DomainEventType member this call reports under. Omit to fall back to the
   *  dynamically-derived `${ClassName}.${methodName}` (exempt from the taxonomy — it is
   *  inherently unique per call site, not a hand-chosen ad hoc string). */
  action?: Opt<TDomainEventType, Reason.OptionalContext>;
  /** Shapes the success payload; defaults to `{ duration_ms }` when omitted. */
  payloadMapper?: Opt<PayloadMapper<Args, Return>, Reason.OptionalContext>;
}

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

/** Resolves the reported action name: the caller-supplied `action`, or the auto-derived
 *  `${ClassName}.${methodName}` fallback when omitted. */
function resolveActionName<This>(action: Opt<string, Reason.OptionalContext>, self: This, methodName: string): string {
  if (action) return action;
  // `self` is generic `This` at a decorated method's call site — TS cannot express "has a
  // constructor" without knowing the concrete class, so this is a deliberate, narrow cast.
  const instance = self as { constructor?: { name?: string } };
  const className = instance.constructor?.name || DEFAULT_UNKNOWN_LABEL;
  return `${className}.${methodName}`;
}

/** Builds the generic default `failed` payload from already-narrowed error fields — never
 *  shaped by `payloadMapper` (see its own doc comment), so error detail is never accidentally
 *  suppressed by a success-only mapper. Narrowing `error instanceof Error ? ... : ...` happens
 *  at each catch site (matching this codebase's established convention, e.g.
 *  `packages/execution/src/agent_runner.ts`), not here — a bare `catch (error)` keeps `error`
 *  implicitly `unknown` without an explicit annotation this file's style rules forbid. */
function errorFields(message: string, type: string, durationMs: number): IMethodLogPayload {
  return { duration_ms: durationMs, error: message, error_type: type };
}

/**
 * Wraps an async method, emitting `started`/`completed`/`failed` lifecycle events through
 * `logger`. `action` (when supplied) must be a real `DomainEventType` member — narrowed from
 * a bare `string` so a hand-chosen ad hoc string can no longer bypass the event taxonomy.
 */
export function LogMethod<This, Args extends unknown[], Return>(
  logger: EventLogger,
  options?: Opt<ILogMethodOptions<Args, Return>, Reason.OptionalContext>,
): AsyncMethodDecorator<This, Args, Return> {
  return function (
    target: (this: This, ...args: Args) => Promise<Return>,
    context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Promise<Return>>,
  ): ((this: This, ...args: Args) => Promise<Return>) | void {
    const methodName = String(context.name);

    return async function (this: This, ...args: Args): Promise<Return> {
      const actionName = resolveActionName(options?.action, this, methodName);
      const startTime = now();

      try {
        await logger.debug(actionName, "started", { args: toSafeJson(args as SafeJsonInput) });
        const result = await target.apply(this, args);
        const duration_ms = now() - startTime;
        const payload = options?.payloadMapper ? options.payloadMapper(args, result) : { duration_ms };
        await logger.info(actionName, "completed", payload);
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const type = error instanceof Error ? error.constructor.name : "unknown";
        await logger.error(actionName, "failed", errorFields(message, type, now() - startTime));
        throw error;
      }
    };
  };
}

/**
 * Wraps a synchronous method with the same started/completed/failed emission as `LogMethod`.
 * The wrapper itself stays synchronous (matching the target's `Return`, not `Promise<Return>`)
 * — logger calls are fired without `await` (the established `void logger.x(...)` convention
 * used elsewhere in this codebase, e.g. `TracedProvider`), never blocking the caller.
 */
export function LogSyncMethod<This, Args extends unknown[], Return>(
  logger: EventLogger,
  options?: Opt<ILogMethodOptions<Args, Return>, Reason.OptionalContext>,
): SyncMethodDecorator<This, Args, Return> {
  return function (
    target: (this: This, ...args: Args) => Return,
    context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Return>,
  ): ((this: This, ...args: Args) => Return) | void {
    const methodName = String(context.name);

    return function (this: This, ...args: Args): Return {
      const actionName = resolveActionName(options?.action, this, methodName);
      const startTime = now();

      void logger.debug(actionName, "started", { args: toSafeJson(args as SafeJsonInput) });
      try {
        const result = target.apply(this, args);
        const duration_ms = now() - startTime;
        const payload = options?.payloadMapper ? options.payloadMapper(args, result) : { duration_ms };
        void logger.info(actionName, "completed", payload);
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const type = error instanceof Error ? error.constructor.name : "unknown";
        void logger.error(actionName, "failed", errorFields(message, type, now() - startTime));
        throw error;
      }
    };
  };
}

/**
 * Wraps an async generator method, bracketing *iteration* rather than invocation — an async
 * generator function call returns the generator object synchronously, so `LogMethod`'s
 * `await target.apply(...)` shape does not apply here. `target.apply(this, args)` runs inside
 * the same try/catch that guards the `for await` loop: if the target throws synchronously
 * before ever producing a generator (a real case — see `TracedProvider.generateStream`), the
 * catch block still fires, so `started` never lands without a matching `failed`/`completed`.
 */
export function LogGeneratorMethod<This, Args extends unknown[], Yield>(
  logger: EventLogger,
  options?: Opt<ILogMethodOptions<Args, AsyncGenerator<Yield>>, Reason.OptionalContext>,
): AsyncGeneratorMethodDecorator<This, Args, Yield> {
  return function (
    target: (this: This, ...args: Args) => AsyncGenerator<Yield>,
    context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => AsyncGenerator<Yield>>,
  ): ((this: This, ...args: Args) => AsyncGenerator<Yield>) | void {
    const methodName = String(context.name);

    return async function* (this: This, ...args: Args): AsyncGenerator<Yield> {
      const actionName = resolveActionName(options?.action, this, methodName);
      const startTime = now();

      try {
        await logger.debug(actionName, "started", { args: toSafeJson(args as SafeJsonInput) });
        const source = target.apply(this, args);
        for await (const value of source) {
          yield value;
        }
        const duration_ms = now() - startTime;
        const payload = options?.payloadMapper ? options.payloadMapper(args, undefined) : { duration_ms };
        await logger.info(actionName, "completed", payload);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const type = error instanceof Error ? error.constructor.name : "unknown";
        await logger.error(actionName, "failed", errorFields(message, type, now() - startTime));
        throw error;
      }
    };
  };
}
