/**
 * @module MiddlewarePipeline
 * @path src/services/middleware/pipeline.ts
 * @description Generic middleware pipeline for executing a chain of interceptors.
 * @architectural-layer Services
 * @related-files [src/services/common/types.ts]
 */
import type { IServiceContext } from "../common/types.ts";

/**
 * Middleware function type
 */
export type Middleware<T extends IServiceContext> = (
  context: T,
  next: () => Promise<void>,
) => Promise<void>;

/**
 * Middleware pipeline for executing a chain of middleware functions
 */
export class MiddlewarePipeline<T extends IServiceContext> {
  private middlewares: Middleware<T>[] = [];

  /**
   * Add middleware to the pipeline
   */
  use(middleware: Middleware<T>): this {
    this.middlewares.push(middleware);
    return this;
  }

  /**
   * Execute the middleware pipeline. Returns the handler's result.
   */
  async execute<R>(context: T, handler: () => Promise<R>): Promise<R> {
    const dispatch = async (index: number): Promise<R | undefined> => {
      if (index === this.middlewares.length) {
        return await handler();
      }

      const middleware = this.middlewares[index];
      let innerResult: R | undefined = undefined;

      await middleware(context, async () => {
        innerResult = await dispatch(index + 1);
      });

      return innerResult;
    };

    const res = await dispatch(0);
    return (res as R);
  }
}
