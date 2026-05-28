/**
 * @module LoggingDecorator
 * @path packages/core/src/logger/decorator.ts
 * @description Method decorator for automated execution logging.
 * @architectural-layer Core
 * @related-files [packages/core/src/logger/event_logger.ts]
 */
import type { EventLogger } from "./event_logger.ts";
import { DEFAULT_UNKNOWN_LABEL } from "../types/constants.ts";
import { toSafeJson } from "../types/json.ts";

type SafeJsonInput = string | number | boolean | null | undefined | SafeJsonInput[] | { [key: string]: SafeJsonInput };

type AsyncMethodDecorator = <This, Args extends Array<unknown>, Return>(
  target: (this: This, ...args: Args) => Promise<Return>,
  context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Promise<Return>>,
) => ((this: This, ...args: Args) => Promise<Return>) | void;

export function LogMethod(logger: EventLogger, action?: string): AsyncMethodDecorator {
  return function <This, Args extends Array<unknown>, Return>(
    target: (this: This, ...args: Args) => Promise<Return>,
    context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Promise<Return>>,
  ): ((this: This, ...args: Args) => Promise<Return>) | void {
    const methodName = String(context.name);

    return async function (this: This, ...args: Args): Promise<Return> {
      const constructor = (this as { constructor?: { name?: string } }).constructor;
      const className = constructor?.name || DEFAULT_UNKNOWN_LABEL;
      const actionName = action || `${className}.${methodName}`;
      const startTime = typeof performance !== "undefined" ? performance.now() : Date.now();

      try {
        // Log cached arguments
        await logger.debug(actionName, "started", { args: toSafeJson(args as SafeJsonInput) });

        // Note: we must await target regardless of whether it's sync or async
        // target is the original method in Stage 3 decorators
        const result = await target.apply(this, args);

        const duration = (typeof performance !== "undefined" ? performance.now() : Date.now()) - startTime;
        await logger.info(actionName, "completed", { duration });
        return result;
      } catch (error) {
        const duration = (typeof performance !== "undefined" ? performance.now() : Date.now()) - startTime;
        const errorMsg = error instanceof Error ? error.message : String(error);
        await logger.error(actionName, "failed", { error: errorMsg, duration });
        throw error;
      }
    };
  };
}
