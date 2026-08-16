/**
 * @module LoggingDecorator
 * @path packages/core/src/logger/decorator.ts
 * @description Method decorators for lifecycle logging through registered domain events.
 * @architectural-layer Core
 * @related-files [packages/core/src/logger/event_logger.ts, packages/core/src/events/domain_event_types.ts]
 */
import type { IEventLogger } from "./event_logger.ts";
import { type JSONValue, toSafeJson } from "../types/json.ts";
import type { TDomainEventType } from "@exaix/core/events";
import type { Opt, Reason } from "@exaix/core/types";
type SafeJsonInput = string | number | boolean | null | undefined | SafeJsonInput[] | { [key: string]: SafeJsonInput };

type AsyncMethodDecorator<This, Args extends unknown[], Return> = (
  target: (this: This, ...args: Args) => Promise<Return>,
  context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Promise<Return>>,
) => ((this: This, ...args: Args) => Promise<Return>) | void;
type SyncMethodDecorator<This, Args extends unknown[], Return> = (
  target: (this: This, ...args: Args) => Return,
  context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Return>,
) => ((this: This, ...args: Args) => Return) | void;
type AsyncGeneratorMethodDecorator<This, Args extends unknown[], Yield> = (
  target: (this: This, ...args: Args) => AsyncGenerator<Yield>,
  context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => AsyncGenerator<Yield>>,
) => ((this: This, ...args: Args) => AsyncGenerator<Yield>) | void;

export interface IMethodLogPayload {
  duration_ms?: number;
  error?: string;
  error_type?: string;
  [extra: string]: JSONValue;
}

export type PayloadMapper<Args extends unknown[], Return> = (args: Args, result?: Return) => IMethodLogPayload;

/** Per-lifecycle-phase registered actions, for an operation whose started/completed/failed
 *  events must remain independently taxonomy-distinguishable rather than sharing one action
 *  disambiguated only by the `target` field (e.g. `TracedProvider`'s `LlmCallStarted`/
 *  `LlmStreamCompleted`/`LlmStreamFailed` triad). */
export interface ILifecycleActions {
  started: TDomainEventType;
  completed: TDomainEventType;
  failed: TDomainEventType;
}

/** `LogGeneratorMethod`'s lifecycle actions additionally require `cancelled` — early
 *  consumer cancellation (the iterator is stopped before natural exhaustion) is a fourth
 *  terminal outcome `LogMethod`/`LogSyncMethod` do not have. */
export interface IGeneratorLifecycleActions extends ILifecycleActions {
  cancelled: TDomainEventType;
}

export interface ILogMethodOptions<Args extends unknown[], Return> {
  /** Registered taxonomy member(s). Decorators never derive raw action names. */
  action: TDomainEventType | ILifecycleActions;
  payloadMapper?: Opt<PayloadMapper<Args, Return>, Reason.OptionalContext>;
}

/** Shapes a `LogGeneratorMethod` `completed` event's payload from the call's arguments, the
 *  number of values yielded, and the elapsed duration — a generator has no single `result`
 *  the way an async function does, so this receives `yieldCount`/`durationMs` instead of
 *  `PayloadMapper`'s `result`. */
export type GeneratorPayloadMapper<Args extends unknown[]> = (
  args: Args,
  yieldCount: number,
  durationMs: number,
) => IMethodLogPayload;

export interface ILogGeneratorMethodOptions<Args extends unknown[]> {
  /** Registered taxonomy member(s); the object form must also cover `cancelled`. */
  action: TDomainEventType | IGeneratorLifecycleActions;
  /** Shapes the `started` event's payload; defaults to `{ args: toSafeJson(args) }` (the
   *  raw call arguments, JSON-safe-serialized) when omitted. Override when the raw
   *  arguments are unsuitable for the audit journal — e.g. a large prompt string that
   *  should be summarized (its length), not logged in full. */
  startedPayloadMapper?: Opt<(args: Args) => IMethodLogPayload, Reason.OptionalContext>;
  payloadMapper?: Opt<GeneratorPayloadMapper<Args>, Reason.OptionalContext>;
}

/** Resolves a logger at invocation time for constructor-injected dependencies. */
export type LoggerResolver<This> = (instance: This) => IEventLogger | undefined;
type LoggerSource<This> = IEventLogger | LoggerResolver<This>;

const PHASE_STARTED = "started";
const PHASE_COMPLETED = "completed";
const PHASE_FAILED = "failed";
const PHASE_CANCELLED = "cancelled";

/** Resolves the registered action for one lifecycle `phase`: `action` is either a single
 *  `TDomainEventType` applied to every phase (the target field distinguishes them), or an
 *  `ILifecycleActions`/`IGeneratorLifecycleActions` object giving each phase its own
 *  registered action. */
function actionFor<A extends ILifecycleActions>(action: TDomainEventType | A, phase: keyof A): TDomainEventType {
  return typeof action === "string" ? action : action[phase] as TDomainEventType;
}

