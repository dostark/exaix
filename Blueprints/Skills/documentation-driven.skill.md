---
id: "550e8400-e29b-41d4-a716-446655440005"
created_at: "2026-01-05T00:00:00.000Z"
source: "user"
scope: "global"
status: "active"
skill_id: "documentation-driven"
name: "Documentation-Driven Development"
version: "1.0.0"
description: "Write documentation first to clarify design and requirements"

triggers:
  keywords:
    - document
    - docs
    - readme
    - explain
    - describe
    - api
    - specification
    - design
  task_types:
    - documentation
    - design
    - api-design
  file_patterns:
    - "*.md"
    - "README*"
    - "docs/**"
    - "**/*.md"
  tags:
    - documentation
    - design
    - api

constraints:
  - "Documentation should precede or accompany implementation"
  - "Keep documentation close to code"
  - "Update docs when code changes"
  - "Write for your audience (users vs developers)"

output_requirements:
  - "Clear purpose and overview"
  - "Usage examples that work"
  - "API documentation for public interfaces"

quality_criteria:
  - name: "Completeness"
    description: "All features documented"
    weight: 30
  - name: "Clarity"
    description: "Easy to understand"
    weight: 35
  - name: "Accuracy"
    description: "Matches actual behavior"
    weight: 35

compatible_with:
  agents:
    - "*"

usage_count: 0
---

# Documentation-Driven Development

Write documentation first to clarify design before implementation:

## 1. Start with README

Before writing code, document what you're building:

`````markdown
# Feature Name

## Purpose

What problem does this solve? Why is it needed?

## Usage

### Basic Example

\`\`\`typescript
// Show the simplest use case
const result = await doThing();
\`\`\`

### Advanced Example

\`\`\`typescript
// Show more complex scenarios
const result = await doThing({
option: 'value',
callback: (data) => handleData(data),
});
\`\`\`

## API Reference

### `functionName(params): ReturnType`

Description of what this function does.

**Parameters:**

- `param1` (string): Description
- `param2` (number, optional): Description

**Returns:** Description of return value

**Throws:**

- `ErrorType`: When this error occurs

## 2. Document-First API Design

Define your API contract before implementation:

````typescript
/**
 * UserService - Manages user accounts and authentication
 *
 * @example
 * ```typescript
 * const userService = new UserService(db);
 * const user = await userService.create({
 *   email: 'user@example.com',
 *   password: 'secure123',
 * });
 * ```
 */
export class UserService {
  /**
   * Create a new user account
   *
   * @param input - User creation data
   * @returns The created user (without password)
   * @throws ValidationError if email is invalid
   * @throws DuplicateError if email already exists
   */
  async create(input: CreateUserInput): Promise<User> {
    // Implementation comes after docs
  }
}
````
`````

## 3. JSDoc for Functions

Document all public functions:

````typescript
/**
 * Calculate the total price including tax and discounts
 *
 * @param items - Cart items with price and quantity
 * @param options - Calculation options
 * @param options.taxRate - Tax rate as decimal (e.g., 0.08 for 8%)
 * @param options.discountCode - Optional discount code to apply
 * @returns Total price in cents
 *
 * @example
 * ```typescript
 * const total = calculateTotal(
 *   [{ price: 1000, quantity: 2 }],
 *   { taxRate: 0.08 }
 * );
 * // Returns: 2160 (2000 + 8% tax)
 * ```
 */
export function calculateTotal(
  items: CartItem[],
  options: CalculateOptions,
): number {
  // Implementation
}
````

## 4. Architecture Documentation

Document system design:

```markdown
# Architecture Overview

## Components

### Service Layer

- **UserService** - User management and authentication
- **OrderService** - Order processing and fulfillment
- **PaymentService** - Payment processing

### Data Flow

\`\`\`
Request → Router → Controller → Service → Repository → Database
↓
Domain Events → Event Handlers
\`\`\`

## Design Decisions

### Why PostgreSQL over MongoDB?

- Strong consistency requirements for financial data
- Complex relational queries for reporting
- ACID compliance for transactions

### Why Event Sourcing for Orders?

- Audit trail requirements
- Easy to reconstruct state at any point
- Supports complex workflows
```

## 5. Keep Docs Updated

Documentation debt is technical debt:

- **Code reviews** should include doc reviews
- **Automated checks** for doc coverage
- **Living documentation** generated from code
- **Version docs** alongside code changes

## 6. Documentation Types

| Type          | Audience    | Purpose               |
| ------------- | ----------- | --------------------- |
| README        | Users       | Quick start, overview |
| API Reference | Developers  | Technical details     |
| Tutorials     | Learners    | Step-by-step guides   |
| Architecture  | Team        | System design         |
| ADRs          | Future devs | Decision rationale    |

## Benefits of Documentation-First

1. **Clarifies thinking** - Writing docs forces you to think through design
2. **Catches issues early** - Easier to spot problems in docs than code
3. **Better APIs** - User-facing docs lead to user-friendly APIs
4. **Communication** - Docs serve as specifications for teams
5. **Onboarding** - New team members can ramp up faster
