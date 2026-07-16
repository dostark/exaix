# Refactor order processor

The `processOrder` function in `src/order_processor.ts` is too long and handles
validation, calculation, and business logic in one function.

Extract into separate functions:

1. `validateOrder(order)` — input validation
2. `calculateTotal(items)` — price calculation
3. `checkBusinessRules(order, total)` — business rule enforcement

Each extracted function must be independently testable.
