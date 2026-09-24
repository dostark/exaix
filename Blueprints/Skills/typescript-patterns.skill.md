---
id: "550e8400-e29b-41d4-a716-446655440007"
created_at: "2026-01-05T00:00:00.000Z"
source: "user"
scope: "global"
status: "active"
skill_id: "typescript-patterns"
name: "TypeScript Best Practices"
version: "1.0.0"
description: "Modern TypeScript patterns for type-safe, maintainable code"

triggers:
  keywords:
    - typescript
    - types
    - interface
    - type
    - generic
    - strict
    - typing
  task_types:
    - feature
    - refactor
    - typescript
  file_patterns:
    - "*.ts"
    - "*.tsx"
  tags:
    - typescript
    - types
    - patterns

constraints:
  - "Enable strict mode in tsconfig"
  - "Never use `any` — not even implicitly through missing annotations"
  - "Never use `unknown` as a parameter type, return type, or field type — define a named interface or type alias instead"
  - "Every variable, parameter, return value, and data structure must have an explicit type annotation"
  - "Never use double casting (`... as unknown as ...`) to bypass the compiler"
  - "Prefer interfaces for object shapes"
  - "Use type guards for narrowing"

output_requirements:
  - "No implicit any"
  - "No explicit any"
  - "No unknown as a stored/parameter/return type"
  - "Proper null/undefined handling"
  - "Type-safe function signatures"

quality_criteria:
  - name: "Type Safety"
    description: "Code is properly typed — all vars, params, and return values have explicit annotations"
    weight: 40
  - name: "Type Clarity"
    description: "Types are clear, named, and documented"
    weight: 30
  - name: "No Any / No Unknown fallback"
    description: "Avoids any and unknown as lazy fallbacks; uses named types instead"
    weight: 30

compatible_with:
  agents:
    - "*"

usage_count: 0
---

# TypeScript Best Practices

Write type-safe, maintainable TypeScript code.

## 1. Strict Mode Configuration

Always use strict mode:

```json
// tsconfig.json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "exactOptionalPropertyTypes": true
  }
}
```

## 2. Type Definitions

### Rule: Always Annotate, Never Use `any`, Never Use `unknown` as a Stored Type

```typescript
// ❌ Bad: missing annotation (implicit any)
function process(data) {
  return data.value;
}

// ❌ Bad: explicit any
function process(data: any) {
  return data.value;
}

// ❌ Bad: unknown as a parameter type (lazy fallback)
function process(data: unknown) {
  return (data as MyType).value;
}

// ❌ Bad: double casting to bypass checks
const bad = source as unknown as Target;

// ✅ Good: named interface, fully annotated
interface ProcessInput {
  value: string;
}
function process(data: ProcessInput): string {
  return data.value;
}

// ✅ Good: unknown is only permitted in catch clauses and transient narrowing guards
try {
  await riskyOperation();
} catch (e: unknown) {
  if (e instanceof Error) console.error(e.message); // narrowed to Error
}
```

**If the type does not exist yet — create it.** Do not reach for `any` or `unknown` as a shortcut.

### Prefer Interfaces for Object Shapes

```typescript
// ✅ Good: Interface for object shapes
interface User {
  id: string;
  email: string;
  name: string;
  createdAt: Date;
}

// Use type for unions, intersections, mapped types
type Status = "pending" | "active" | "inactive";
type UserWithRole = User & { role: string };
```

### Define Function Types Clearly

```typescript
// ✅ Good: Clear function signatures
interface UserService {
  getById(id: string): Promise<User | null>;
  create(input: CreateUserInput): Promise<User>;
  update(id: string, input: UpdateUserInput): Promise<User>;
  delete(id: string): Promise<void>;
}

// Type for callbacks
type OnUserCreated = (user: User) => void;
```

## 3. Generics

### Use Generics for Reusable Functions

```typescript
// ✅ Good: Generic function
async function fetchById<T>(
  url: string,
  id: string,
): Promise<T | null> {
  const response = await fetch(`${url}/${id}`);
  if (!response.ok) return null;
  return response.json() as Promise<T>;
}

// Usage
const user = await fetchById<User>("/api/users", "123");
```

### Constrain Generics When Appropriate

```typescript
// ✅ Good: Constrained generic
interface HasId {
  id: string;
}

function findById<T extends HasId>(
  items: T[],
  id: string,
): T | undefined {
  return items.find((item) => item.id === id);
}
```

## 4. Type Guards

### Custom Type Guards

```typescript
// ✅ Good: Type guard function
interface ApiError {
  code: string;
  message: string;
}

function isApiError(error: unknown): error is ApiError {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    "message" in error
  );
}

// Usage
try {
  await riskyOperation();
} catch (error) {
  if (isApiError(error)) {
    console.log(error.code); // TypeScript knows it's ApiError
  }
}
```

### Discriminated Unions

```typescript
// ✅ Good: Discriminated union
type Result<T> =
  | { success: true; data: T }
  | { success: false; error: string };

function handleResult<T>(result: Result<T>) {
  if (result.success) {
    console.log(result.data); // TypeScript knows data exists
  } else {
    console.log(result.error); // TypeScript knows error exists
  }
}
```

## 5. Utility Types

Use built-in utility types:

```typescript
// Partial - all properties optional
type UpdateUser = Partial<User>;

// Pick - select specific properties
type UserCredentials = Pick<User, "email" | "password">;

// Omit - exclude properties
type UserWithoutPassword = Omit<User, "password">;

// Record - object with known keys
type UserRoles = Record<string, Role>;

// Required - make all properties required
type RequiredConfig = Required<Config>;

// Readonly - make all properties readonly
type ImmutableUser = Readonly<User>;
```

## 6. Null/Undefined Handling

### Use Optional Chaining and Nullish Coalescing

```typescript
// ✅ Good: Safe property access
const email = user?.profile?.email ?? "default@example.com";

// ✅ Good: Explicit null checks
function processUser(user: User | null) {
  if (!user) {
    throw new Error("User is required");
  }
  // TypeScript knows user is User here
  return user.email;
}
```

### Avoid Non-Null Assertions Unless Certain

```typescript
// ❌ Avoid: Non-null assertion
const email = user!.email;

// ✅ Better: Explicit check
if (!user) throw new Error("User required");
const email = user.email;
```

## 7. Enums vs Union Types

Prefer union types over enums:

```typescript
// ✅ Preferred: Union type
type Status = "pending" | "active" | "inactive";

// ❌ Avoid: Enum (adds runtime code)
enum StatusEnum {
  Pending = "pending",
  Active = "active",
  Inactive = "inactive",
}

// If you need runtime values, use const object
const STATUS = {
  Pending: "pending",
  Active: "active",
  Inactive: "inactive",
} as const;

type Status = typeof STATUS[keyof typeof STATUS];
```

## 8. Module Organization

```typescript
// Export types separately
export type { CreateUserInput, User };

// Export implementation
export { UserService };

// Re-export from index
export * from "./user.ts";
export type * from "./types.ts";
```
