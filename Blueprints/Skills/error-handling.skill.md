---
id: "550e8400-e29b-41d4-a716-446655440004"
created_at: "2026-01-05T00:00:00.000Z"
source: "user"
scope: "global"
status: "active"
skill_id: "error-handling"
name: "Robust Error Handling"
version: "1.0.0"
description: "Patterns for comprehensive error handling and recovery"

triggers:
  keywords:
    - error
    - exception
    - catch
    - throw
    - handle
    - fail
    - crash
    - recover
    - retry
    - fallback
  task_types:
    - bugfix
    - error-handling
    - reliability
  file_patterns:
    - "*.ts"
    - "*.js"
    - "*.py"
    - "*.go"
  tags:
    - error-handling
    - reliability
    - robustness

constraints:
  - "Never swallow errors silently"
  - "Always log errors with sufficient context"
  - "Provide meaningful error messages to users"
  - "Don't expose internal details in production errors"

output_requirements:
  - "Errors are caught at appropriate boundaries"
  - "Error messages are actionable"
  - "Logging includes context for debugging"

quality_criteria:
  - name: "Error Coverage"
    description: "All error paths are handled"
    weight: 35
  - name: "User Experience"
    description: "Errors don't crash the application"
    weight: 35
  - name: "Debuggability"
    description: "Errors are logged with context"
    weight: 30

compatible_with:
  agents:
    - "*"

usage_count: 0
---

# Robust Error Handling

Implement comprehensive error handling for reliable applications.

## 1. Error Types

Define custom error types for different error categories:

```typescript
// Define error hierarchy
class AppError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number = 500,
    public isOperational: boolean = true,
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

class ValidationError extends AppError {
  constructor(message: string, public field?: string) {
    super(message, "VALIDATION_ERROR", 400);
  }
}

class NotFoundError extends AppError {
  constructor(resource: string, id?: string) {
    super(`${resource}${id ? ` with id ${id}` : ""} not found`, "NOT_FOUND", 404);
  }
}

class AuthorizationError extends AppError {
  constructor(message = "Not authorized") {
    super(message, "UNAUTHORIZED", 403);
  }
}
```

## 2. Try-Catch Patterns

**Do:**

```typescript
// ✅ Specific error handling
try {
  const result = await riskyOperation();
  return result;
} catch (error) {
  if (error instanceof ValidationError) {
    // Handle validation errors specifically
    return { error: error.message, field: error.field };
  }
  if (error instanceof NotFoundError) {
    // Handle not found errors
    return { error: "Resource not found" };
  }
  // Re-throw unknown errors
  throw error;
}
```

**Don't:**

```typescript
// ❌ Silent error swallowing
try {
  await riskyOperation();
} catch (error) {
  // Error lost forever
}

// ❌ Catching and ignoring
try {
  await riskyOperation();
} catch {
  return null; // Caller has no idea something failed
}
```

## 3. Error Boundaries

Establish clear error boundaries:

```typescript
// Application-level error handler
async function handleRequest(req: Request): Promise<Response> {
  try {
    return await router.handle(req);
  } catch (error) {
    // Log the full error internally
    logger.error("Request failed", {
      error,
      path: req.url,
      method: req.method,
    });

    // Return safe error to client
    if (error instanceof AppError && error.isOperational) {
      return new Response(
        JSON.stringify({ error: error.message, code: error.code }),
        { status: error.statusCode },
      );
    }

    // Generic error for unexpected failures
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500 },
    );
  }
}
```

## 4. Async Error Handling

Handle promise rejections:

```typescript
// ✅ Proper async error handling
async function processItems(items: Item[]) {
  const results = await Promise.allSettled(
    items.map((item) => processItem(item)),
  );

  const succeeded = results.filter((r) => r.status === "fulfilled");
  const failed = results.filter((r) => r.status === "rejected");

  if (failed.length > 0) {
    logger.warn(`${failed.length} items failed processing`, {
      errors: failed.map((f) => f.reason),
    });
  }

  return succeeded.map((s) => s.value);
}
```

## 5. Error Logging

Include sufficient context:

```typescript
// ✅ Good error logging
logger.error("Failed to process order", {
  error: error.message,
  stack: error.stack,
  orderId: order.id,
  userId: user.id,
  timestamp: new Date().toISOString(),
  requestId: context.requestId,
});

// ❌ Bad error logging
console.log(error); // Missing context
console.log("Error"); // No details at all
```

## 6. Retry Strategies

Implement retries for transient failures:

```typescript
async function withRetry<T>(
  operation: () => Promise<T>,
  options: {
    maxRetries: number;
    backoffMs: number;
    retryCondition?: (error: unknown) => boolean;
  },
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= options.maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      if (options.retryCondition && !options.retryCondition(error)) {
        throw error; // Don't retry non-retryable errors
      }

      if (attempt < options.maxRetries) {
        const delay = options.backoffMs * Math.pow(2, attempt - 1);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError;
}
```

## 7. Graceful Degradation

Provide fallbacks when possible:

```typescript
async function getRecommendations(userId: string): Promise<Item[]> {
  try {
    return await recommendationService.getPersonalized(userId);
  } catch (error) {
    logger.warn("Personalized recommendations failed, using fallback", { error });
    // Fall back to popular items
    return await itemService.getPopular();
  }
}
```
