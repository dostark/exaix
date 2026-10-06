---
name: tdd-methodology
description: "Enforces the Red-Green-Refactor cycle for reliable, well-tested code"
---
# Test-Driven Development Methodology

Follow the Red-Green-Refactor cycle for all code changes.

## Phase 1: Red (Write Failing Test)

1. **Understand the requirement** - What behavior needs to be implemented?
2. **Write a test** that describes the expected behavior
3. **Run the test** to confirm it fails (for the right reason)
4. **Name tests descriptively** - Test names should read like specifications

````typescript
// ✅ Good test name
Deno.test("calculateTotal returns sum of items when cart has products");

// ❌ Bad test name
Deno.test("test1");
```text

## Phase 2: Green (Make It Pass)

1. **Write ONLY enough code** to make the test pass
2. **No additional features** or optimizations
3. **Focus on correctness**, not elegance
4. **Run tests frequently** - After every small change

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
2. **Extract helpers**, reduce duplication
3. **Improve naming** and organization
4. **Run tests after EVERY change**

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
