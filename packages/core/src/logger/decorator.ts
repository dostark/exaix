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

export interface ILogMethodOptions<Args extends unknown[], Return> {
  /** Registered taxonomy member. Decorators never derive raw action names. */
  action: TDomainEventType;
  payloadMapper?: Opt<PayloadMapper<Args, Return>, Reason.OptionalContext>;
}

/** Resolves a logger at invocation time for constructor-injected dependencies. */
export type LoggerResolver<This> = (instance: This) => IEventLogger | undefined;
type LoggerSource<This> = IEventLogger | LoggerResolver<This>;

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
      try {
        await logger.debug(options.action, "started", { args: toSafeJson(args as SafeJsonInput) });
        const result = await target.apply(this, args);
        const payload = options.payloadMapper
          ? options.payloadMapper(args, result)
          : { duration_ms: now() - startTime };
        await logger.info(options.action, "completed", payload);
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const type = error instanceof Error ? error.constructor.name : "unknown";
        await logger.error(options.action, "failed", errorFields(message, type, now() - startTime));
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
      void logger.debug(options.action, "started", { args: toSafeJson(args as SafeJsonInput) });
      try {
        const result = target.apply(this, args);
        const payload = options.payloadMapper
          ? options.payloadMapper(args, result)
          : { duration_ms: now() - startTime };
        void logger.info(options.action, "completed", payload);
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const type = error instanceof Error ? error.constructor.name : "unknown";
        void logger.error(options.action, "failed", errorFields(message, type, now() - startTime));
        throw error;
      }
    };
  };
}

export function LogGeneratorMethod<This, Args extends unknown[], Yield>(
  loggerSource: LoggerSource<This>,
  options: ILogMethodOptions<Args, AsyncGenerator<Yield>>,
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
      let terminalLogged = false;
      try {
        await logger.debug(options.action, "started", { args: toSafeJson(args as SafeJsonInput) });
        for await (const value of target.apply(this, args)) yield value;
        await logger.info(options.action, "completed", { duration_ms: now() - startTime });
        terminalLogged = true;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const type = error instanceof Error ? error.constructor.name : "unknown";
        await logger.error(options.action, "failed", errorFields(message, type, now() - startTime));
        terminalLogged = true;
        throw error;
      } finally {
        if (!terminalLogged) await logger.warn(options.action, "cancelled", { duration_ms: now() - startTime });
      }
    };
  };
}