function resolveLogger<This>(source: LoggerSource<This>, self: This): IEventLogger | undefined {
  return typeof source === "function" ? source(self) : source;
}

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function errorFields(message: string, type: string, durationMs: number): IMethodLogPayload {
  return { duration_ms: durationMs, error: message, error_type: type };
}

export function LogMethod<This, Args extends unknown[], Return>(
  loggerSource: LoggerSource<This>,
  options: ILogMethodOptions<Args, Return>,
): AsyncMethodDecorator<This, Args, Return> {
  return function (
    target: (this: This, ...args: Args) => Promise<Return>,
    _context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Promise<Return>>,
  ): ((this: This, ...args: Args) => Promise<Return>) | void {
    return async function (this: This, ...args: Args): Promise<Return> {
      const logger = resolveLogger(loggerSource, this);
      if (!logger) return await target.apply(this, args);
      const startTime = now();
      const traceId = crypto.randomUUID();
      try {
        await logger.debug(
          actionFor(options.action, PHASE_STARTED),
          PHASE_STARTED,
          { args: toSafeJson(args as SafeJsonInput) },
          traceId,
        );
        const result = await target.apply(this, args);
        const payload = options.payloadMapper
          ? options.payloadMapper(args, result)
          : { duration_ms: now() - startTime };
        await logger.info(actionFor(options.action, PHASE_COMPLETED), PHASE_COMPLETED, payload, traceId);
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const type = error instanceof Error ? error.constructor.name : "unknown";
        await logger.error(
          actionFor(options.action, PHASE_FAILED),
          PHASE_FAILED,
          errorFields(message, type, now() - startTime),
          traceId,
        );
        throw error;
      }
    };
  };
}

export function LogSyncMethod<This, Args extends unknown[], Return>(
  loggerSource: LoggerSource<This>,
  options: ILogMethodOptions<Args, Return>,
): SyncMethodDecorator<This, Args, Return> {
  return function (
    target: (this: This, ...args: Args) => Return,
    _context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Return>,
  ): ((this: This, ...args: Args) => Return) | void {
    return function (this: This, ...args: Args): Return {
      const logger = resolveLogger(loggerSource, this);
      if (!logger) return target.apply(this, args);
      const startTime = now();
      const traceId = crypto.randomUUID();
      void logger.debug(
        actionFor(options.action, PHASE_STARTED),
        PHASE_STARTED,
        { args: toSafeJson(args as SafeJsonInput) },
        traceId,
      );
      try {
        const result = target.apply(this, args);
        const payload = options.payloadMapper
          ? options.payloadMapper(args, result)
          : { duration_ms: now() - startTime };
        void logger.info(actionFor(options.action, PHASE_COMPLETED), PHASE_COMPLETED, payload, traceId);
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const type = error instanceof Error ? error.constructor.name : "unknown";
        void logger.error(
          actionFor(options.action, PHASE_FAILED),
          PHASE_FAILED,
          errorFields(message, type, now() - startTime),
          traceId,
        );
        throw error;
      }
    };
  };
}

export function LogGeneratorMethod<This, Args extends unknown[], Yield>(
  loggerSource: LoggerSource<This>,
  options: ILogGeneratorMethodOptions<Args>,
): AsyncGeneratorMethodDecorator<This, Args, Yield> {
  return function (
    target: (this: This, ...args: Args) => AsyncGenerator<Yield>,
    _context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => AsyncGenerator<Yield>>,
  ): ((this: This, ...args: Args) => AsyncGenerator<Yield>) | void {
    return async function* (this: This, ...args: Args): AsyncGenerator<Yield> {
      const logger = resolveLogger(loggerSource, this);
      if (!logger) {
        yield* target.apply(this, args);
        return;
      }
      const startTime = now();
      const traceId = crypto.randomUUID();
      let yieldCount = 0;
      let terminalLogged = false;
      try {
        const startedPayload = options.startedPayloadMapper
          ? options.startedPayloadMapper(args)
          : { args: toSafeJson(args as SafeJsonInput) };
        await logger.debug(actionFor(options.action, PHASE_STARTED), PHASE_STARTED, startedPayload, traceId);
        for await (const value of target.apply(this, args)) {
          yieldCount++;
          yield value;
        }
        const payload = options.payloadMapper
          ? options.payloadMapper(args, yieldCount, now() - startTime)
          : { duration_ms: now() - startTime };
        await logger.info(actionFor(options.action, PHASE_COMPLETED), PHASE_COMPLETED, payload, traceId);
        terminalLogged = true;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const type = error instanceof Error ? error.constructor.name : "unknown";
        await logger.error(
          actionFor(options.action, PHASE_FAILED),
          PHASE_FAILED,
          errorFields(message, type, now() - startTime),
          traceId,
        );
        terminalLogged = true;
        throw error;
      } finally {
        if (!terminalLogged) {
          await logger.warn(
            actionFor(options.action, PHASE_CANCELLED),
            PHASE_CANCELLED,
            { duration_ms: now() - startTime },
            traceId,
          );
        }
      }
    };
  };
}
