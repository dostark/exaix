---
id: "550e8400-e29b-41d4-a716-446655440001"
created_at: "2026-01-05T00:00:00.000Z"
source: "user"
scope: "global"
status: "active"
skill_id: "tdd-methodology"
name: "Test-Driven Development Methodology"
version: "1.0.0"
description: "Enforces the Red-Green-Refactor cycle for reliable, well-tested code"

triggers:
  keywords:
    - implement
    - feature
    - add
    - create
    - build
    - fix
    - bugfix
    - develop
  task_types:
    - feature
    - bugfix
    - refactor
    - implementation
  file_patterns:
    - "*.ts"
    - "*.js"
    - "*.py"
    - "*.go"
    - "*.rs"
  tags:
    - development
    - testing
    - tdd

constraints:
  - "Never write implementation code before tests"
  - "Run tests after each change"
  - "Keep tests focused on behavior, not implementation"
  - "One logical assertion per test"

output_requirements:
  - "Test file must exist before implementation"
  - "All tests must pass before completion"
  - "Test names describe expected behavior"

quality_criteria:
  - name: "Test Coverage"
    description: "New code has corresponding test coverage"
    weight: 40
  - name: "Test-First Evidence"
    description: "Tests were written before implementation"
    weight: 30
  - name: "Refactor Quality"
    description: "Code is clean and well-structured"
    weight: 30

compatible_with:
  agents:
    - "*"

usage_count: 0
---

# Test-Driven Development Methodology

You MUST follow the Red-Green-Refactor cycle for all code changes:

## Phase 1: Red (Write Failing Test)

1. **Understand the requirement** - What behavior needs to be implemented?
1. **Write a descriptive test** that asserts the expected behavior with a clear, intention-revealing name
1. **Run the test and confirm it fails** for the right reason (the behavior doesn't exist yet)

````typescript
// ✅ Good test name
Deno.test("calculateTotal returns sum of items when cart has products");

// ❌ Bad test name
Deno.test("test1");
```text

## Phase 2: Green (Make It Pass)

1. **Write ONLY enough code** to make the test pass
1. **Run the test and confirm it passes** (GREEN)
1. **Avoid over-engineering** - don't add features the tests don't require yet

```typescript
// ✅ Minimal implementation to pass
function calculateTotal(items: Item[]): number {
  return items.reduce((sum, item) => sum + item.price, 0);
}

// ❌ Over-engineering before tests pass
function calculateTotal(items: Item[]): number {
  // Don't add caching, discounts, etc. until needed
}
```text

## Phase 3: Refactor (Clean Up)

1. **Improve code structure** while tests stay green
1. **Remove duplication** and clarify names without changing behavior
1. **Re-run the tests after every change** to confirm they stay green

## Key Rules

- **Never write production code without a failing test**
- **Keep tests fast** - Unit tests should run in milliseconds
- **Test behavior, not implementation** - Tests shouldn't break when refactoring
- **One logical assertion per test** - Makes failures clear
- **Test edge cases** - Empty inputs, nulls, boundaries

## Example Workflow

1. Write the failing test: "should return an empty array when no items match".
2. Run it and confirm it fails for the right reason (RED).
3. Implement the minimal code to pass (GREEN).
4. Refactor with the test green, then re-run.

## Test design reference

### Test Pyramid

```text
      /\
     /  \     E2E Tests (few)
    /────\
   /      \   Integration Tests (some)
  /────────\
 /          \ Unit Tests (many)
/────────────\
```

### FIRST principles

- **F**ast: tests run quickly.
- **I**ndependent: no test depends on another's state.
- **R**epeatable: same result every run.
- **S**elf-validating: a clear pass/fail with no manual inspection.
- **T**imely: written alongside (ideally before) the code.

### Arrange-Act-Assert

```typescript
Deno.test("should do something", () => {
  // Arrange: set up test data
  const input = createTestInput();
  // Act: execute the code under test
  const result = functionUnderTest(input);
  // Assert: verify the outcome
  assertEquals(result, expectedOutput);
});
```

### Test categories

- **Unit** — single functions/methods; mock external deps; fast (<100ms); high coverage.
- **Integration** — component interactions; real deps where feasible (DB, FS, network).
- **Edge case** — boundary values, empty/null inputs, error conditions, concurrency.
````
