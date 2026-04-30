/**
 * @module CommonErrors
 * @path src/services/common/errors.ts
 * @description Shared error classes for service-level operations (Validation, Authorization, NotFound).
 * @architectural-layer Services
 * @related-files ["src/services/agent/agent_runner.ts", "src/services/request/request_processor.ts"]
 */
export class ServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ServiceError";
  }
}

/**
 * Error thrown when input validation fails
 */
export class ValidationError extends ServiceError {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

/**
 * Error thrown when authorization fails
 */
export class AuthorizationError extends ServiceError {
  constructor(message: string) {
    super(message);
    this.name = "AuthorizationError";
  }
}

/**
 * Error thrown when a requested resource is not found
 */
export class NotFoundError extends ServiceError {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}
